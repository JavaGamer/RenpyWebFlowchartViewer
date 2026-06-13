import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerResponseMessage,
  type ParseRequestMessage,
  type CancelRequestMessage,
  type ParseWorkerClientRequest,
  type ParseWorkerClientResult,
  type SearchRequestMessage,
  type DialogueSearchResult,
  type ParseChunkRequestMessage,
} from './workerProtocol';

let requestCounter = 0;
const textEncoder = new TextEncoder();

// ─── Worker Pool ──────────────────────────────────────────────────────────────

/**
 * Maximum number of workers in the pool, capped by hardware concurrency.
 * Worker 0 is the primary (handles search queries and full parse requests).
 * Workers 1..N are helpers used for parallel chunk parsing.
 */
const MAX_POOL_SIZE = Math.max(
  1,
  Math.min(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 1, 8),
);

const workerPool: (Worker | null)[] = new Array(MAX_POOL_SIZE).fill(null);

function getWorker(index: number): Worker {
  if (index < 0 || index >= MAX_POOL_SIZE) {
    throw new Error(`Worker index ${index} out of bounds [0, ${MAX_POOL_SIZE})`);
  }
  let w = workerPool[index];
  if (!w) {
    w = new Worker(new URL('./parserWorker.ts', import.meta.url), { type: 'module' });
    workerPool[index] = w;
  }
  return w;
}

/** Returns the primary parser worker (Worker 0). */
function getParserWorker(): Worker {
  return getWorker(0);
}

/** Returns the effective pool size (at least 1). */
function getPoolSize(): number {
  return MAX_POOL_SIZE;
}

function hashToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Lightweight deterministic hash used only for cache keys when Web Crypto is unavailable.
 */
function simpleStringHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function computeFileCacheKeys(files: ParseWorkerClientRequest['files']): Promise<string[]> {
  if (!globalThis.crypto?.subtle) {
    return files.map((file) => {
      const identity = file.relativePath ?? file.name;
      return `${identity}:${file.content.length}:${simpleStringHash(file.content)}`;
    });
  }

  const digests = await Promise.all(
    files.map(async (file) => {
      const data = textEncoder.encode(file.content);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      return `${file.relativePath ?? file.name}:${hashToHex(digest)}`;
    }),
  );
  return digests;
}

export function parseRenpyFilesInWorker(
  request: ParseWorkerClientRequest,
): Promise<ParseWorkerClientResult> {
  const {
    files,
    appendToActiveGraph,
    resetActiveGraph,
    isFinalChunk,
    captureDialogueLines,
    parserVariant,
    screenActionRules,
    onProgress,
    onPartialResult,
    signal,
    maxParallelFiles,
  } = request;

  const shouldRunParallel =
    files.length > 1 && getPoolSize() > 1 && maxParallelFiles !== 1;

  if (shouldRunParallel) {
    return parseChunksInParallel({
      files,
      captureDialogueLines,
      parserVariant,
      screenActionRules,
      signal,
      appendToActiveGraph,
      resetActiveGraph,
      isFinalChunk,
    });
  }

  const parserWorker = getParserWorker();
  const requestId = ++requestCounter;
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Parsing cancelled', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cb();
    };

    const onMessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) {
        const raw = event.data as { requestId?: unknown; protocolVersion?: unknown };
        if (raw.requestId === requestId) {
          settle(() => {
            parserWorker.removeEventListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
            reject(new Error(
              `Worker protocol version mismatch: expected ${PARSER_WORKER_PROTOCOL_VERSION}, received ${String(raw.protocolVersion)}. ` +
              'Please reload the page to use the latest worker version.',
            ));
          });
        }
        return;
      }
      if (message.requestId !== requestId) return;

      if (message.type === 'progress') {
        onProgress?.({
          doneFiles: message.doneFiles,
          totalFiles: message.totalFiles,
          currentFile: message.currentFile,
          elapsedMs: message.elapsedMs,
        });
        return;
      }

      if (message.type === 'result' && message.partial) {
        settle(() => {
          parserWorker.removeEventListener('message', onMessage);
          signal?.removeEventListener('abort', onAbort);
          const partialResult = message.diagnostics
            ? { nodes: message.nodes, edges: message.edges, diagnostics: message.diagnostics }
            : { nodes: message.nodes, edges: message.edges };
          onPartialResult?.(partialResult);
          resolve(partialResult);
        });
        return;
      }

      settle(() => {
        parserWorker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
      });

      if (message.type === 'result') {
        if (message.diagnostics) {
          resolve({ nodes: message.nodes, edges: message.edges, diagnostics: message.diagnostics });
        } else {
          resolve({ nodes: message.nodes, edges: message.edges });
        }
        return;
      }
      if (message.type === 'error') {
        reject(new Error(message.message));
        return;
      }
      reject(new Error('Unexpected parser worker response'));
    };

    const onAbort = () => {
      settle(() => {
        parserWorker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
        const cancelMessage: CancelRequestMessage = {
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'cancel',
          requestId,
        };
        parserWorker.postMessage(cancelMessage);
        reject(new DOMException('Parsing cancelled', 'AbortError'));
      });
    };

    parserWorker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });

    void (async () => {
      try {
        const fileCacheKeys = await computeFileCacheKeys(files);
        if (settled) return;
        const parseMessage: ParseRequestMessage = {
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'parse',
          requestId,
          files,
          fileCacheKeys,
          wantsProgress: Boolean(onProgress),
          maxParallelFiles,
          appendToActiveGraph,
          resetActiveGraph,
          isFinalChunk,
          captureDialogueLines,
          parserVariant,
          screenActionRules,
        };
        parserWorker.postMessage(parseMessage);
      } catch (error) {
        settle(() => {
          parserWorker.removeEventListener('message', onMessage);
          signal?.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    })();
  });
}

interface SearchRequestPayload {
  query: string;
  nodeIds?: string[];
  maxResults?: number;
  signal?: AbortSignal;
}

export function searchDialogueLinesInWorker({
  query,
  nodeIds,
  maxResults,
  signal,
}: SearchRequestPayload): Promise<DialogueSearchResult[]> {
  const parserWorker = getParserWorker();
  const requestId = ++requestCounter;
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Search cancelled', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cb();
    };

    const onMessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) {
        const raw = event.data as { requestId?: unknown; protocolVersion?: unknown };
        if (raw.requestId === requestId) {
          settle(() => {
            parserWorker.removeEventListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
            reject(new Error(
              `Worker protocol version mismatch: expected ${PARSER_WORKER_PROTOCOL_VERSION}, received ${String(raw.protocolVersion)}. ` +
              'Please reload the page to use the latest worker version.',
            ));
          });
        }
        return;
      }
      if (message.requestId !== requestId) return;
      if (message.type === 'error') {
        settle(() => {
          parserWorker.removeEventListener('message', onMessage);
          signal?.removeEventListener('abort', onAbort);
        });
        reject(new Error(message.message));
        return;
      }
      if (message.type !== 'search_result') return;
      settle(() => {
        parserWorker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
      });
      resolve(message.results);
    };

    const onAbort = () => {
      settle(() => {
        parserWorker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
        const cancelMessage: CancelRequestMessage = {
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'cancel',
          requestId,
        };
        parserWorker.postMessage(cancelMessage);
        reject(new DOMException('Search cancelled', 'AbortError'));
      });
    };

    parserWorker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    const searchMessage: SearchRequestMessage = {
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'search',
      requestId,
      query,
      nodeIds,
      maxResults,
    };
    parserWorker.postMessage(searchMessage);
  });
}

// ─── Parallel Chunk Parsing ───────────────────────────────────────────────────

export interface ParseChunkRequest {
  files: ParseWorkerClientRequest['files'];
  captureDialogueLines?: boolean;
  parserVariant?: ParseWorkerClientRequest['parserVariant'];
  screenActionRules?: ParseWorkerClientRequest['screenActionRules'];
  signal?: AbortSignal;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
}

export interface ParseChunkResult {
  nodes: ParseWorkerClientResult['nodes'];
  edges: ParseWorkerClientResult['edges'];
  diagnostics?: ParseWorkerClientResult['diagnostics'];
}

interface InternalChunkResult extends ParseChunkResult {
  pendingCallReturns: Array<{ returnTargetId: string; callTargetId: string }>;
  hasReliableReturnInLabel: string[];
  globalScreens: string[];
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
}

/**
 * Distributes file parsing across the worker pool.
 *
 * Files are split evenly across workers 1..N (or all workers if pool size is
 * small). Each worker receives a `parse_chunk` message and returns raw,
 * unfinalized nodes/edges and parsing metadata.
 *
 * The results are then merged on the main thread and sent to Worker 0 via a
 * 'finalize' message to construct the final graph structure, run role
 * finalization, and build the dialogue search index in the background.
 */
export async function parseChunksInParallel({
  files,
  captureDialogueLines,
  parserVariant,
  screenActionRules,
  signal,
  appendToActiveGraph,
  resetActiveGraph,
  isFinalChunk,
}: ParseChunkRequest): Promise<ParseChunkResult> {
  if (signal?.aborted) {
    throw new DOMException('Parsing cancelled', 'AbortError');
  }

  const poolSize = getPoolSize();
  // Use all workers when pool is small, skip Worker 0 when pool is large
  // so it stays free for search queries.
  const useWorkerIndices: number[] = [];
  if (poolSize <= 2) {
    for (let i = 0; i < poolSize; i++) useWorkerIndices.push(i);
  } else {
    for (let i = 1; i < poolSize; i++) useWorkerIndices.push(i);
  }
  const workerCount = useWorkerIndices.length;

  // Split files into balanced chunks
  const chunks: ParseWorkerClientRequest['files'][] = [];
  const chunkSize = Math.ceil(files.length / workerCount);
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }

  // Pre-compute cache keys
  const allCacheKeys = await computeFileCacheKeys(files);
  if (signal?.aborted) {
    throw new DOMException('Parsing cancelled', 'AbortError');
  }

  // Dispatch chunks to workers
  const chunkPromises = chunks.map((chunkFiles, chunkIdx) => {
    const workerIdx = useWorkerIndices[chunkIdx % workerCount]!;
    const chunkWorker = getWorker(workerIdx);
    const chunkRequestId = ++requestCounter;
    const cacheKeyOffset = chunkIdx * chunkSize;
    const chunkCacheKeys = allCacheKeys.slice(cacheKeyOffset, cacheKeyOffset + chunkFiles.length);

    return new Promise<InternalChunkResult>((resolve, reject) => {
      let settled = false;
      const settle = (cb: () => void) => {
        if (settled) return;
        settled = true;
        cb();
      };

      const onMessage = (event: MessageEvent<WorkerResponseMessage>) => {
        const msg = event.data;
        if (msg.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) return;
        if (msg.requestId !== chunkRequestId) return;

        if (msg.type === 'chunk_result') {
          settle(() => {
            chunkWorker.removeEventListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
          });
          resolve({
            nodes: msg.nodes,
            edges: msg.edges,
            diagnostics: msg.diagnostics,
            pendingCallReturns: msg.pendingCallReturns ?? [],
            hasReliableReturnInLabel: msg.hasReliableReturnInLabel ?? [],
            globalScreens: msg.globalScreens ?? [],
            labelDefinitionCount: msg.labelDefinitionCount ?? [],
            canonicalLabelIds: msg.canonicalLabelIds ?? [],
          });
          return;
        }
        if (msg.type === 'error') {
          settle(() => {
            chunkWorker.removeEventListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
          });
          reject(new Error(msg.message));
          return;
        }
      };

      const onAbort = () => {
        settle(() => {
          chunkWorker.removeEventListener('message', onMessage);
          signal?.removeEventListener('abort', onAbort);
          chunkWorker.postMessage({
            protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
            type: 'cancel',
            requestId: chunkRequestId,
          } satisfies CancelRequestMessage);
          reject(new DOMException('Parsing cancelled', 'AbortError'));
        });
      };

      chunkWorker.addEventListener('message', onMessage);
      signal?.addEventListener('abort', onAbort, { once: true });

      const chunkMessage: ParseChunkRequestMessage = {
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'parse_chunk',
        requestId: chunkRequestId,
        files: chunkFiles,
        fileCacheKeys: chunkCacheKeys,
        captureDialogueLines,
        parserVariant,
        screenActionRules,
      };
      chunkWorker.postMessage(chunkMessage);
    });
  });

  // Collect and merge results
  const results = await Promise.all(chunkPromises);
  const mergedNodes = results.flatMap((r) => r.nodes);
  const mergedEdges = results.flatMap((r) => r.edges);
  const mergedDiagnostics = results.flatMap((r) => r.diagnostics ?? []);
  const mergedPendingCallReturns = results.flatMap((r) => r.pendingCallReturns);

  const mergedHasReliableReturnInLabel = Array.from(new Set(results.flatMap((r) => r.hasReliableReturnInLabel)));
  const mergedGlobalScreens = Array.from(new Set(results.flatMap((r) => r.globalScreens)));

  const labelCountMap = new Map<string, number>();
  for (const r of results) {
    for (const [name, count] of r.labelDefinitionCount) {
      labelCountMap.set(name, (labelCountMap.get(name) ?? 0) + count);
    }
  }
  const mergedLabelDefinitionCount = Array.from(labelCountMap.entries());

  const canonicalMap = new Map<string, string>();
  for (const r of results) {
    for (const [name, id] of r.canonicalLabelIds) {
      canonicalMap.set(name, id);
    }
  }
  const mergedCanonicalLabelIds = Array.from(canonicalMap.entries());

  // Delegate finalization and search index compilation to Worker 0
  const primaryWorker = getParserWorker();
  const finalizeRequestId = ++requestCounter;

  return new Promise<ParseChunkResult>((resolve, reject) => {
    let settled = false;
    const settle = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cb();
    };

    const onMessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const msg = event.data;
      if (msg.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) return;
      if (msg.requestId !== finalizeRequestId) return;

      if (msg.type === 'finalize_result') {
        settle(() => {
          primaryWorker.removeEventListener('message', onMessage);
          signal?.removeEventListener('abort', onAbort);
        });
        resolve({
          nodes: msg.nodes,
          edges: msg.edges,
          diagnostics: msg.diagnostics,
        });
        return;
      }
      if (msg.type === 'error') {
        settle(() => {
          primaryWorker.removeEventListener('message', onMessage);
          signal?.removeEventListener('abort', onAbort);
        });
        reject(new Error(msg.message));
        return;
      }
    };

    const onAbort = () => {
      settle(() => {
        primaryWorker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
        primaryWorker.postMessage({
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'cancel',
          requestId: finalizeRequestId,
        } satisfies CancelRequestMessage);
        reject(new DOMException('Parsing cancelled', 'AbortError'));
      });
    };

    primaryWorker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });

    primaryWorker.postMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'finalize',
      requestId: finalizeRequestId,
      nodes: mergedNodes,
      edges: mergedEdges,
      diagnostics: mergedDiagnostics,
      pendingCallReturns: mergedPendingCallReturns,
      hasReliableReturnInLabel: mergedHasReliableReturnInLabel,
      globalScreens: mergedGlobalScreens,
      labelDefinitionCount: mergedLabelDefinitionCount,
      canonicalLabelIds: mergedCanonicalLabelIds,
      appendToActiveGraph,
      resetActiveGraph,
      isFinalChunk,
    });
  });
}

/** Returns the current worker pool size for external consumers (e.g. telemetry). */
export function getWorkerPoolSize(): number {
  return getPoolSize();
}
