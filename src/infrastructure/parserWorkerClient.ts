import { proxy, releaseProxy, type Remote, transfer, wrap } from "comlink";
import { directParseService } from "./directParseService.ts";
import type { ParserWorkerApi } from "./parserWorker.ts";
import {
  type DialogueSearchResult,
  type NodeDetailsPayload,
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
const cancelTimeoutIds: (number | null)[] = new Array(MAX_POOL_SIZE).fill(null);
let isWorkerSpawningFailed = false;

export function setWorkerSpawningFailedForTesting(failed: boolean): void {
  isWorkerSpawningFailed = failed;
}

export function areWorkersSupported(): boolean {
  if (typeof globalThis.Worker === "undefined") return false;
  if (isWorkerSpawningFailed) return false;
  if (
    typeof window !== "undefined" &&
    window.location?.hostname === "localhost" &&
    typeof (window as unknown as { __vitest_worker__?: unknown })
        .__vitest_worker__ !== "undefined" &&
    globalThis.Worker.name !== "MockWorker"
  ) {
    return false;
  }
  return true;
}

function clearIdleTimeout(index: number) {
  const id = idleTimeoutIds[index];
  if (id !== null) {
    clearTimeout(id);
    idleTimeoutIds[index] = null;
  }
}

function clearCancelTimeout(index: number) {
  const id = cancelTimeoutIds[index];
  if (id !== null) {
    clearTimeout(id);
    cancelTimeoutIds[index] = null;
  }
}

function setCancelTimeout(index: number, delayMs = 3000) {
  clearCancelTimeout(index);
  cancelTimeoutIds[index] = setTimeout(() => {
    cancelTimeoutIds[index] = null;
    terminateWorker(index);
  }, delayMs) as unknown as number;
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
  clearCancelTimeout(index);
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
  clearCancelTimeout(index);
  const p = apiPool[index];
  if (p) {
    try {
      p[releaseProxy]();
    } catch {
      // Ignore proxy release error
    }
    apiPool[index] = null;
  }
  const w = workerPool[index];
  if (w) {
    try {
      w.terminate();
    } catch {
      // Ignore worker termination errors
    }
    workerPool[index] = null;
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

  return await Promise.all(
    files.map(async (file) => {
      const data = typeof file.content === "string"
        ? textEncoder.encode(file.content)
        : file.content;
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        data as unknown as BufferSource,
      );
      return `${file.relativePath ?? file.name}:${hashToHex(digest)}`;
    }),
  );
}

let activeSessionId: string | null = null;

export function parseRenpyFilesInWorker(
  request: ParseWorkerClientRequest,
): Promise<ParseWorkerClientResult> {
  if (!areWorkersSupported()) {
    return directParseService.parse(request);
  }

  const {
    files,
    appendToActiveGraph,
    resetActiveGraph,
    isFinalChunk,
    captureDialogueLines,
    deferDetails,
    parserVariant,
    customVariantPlugins,
    screenActionRules,
    onProgress,
    onPartialResult,
    signal,
    maxParallelFiles,
  } = request;

  const requestId = ++requestCounter;
  if (resetActiveGraph || !activeSessionId) {
    activeSessionId = String(requestCounter);
  }
  const sessionId = activeSessionId;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Parsing cancelled", "AbortError"));
  }

  return new Promise<ParseWorkerClientResult>((resolve, reject) => {
    const onAbort = () => {
      try {
        getWorkerApi(0).cancel(requestId);
      } catch {
        // Ignore
      }
      reject(new DOMException("Parsing cancelled", "AbortError"));
      setCancelTimeout(0, 3000);
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

        const transfers = new Set<Transferable>();
        for (const file of files) {
          if (file.content instanceof Uint8Array) {
            transfers.add(file.content.buffer);
          }
        }
        const transferList = Array.from(transfers);

        const filesArg = transferList.length > 0
          ? transfer(files, transferList)
          : files;

        const cleanup = () => {
          if (
            progressProxy &&
            (progressProxy as unknown as { [releaseProxy]?: () => void })[
              releaseProxy
            ]
          ) {
            try {
              (progressProxy as unknown as { [releaseProxy]: () => void })[
                releaseProxy
              ]();
            } catch {
              // Ignore proxy release error
            }
          }
        };

        return getWorkerApi(0).parse(
          requestId,
          filesArg,
          {
            sessionId,
            fileCacheKeys,
            wantsProgress: !!onProgress,
            maxParallelFiles,
            captureDialogueLines,
            deferDetails,
            parserVariant,
            customVariantPlugins,
            screenActionRules,
            projectMediaFiles: request.projectMediaFiles,
            maxCallStackDepth: request.maxCallStackDepth,
            pruneDeadEndDecisions: request.pruneDeadEndDecisions,
            appendToActiveGraph,
            resetActiveGraph,
            isFinalChunk,
          },
          progressProxy,
        )
          .then((res) => {
            cleanup();
            return res;
          })
          .catch((err) => {
            cleanup();
            throw err;
          });
      })
      .then((result: ParseWorkerClientResult) => {
        signal?.removeEventListener("abort", onAbort);
        clearCancelTimeout(0);
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
        clearCancelTimeout(0);
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
    return directParseService.searchDialogueLines({
      query,
      nodeIds,
      maxResults,
      signal,
    });
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
  deferDetails?: boolean;
  parserVariant?: ParseWorkerClientRequest["parserVariant"];
  customVariantPlugins?: ParseWorkerClientRequest["customVariantPlugins"];
  screenActionRules?: ParseWorkerClientRequest["screenActionRules"];
  projectMediaFiles?: ParseWorkerClientRequest["projectMediaFiles"];
  maxCallStackDepth?: number;
  pruneDeadEndDecisions?: boolean;
  signal?: AbortSignal;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
}

export interface ParseChunkResult {
  nodes: ParseWorkerClientResult["nodes"];
  edges: ParseWorkerClientResult["edges"];
  diagnostics?: ParseWorkerClientResult["diagnostics"];
  translations?: ParseWorkerClientResult["translations"];
  availableLanguages?: ParseWorkerClientResult["availableLanguages"];
}

export function parseChunksInParallel(
  request: ParseChunkRequest,
): Promise<ParseChunkResult> {
  return parseRenpyFilesInWorker(request as ParseWorkerClientRequest);
}

export function tokenizeFilesInWorker(
  files: ParseWorkerClientRequest["files"],
  signal?: AbortSignal,
): Promise<{ fileCacheKeys: string[]; elapsedMs: number }> {
  if (!areWorkersSupported()) {
    return computeFileCacheKeys(files).then((keys) => ({
      fileCacheKeys: keys,
      elapsedMs: 0,
    }));
  }

  const requestId = ++requestCounter;
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Tokenize cancelled", "AbortError"));
  }

  return computeFileCacheKeys(files).then((fileCacheKeys) => {
    if (signal?.aborted) {
      throw new DOMException("Tokenize cancelled", "AbortError");
    }

    const transfers = new Set<Transferable>();
    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        transfers.add(file.content.buffer);
      }
    }
    const transferList = Array.from(transfers);

    const filesArg = transferList.length > 0
      ? transfer(files, transferList)
      : files;

    return getWorkerApi(0).tokenize(requestId, filesArg, { fileCacheKeys });
  });
}

export function extractNodeDetailsInWorker(
  nodeIds: string[],
  sessionId?: string,
  signal?: AbortSignal,
): Promise<Record<string, NodeDetailsPayload>> {
  if (!areWorkersSupported()) {
    return directParseService.extractNodeDetails(nodeIds, sessionId, signal);
  }

  const requestId = ++requestCounter;
  if (signal?.aborted) {
    return Promise.reject(
      new DOMException("Extract details cancelled", "AbortError"),
    );
  }

  return getWorkerApi(0).extractDetails(requestId, nodeIds, {
    sessionId: sessionId || activeSessionId || "default",
  });
}

export function getWorkerPoolSize(): number {
  return getPoolSize();
}
