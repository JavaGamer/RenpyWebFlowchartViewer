import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerResponseMessage,
  type ParseRequestMessage,
  type CancelRequestMessage,
  type ParseWorkerClientRequest,
  type ParseWorkerClientResult,
  type SearchRequestMessage,
  type DialogueSearchResult,
} from './workerProtocol';let requestCounter = 0;
const textEncoder = new TextEncoder();

let worker: Worker | null = null;

function getParserWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../parserWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
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

async function computeFileCacheKeys(files: Array<{ name: string; content: string }>): Promise<string[]> {
  if (!globalThis.crypto?.subtle) {
    return files.map((file) => `${file.name}:${file.content.length}:${simpleStringHash(file.content)}`);
  }

  const digests = await Promise.all(
    files.map(async (file) => {
      const data = textEncoder.encode(file.content);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      return `${file.name}:${hashToHex(digest)}`;
    }),
  );
  return digests;
}

export function parseRenpyFilesInWorker({
  files,
  appendToActiveGraph,
  resetActiveGraph,
  isFinalChunk,
  captureDialogueLines,
  onProgress,
  onPartialResult,
  signal,
  maxParallelFiles,
}: ParseWorkerClientRequest): Promise<ParseWorkerClientResult> {
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
      if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) return;
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
          const partialResult = message.warnings
            ? { nodes: message.nodes, edges: message.edges, warnings: message.warnings }
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
        if (message.warnings) {
          resolve({ nodes: message.nodes, edges: message.edges, warnings: message.warnings });
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
      if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) return;
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
    parserWorker.postMessage(searchMessage);  });
}
