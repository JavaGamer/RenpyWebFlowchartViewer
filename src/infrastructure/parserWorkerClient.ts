import { proxy, type Remote, transfer, wrap } from "comlink";
import MiniSearch from "minisearch";
import {
  createGraphState,
  finalizeRoles,
  processTokenizedFile,
  tokenizeOneFile,
} from "../parser/index.ts";
import {
  DIALOGUE_MINISEARCH_OPTIONS,
  type DialogueSearchDocument,
} from "../config/searchConfig.ts";
import { DIALOGUE_SEARCH_MAX_RESULTS } from "../config/viewerConfig.ts";
import type { ParserWorkerApi } from "./parserWorker.ts";
import {
  type DialogueSearchResult,
  type ParseProgressPayload,
  type ParseWorkerClientRequest,
  type ParseWorkerClientResult,
} from "./workerProtocol.ts";

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
  Math.min(
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 1,
    8,
  ),
);

const workerPool: (Worker | null)[] = new Array(MAX_POOL_SIZE).fill(null);
const apiPool: (Remote<ParserWorkerApi> | null)[] = new Array(MAX_POOL_SIZE)
  .fill(null);
const idleTimeoutIds: (number | null)[] = new Array(MAX_POOL_SIZE).fill(null);
let isWorkerSpawningFailed = false;

export function areWorkersSupported(): boolean {
  if (typeof globalThis.Worker === "undefined") return false;
  if (isWorkerSpawningFailed) return false;
  return true;
}

function clearIdleTimeout(index: number) {
  const id = idleTimeoutIds[index];
  if (id !== null) {
    clearTimeout(id);
    idleTimeoutIds[index] = null;
  }
}

function resetIdleTimeout(index: number) {
  clearIdleTimeout(index);
  if (index === 0) return; // Keep primary worker 0 active for search queries
  idleTimeoutIds[index] = setTimeout(() => {
    terminateWorker(index);
  }, 30000) as unknown as number; // 30s idle timeout
}

function getWorker(index: number): Worker {
  if (index < 0 || index >= MAX_POOL_SIZE) {
    throw new Error(
      `Worker index ${index} out of bounds [0, ${MAX_POOL_SIZE})`,
    );
  }
  clearIdleTimeout(index);
  let w = workerPool[index];
  if (!w) {
    try {
      w = new Worker(new URL("./parserWorker.ts", import.meta.url), {
        type: "module",
      });
      workerPool[index] = w;
      apiPool[index] = wrap<ParserWorkerApi>(w);
    } catch (err) {
      isWorkerSpawningFailed = true;
      throw err;
    }
  }
  return w;
}

function getWorkerApi(index: number): Remote<ParserWorkerApi> {
  getWorker(index);
  return apiPool[index]!;
}

function terminateWorker(index: number): void {
  if (index < 0 || index >= MAX_POOL_SIZE) return;
  clearIdleTimeout(index);
  const w = workerPool[index];
  if (w) {
    try {
      w.terminate();
    } catch {
      // Ignore worker termination errors
    }
    workerPool[index] = null;
    apiPool[index] = null;
  }
}

/** Returns the effective pool size (at least 1). */
function getPoolSize(): number {
  return MAX_POOL_SIZE;
}

function hashToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
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
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function computeFileCacheKeys(
  files: ParseWorkerClientRequest["files"],
): Promise<string[]> {
  if (!globalThis.crypto?.subtle) {
    return files.map((file) => {
      const identity = file.relativePath ?? file.name;
      const contentStr = typeof file.content === "string"
        ? file.content
        : new TextDecoder("utf-8").decode(file.content);
      return `${identity}:${contentStr.length}:${simpleStringHash(contentStr)}`;
    });
  }

  return Promise.all(
    files.map(async (file) => {
      const data = typeof file.content === "string"
        ? textEncoder.encode(file.content)
        : file.content;
      const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
      return `${file.relativePath ?? file.name}:${hashToHex(digest)}`;
    }),
  );
}

let activeSessionId: string | null = null;
let fallbackAccumulatedState = createGraphState();
let fallbackDialogueSearchDocs: DialogueSearchDocument[] = [];
let fallbackDialogueSearchMiniSearch:
  | MiniSearch<DialogueSearchDocument>
  | null = null;

function fallbackBuildDialogueSearchIndex(
  nodes: { id: string; label: string; dialogueLines?: string[] }[],
) {
  fallbackDialogueSearchDocs = [];
  for (const node of nodes) {
    if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
    for (let idx = 0; idx < node.dialogueLines.length; idx += 1) {
      fallbackDialogueSearchDocs.push({
        id: `${node.id}::${idx + 1}`,
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }
  if (fallbackDialogueSearchDocs.length > 0) {
    fallbackDialogueSearchMiniSearch = new MiniSearch(
      DIALOGUE_MINISEARCH_OPTIONS,
    );
    fallbackDialogueSearchMiniSearch.addAll(fallbackDialogueSearchDocs);
  } else {
    fallbackDialogueSearchMiniSearch = null;
  }
}

async function parseRenpyFilesFallback(
  request: ParseWorkerClientRequest,
): Promise<ParseWorkerClientResult> {
  const {
    files,
    resetActiveGraph,
    isFinalChunk,
    captureDialogueLines,
    parserVariant,
    screenActionRules,
    onProgress,
    onPartialResult,
    signal,
  } = request;

  if (signal?.aborted) {
    throw new DOMException("Parsing cancelled", "AbortError");
  }

  // Convert any Uint8Array contents to strings
  for (const file of files) {
    if (file.content instanceof Uint8Array) {
      file.content = new TextDecoder("utf-8").decode(file.content);
    }
  }

  try {
    if (resetActiveGraph) {
      fallbackAccumulatedState = createGraphState();
      fallbackDialogueSearchDocs = [];
      fallbackDialogueSearchMiniSearch = null;
    }

    for (let idx = 0; idx < files.length; idx += 1) {
      if (signal?.aborted) {
        throw new DOMException("Parsing cancelled", "AbortError");
      }
      const tokenized = await tokenizeOneFile(files[idx], {}, idx);
      processTokenizedFile(fallbackAccumulatedState, tokenized, {
        captureDialogueLines: captureDialogueLines !== false,
        parserVariant,
        screenActionRules,
      });

      onProgress?.({
        doneFiles: idx + 1,
        totalFiles: files.length,
        currentFile: files[idx].relativePath ?? files[idx].name,
      });
    }

    if (isFinalChunk) {
      finalizeRoles(fallbackAccumulatedState);
      fallbackBuildDialogueSearchIndex(fallbackAccumulatedState.nodes);
    }

    const result: ParseWorkerClientResult = {
      nodes: fallbackAccumulatedState.nodes,
      edges: fallbackAccumulatedState.edges,
      diagnostics: fallbackAccumulatedState.diagnostics.length > 0
        ? fallbackAccumulatedState.diagnostics
        : undefined,
    };

    if (!isFinalChunk) {
      onPartialResult?.(result);
    }

    return result;
  } catch (error) {
    if (resetActiveGraph || isFinalChunk) {
      fallbackAccumulatedState = createGraphState();
    }
    throw error;
  }
}

export function parseRenpyFilesInWorker(
  request: ParseWorkerClientRequest,
): Promise<ParseWorkerClientResult> {
  if (!areWorkersSupported()) {
    return parseRenpyFilesFallback(request);
  }

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

  // Run parallel chunk parsing only for projects with >= 20 files
  const shouldRunParallel = files.length >= 20 && getPoolSize() > 1 &&
    maxParallelFiles !== 1;

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

  const requestId = ++requestCounter;
  if (resetActiveGraph || !activeSessionId) {
    activeSessionId = String(requestCounter);
  }
  const sessionId = activeSessionId;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Parsing cancelled", "AbortError"));
  }

  return new Promise<ParseWorkerClientResult>((resolve, reject) => {
    let cancelTimeout: number | undefined;

    const onAbort = () => {
      try {
        getWorkerApi(0).cancel(requestId);
      } catch {
        // Ignore
      }
      reject(new DOMException("Parsing cancelled", "AbortError"));

      // 3-second failsafe timeout: if worker is hung, terminate it
      cancelTimeout = setTimeout(() => {
        terminateWorker(0);
      }, 3000) as unknown as number;
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let progressProxy: Parameters<Remote<ParserWorkerApi>["parse"]>[3] =
      undefined;

    computeFileCacheKeys(files)
      .then((fileCacheKeys) => {
        if (signal?.aborted) {
          throw new DOMException("Parsing cancelled", "AbortError");
        }

        if (onProgress) {
          progressProxy = proxy((progress: ParseProgressPayload) =>
            onProgress(progress)
          );
        }

        const transfers: Transferable[] = [];
        for (const file of files) {
          if (file.content instanceof Uint8Array) {
            transfers.push(file.content.buffer);
          }
        }

        const filesArg = transfers.length > 0
          ? transfer(files, transfers)
          : files;

        return getWorkerApi(0).parse(
          requestId,
          filesArg,
          {
            sessionId,
            fileCacheKeys,
            wantsProgress: !!onProgress,
            maxParallelFiles,
            captureDialogueLines,
            parserVariant,
            screenActionRules,
            appendToActiveGraph,
            resetActiveGraph,
            isFinalChunk,
          },
          progressProxy,
        );
      })
      .then((result: ParseWorkerClientResult) => {
        signal?.removeEventListener("abort", onAbort);
        if (cancelTimeout !== undefined) {
          clearTimeout(cancelTimeout);
        }
        resetIdleTimeout(0);

        if (signal?.aborted) {
          reject(new DOMException("Parsing cancelled", "AbortError"));
        } else {
          if (!isFinalChunk && onPartialResult) {
            onPartialResult(result);
          }
          resolve(result);
        }
      })
      .catch((error) => {
        signal?.removeEventListener("abort", onAbort);
        if (cancelTimeout !== undefined) {
          clearTimeout(cancelTimeout);
        }
        resetIdleTimeout(0);

        if (!signal?.aborted) {
          reject(error);
        }
      });
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
  if (!areWorkersSupported()) {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Search cancelled", "AbortError"));
    }
    const maxRes = Math.max(
      1,
      Math.min(maxResults ?? 500, DIALOGUE_SEARCH_MAX_RESULTS),
    );
    const allowedIds = nodeIds ? new Set(nodeIds) : null;
    let results: DialogueSearchResult[] = [];
    if (fallbackDialogueSearchMiniSearch) {
      const rawResults = fallbackDialogueSearchMiniSearch.search(query);
      const filtered = allowedIds
        ? rawResults.filter((entry) => allowedIds.has(entry.nodeId))
        : rawResults;
      results = filtered.slice(0, maxRes).map((entry) => ({
        nodeId: entry.nodeId,
        nodeLabel: entry.nodeLabel,
        lineIndex: entry.lineIndex,
        lineText: entry.lineText,
      })) as DialogueSearchResult[];
    }
    return Promise.resolve(results);
  }

  const requestId = ++requestCounter;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Search cancelled", "AbortError"));
  }

  return new Promise<DialogueSearchResult[]>((resolve, reject) => {
    const onAbort = () => {
      getWorkerApi(0).cancel(requestId);
      reject(new DOMException("Search cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    getWorkerApi(0).search(requestId, query, {
      sessionId: activeSessionId || "default",
      nodeIds,
      maxResults,
    })
      .then((results) => {
        signal?.removeEventListener("abort", onAbort);
        resetIdleTimeout(0);
        if (signal?.aborted) {
          reject(new DOMException("Search cancelled", "AbortError"));
        } else {
          resolve(results);
        }
      })
      .catch((err) => {
        signal?.removeEventListener("abort", onAbort);
        resetIdleTimeout(0);
        reject(err);
      });
  });
}

// ─── Parallel Chunk Parsing ───────────────────────────────────────────────────

export interface ParseChunkRequest {
  files: ParseWorkerClientRequest["files"];
  captureDialogueLines?: boolean;
  parserVariant?: ParseWorkerClientRequest["parserVariant"];
  screenActionRules?: ParseWorkerClientRequest["screenActionRules"];
  signal?: AbortSignal;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
}

export interface ParseChunkResult {
  nodes: ParseWorkerClientResult["nodes"];
  edges: ParseWorkerClientResult["edges"];
  diagnostics?: ParseWorkerClientResult["diagnostics"];
}

interface InternalChunkResult extends ParseChunkResult {
  pendingCallReturns: Array<{ returnTargetId: string; callTargetId: string }>;
  hasReliableReturnInLabel: string[];
  globalScreens: string[];
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
}

export function parseChunksInParallel({
  files,
  captureDialogueLines,
  parserVariant,
  screenActionRules,
  signal,
  appendToActiveGraph,
  resetActiveGraph,
  isFinalChunk,
}: ParseChunkRequest): Promise<ParseChunkResult> {
  if (resetActiveGraph || !activeSessionId) {
    activeSessionId = String(requestCounter + 1);
  }
  const sessionId = activeSessionId;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Parsing cancelled", "AbortError"));
  }

  const poolSize = getPoolSize();
  const useWorkerIndices: number[] = [];
  if (poolSize <= 2) {
    for (let i = 0; i < poolSize; i++) useWorkerIndices.push(i);
  } else {
    for (let i = 1; i < poolSize; i++) useWorkerIndices.push(i);
  }
  const workerCount = useWorkerIndices.length;

  const chunks: ParseWorkerClientRequest["files"][] = [];
  const chunkSize = Math.ceil(files.length / workerCount);
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }

  return computeFileCacheKeys(files).then((allCacheKeys) => {
    if (signal?.aborted) {
      throw new DOMException("Parsing cancelled", "AbortError");
    }

    const chunkPromises = chunks.map((chunkFiles, chunkIdx) => {
      const workerIdx = useWorkerIndices[chunkIdx % workerCount]!;
      const chunkRequestId = ++requestCounter;
      const cacheKeyOffset = chunkIdx * chunkSize;
      const chunkCacheKeys = allCacheKeys.slice(
        cacheKeyOffset,
        cacheKeyOffset + chunkFiles.length,
      );

      return new Promise<InternalChunkResult>((resolve, reject) => {
        let cancelTimeout: number | undefined;

        const onAbort = () => {
          try {
            getWorkerApi(workerIdx).cancel(chunkRequestId);
          } catch {
            // Ignore
          }
          reject(new DOMException("Parsing cancelled", "AbortError"));

          cancelTimeout = setTimeout(() => {
            terminateWorker(workerIdx);
          }, 3000) as unknown as number;
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const transfers: Transferable[] = [];
        for (const file of chunkFiles) {
          if (file.content instanceof Uint8Array) {
            transfers.push(file.content.buffer);
          }
        }

        const chunkFilesArg = transfers.length > 0
          ? transfer(chunkFiles, transfers)
          : chunkFiles;

        getWorkerApi(workerIdx).parseChunk(chunkRequestId, chunkFilesArg, {
          fileCacheKeys: chunkCacheKeys,
          captureDialogueLines,
          parserVariant,
          screenActionRules,
        })
          .then((chunkResult) => {
            signal?.removeEventListener("abort", onAbort);
            if (cancelTimeout !== undefined) {
              clearTimeout(cancelTimeout);
            }
            resetIdleTimeout(workerIdx);

            if (signal?.aborted) {
              reject(new DOMException("Parsing cancelled", "AbortError"));
            } else {
              resolve(chunkResult as InternalChunkResult);
            }
          })
          .catch((err) => {
            signal?.removeEventListener("abort", onAbort);
            if (cancelTimeout !== undefined) {
              clearTimeout(cancelTimeout);
            }
            resetIdleTimeout(workerIdx);

            if (!signal?.aborted) {
              reject(err);
            }
          });
      });
    });

    return Promise.all(chunkPromises).then((results) => {
      if (signal?.aborted) {
        throw new DOMException("Parsing cancelled", "AbortError");
      }

      const mergedNodes = results.flatMap((r) => r.nodes);
      const mergedEdges = results.flatMap((r) => r.edges);
      const mergedDiagnostics = results.flatMap((r) => r.diagnostics ?? []);
      const mergedPendingCallReturns = results.flatMap((r) =>
        r.pendingCallReturns
      );

      const mergedHasReliableReturnInLabel = Array.from(
        new Set(results.flatMap((r) => r.hasReliableReturnInLabel)),
      );
      const mergedGlobalScreens = Array.from(
        new Set(results.flatMap((r) => r.globalScreens)),
      );

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

      const finalizeRequestId = ++requestCounter;

      return new Promise<ParseChunkResult>((resolve, reject) => {
        let cancelTimeout: number | undefined;

        const onAbortFinalize = () => {
          try {
            getWorkerApi(0).cancel(finalizeRequestId);
          } catch {
            // Ignore
          }
          reject(new DOMException("Parsing cancelled", "AbortError"));

          cancelTimeout = setTimeout(() => {
            terminateWorker(0);
          }, 3000) as unknown as number;
        };
        signal?.addEventListener("abort", onAbortFinalize, { once: true });

        getWorkerApi(0).finalize(finalizeRequestId, {
          sessionId,
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
        })
          .then((finalResult) => {
            signal?.removeEventListener("abort", onAbortFinalize);
            if (cancelTimeout !== undefined) {
              clearTimeout(cancelTimeout);
            }
            resetIdleTimeout(0);

            if (signal?.aborted) {
              reject(new DOMException("Parsing cancelled", "AbortError"));
            } else {
              resolve(finalResult);
            }
          })
          .catch((err) => {
            signal?.removeEventListener("abort", onAbortFinalize);
            if (cancelTimeout !== undefined) {
              clearTimeout(cancelTimeout);
            }
            resetIdleTimeout(0);

            if (!signal?.aborted) {
              reject(err);
            }
          });
      });
    });
  });
}

export function getWorkerPoolSize(): number {
  return getPoolSize();
}
