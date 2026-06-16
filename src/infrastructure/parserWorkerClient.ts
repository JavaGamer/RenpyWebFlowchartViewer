/* eslint-disable @typescript-eslint/no-explicit-any */
import { proxy, type Remote, wrap } from "comlink";
import MiniSearch from "minisearch";
import { createGraphState } from "../parser/pipelineState.ts";
import { processTokenizedFile, tokenizeOneFile } from "../parser/filePipeline.ts";
import { finalizeRoles } from "../parser/roleFinalization.ts";
import {
  DIALOGUE_MINISEARCH_OPTIONS,
  type DialogueSearchDocument,
} from "../config/searchConfig.ts";
import { DIALOGUE_SEARCH_MAX_RESULTS } from "../config/viewerConfig.ts";
import type { ParserWorkerApi } from "./parserWorker.ts";
import {
  type DialogueSearchResult,
  type ParseWorkerClientRequest,
  type ParseWorkerClientResult,
} from "./workerProtocol.ts";

class SyncPromise<T> {
  private value: any;
  private error: any;
  private state: "pending" | "resolved" | "rejected" = "pending";
  private resolveCallbacks: Array<(v: any) => void> = [];
  private rejectCallbacks: Array<(e: any) => void> = [];

  constructor(
    executor: (resolve: (v: T) => void, reject: (e: any) => void) => void,
  ) {
    const resolve = (val: any) => {
      if (this.state !== "pending") return;
      this.state = "resolved";
      this.value = val;
      for (const cb of this.resolveCallbacks) cb(val);
    };
    const reject = (err: any) => {
      if (this.state !== "pending") return;
      this.state = "rejected";
      this.error = err;
      for (const cb of this.rejectCallbacks) cb(err);
    };
    try {
      executor(resolve, reject);
    } catch (e) {
      reject(e);
    }
  }

  then<U>(
    onResolve: (v: T) => any,
    onReject?: (e: any) => any,
  ): SyncPromise<U> {
    if (this.state === "resolved") {
      try {
        const nextVal = onResolve(this.value);
        if (nextVal && typeof (nextVal as any).then === "function") {
          return nextVal as any;
        }
        return SyncPromise.resolve(nextVal) as any;
      } catch (e) {
        return SyncPromise.reject(e) as any;
      }
    }
    if (this.state === "rejected") {
      if (onReject) {
        try {
          const nextVal = onReject(this.error);
          if (nextVal && typeof (nextVal as any).then === "function") {
            return nextVal as any;
          }
          return SyncPromise.resolve(nextVal) as any;
        } catch (e) {
          return SyncPromise.reject(e) as any;
        }
      }
      return SyncPromise.reject(this.error) as any;
    }
    return new SyncPromise<U>((resolve, reject) => {
      this.resolveCallbacks.push((val) => {
        try {
          const res = onResolve(val);
          if (res && typeof (res as any).then === "function") {
            (res as any).then(resolve, reject);
          } else {
            resolve(res as any);
          }
        } catch (e) {
          reject(e);
        }
      });
      if (onReject) {
        this.rejectCallbacks.push((err) => {
          try {
            const res = onReject(err);
            if (res && typeof (res as any).then === "function") {
              (res as any).then(resolve, reject);
            } else {
              resolve(res as any);
            }
          } catch (e) {
            reject(e);
          }
        });
      } else {
        this.rejectCallbacks.push(reject);
      }
    });
  }

  catch<U>(onReject: (e: any) => any): SyncPromise<T | U> {
    return this.then((v) => v, onReject) as any;
  }

  static resolve<V>(val: V): SyncPromise<V> {
    return new SyncPromise<V>((resolve) => resolve(val));
  }

  static reject(err: any): SyncPromise<any> {
    return new SyncPromise<any>((_, reject) => reject(err));
  }
}

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
let isWorkerSpawningFailed = false;

export function areWorkersSupported(): boolean {
  if (typeof globalThis.Worker === "undefined") return false;
  if (isWorkerSpawningFailed) return false;
  return true;
}

function getWorker(index: number): Worker {
  if (index < 0 || index >= MAX_POOL_SIZE) {
    throw new Error(
      `Worker index ${index} out of bounds [0, ${MAX_POOL_SIZE})`,
    );
  }
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

function computeFileCacheKeys(
  files: ParseWorkerClientRequest["files"],
): SyncPromise<string[]> {
  if (!globalThis.crypto?.subtle) {
    const keys = files.map((file) => {
      const identity = file.relativePath ?? file.name;
      return `${identity}:${file.content.length}:${
        simpleStringHash(file.content)
      }`;
    });
    return SyncPromise.resolve(keys);
  }

  return new SyncPromise<string[]>((resolve, reject) => {
    Promise.all(
      files.map((file) => {
        const data = textEncoder.encode(file.content);
        return globalThis.crypto.subtle.digest("SHA-256", data).then(
          (digest) => {
            return `${file.relativePath ?? file.name}:${hashToHex(digest)}`;
          },
        );
      }),
    )
      .then(resolve)
      .catch(reject);
  });
}

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

  const shouldRunParallel = files.length > 1 && getPoolSize() > 1 &&
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
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Parsing cancelled", "AbortError"));
  }

  return new SyncPromise<ParseWorkerClientResult>((resolve, reject) => {
    const onAbort = () => {
      getWorkerApi(0).cancel(requestId);
      reject(new DOMException("Parsing cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let progressProxy: any;

    computeFileCacheKeys(files)
      .then((fileCacheKeys) => {
        if (signal?.aborted) {
          throw new DOMException("Parsing cancelled", "AbortError");
        }

        if (onProgress) {
          progressProxy = proxy((progress: any) => onProgress(progress));
        }

        return getWorkerApi(0).parse(
          requestId,
          files,
          {
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
      .then((result: any) => {
        signal?.removeEventListener("abort", onAbort);

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
        reject(error);
      });
  }) as unknown as Promise<ParseWorkerClientResult>;
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
      nodeIds,
      maxResults,
    })
      .then((results) => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          reject(new DOMException("Search cancelled", "AbortError"));
        } else {
          resolve(results);
        }
      })
      .catch((err) => {
        signal?.removeEventListener("abort", onAbort);
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
        const onAbort = () => {
          getWorkerApi(workerIdx).cancel(chunkRequestId);
          reject(new DOMException("Parsing cancelled", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        getWorkerApi(workerIdx).parseChunk(chunkRequestId, chunkFiles, {
          fileCacheKeys: chunkCacheKeys,
          captureDialogueLines,
          parserVariant,
          screenActionRules,
        })
          .then((chunkResult) => {
            signal?.removeEventListener("abort", onAbort);
            if (signal?.aborted) {
              reject(new DOMException("Parsing cancelled", "AbortError"));
            } else {
              resolve(chunkResult as InternalChunkResult);
            }
          })
          .catch((err) => {
            signal?.removeEventListener("abort", onAbort);
            reject(err);
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
        const onAbortFinalize = () => {
          getWorkerApi(0).cancel(finalizeRequestId);
          reject(new DOMException("Parsing cancelled", "AbortError"));
        };
        signal?.addEventListener("abort", onAbortFinalize, { once: true });

        getWorkerApi(0).finalize(finalizeRequestId, {
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
            if (signal?.aborted) {
              reject(new DOMException("Parsing cancelled", "AbortError"));
            } else {
              resolve(finalResult);
            }
          })
          .catch((err) => {
            signal?.removeEventListener("abort", onAbortFinalize);
            reject(err);
          });
      });
    });
  }) as unknown as Promise<ParseChunkResult>;
}

export function getWorkerPoolSize(): number {
  return getPoolSize();
}
