import { proxy, releaseProxy, type Remote, transfer, wrap } from "comlink";
import MiniSearch from "minisearch";
import {
  compareFiles,
  type FlowAsset,
  type FlowNode,
} from "../domain/index.ts";
import {
  createGraphState,
  extractNodeDetailsFromTokens,
  finalizeRoles,
  type InitVariableDescriptor,
  type ParseGraphState,
  type ParseInputFile,
  preParseInitialization,
  processTokenizedFile,
  RENPY_TL_PATH_REGEX,
  scanTranslations,
  type TextDocument,
  tokenizeOneFile,
  type TokenTree,
  type VariableMutation,
  type VariableValue,
} from "../parser/index.ts";
import {
  DIALOGUE_MINISEARCH_OPTIONS,
  type DialogueSearchDocument,
} from "../config/searchConfig.ts";
import { DIALOGUE_SEARCH_MAX_RESULTS } from "../config/viewerConfig.ts";
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

interface FallbackState {
  graphState: ReturnType<typeof createGraphState>;
  rawFilesByChapter: Map<string, ParseInputFile>;
  docs: DialogueSearchDocument[];
  miniSearch: MiniSearch<DialogueSearchDocument> | null;
}

let activeSessionId: string | null = null;
let activeFallbackState: FallbackState | null = null;

function getActiveFallbackState(reset = false): FallbackState {
  if (reset || !activeFallbackState) {
    activeFallbackState = {
      graphState: createGraphState(),
      rawFilesByChapter: new Map(),
      docs: [],
      miniSearch: null,
    };
  }
  return activeFallbackState;
}

async function fallbackBuildDialogueSearchIndex(
  fallbackState: FallbackState,
  nodes: FlowNode[],
  deferUnhydrated = false,
) {
  fallbackState.docs = [];
  if (!deferUnhydrated) {
    const unhydrated = nodes.filter((n) =>
      n.dialogueCount > 0 && !n.dialogueLines
    );
    if (unhydrated.length > 0 && fallbackState.rawFilesByChapter.size > 0) {
      const tokenizedFilesByChapter = new Map<
        string,
        { document: TextDocument; tokenTree: TokenTree }
      >();
      for (
        const [chapter, rawFile] of fallbackState.rawFilesByChapter.entries()
      ) {
        const tokenized = await tokenizeOneFile(rawFile);
        tokenizedFilesByChapter.set(chapter, {
          document: tokenized.document,
          tokenTree: tokenized.tokenTree,
        });
      }
      const extracted = extractNodeDetailsFromTokens(
        unhydrated,
        tokenizedFilesByChapter,
      );
      for (const [id, payload] of Object.entries(extracted)) {
        const node = fallbackState.graphState.nodeMap.get(id);
        if (node) {
          if (payload.dialogueLines) node.dialogueLines = payload.dialogueLines;
          if (payload.dialogueLineNums) {
            node.dialogueLineNums = payload.dialogueLineNums;
          }
          if (payload.audioAssetCues) {
            node.audioAssetCues = payload.audioAssetCues;
          }
          node.isDetailsLoaded = true;
        }
      }
    }
  }

  for (const node of nodes) {
    if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
    for (let idx = 0; idx < node.dialogueLines.length; idx += 1) {
      fallbackState.docs.push({
        id: `${node.id}:${idx}`,
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }
  if (fallbackState.docs.length > 0) {
    fallbackState.miniSearch = new MiniSearch(
      DIALOGUE_MINISEARCH_OPTIONS,
    );
    fallbackState.miniSearch.addAll(fallbackState.docs);
  } else {
    fallbackState.miniSearch = null;
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
    deferDetails,
    parserVariant,
    screenActionRules,
    onProgress,
    onPartialResult,
    signal,
  } = request;

  if (signal?.aborted) {
    throw new DOMException("Parsing cancelled", "AbortError");
  }

  const currentFallback = getActiveFallbackState(resetActiveGraph);
  if (request.projectMediaFiles) {
    currentFallback.graphState.projectMediaFiles = request.projectMediaFiles;
  }

  // Sort files deterministically
  files.sort(compareFiles);

  // Convert any Uint8Array contents to strings
  for (const file of files) {
    if (file.content instanceof Uint8Array) {
      file.content = new TextDecoder("utf-8").decode(file.content);
    }
    const chapterSource = file.relativePath ?? file.name;
    const chapter = chapterSource.replace(/\\/g, "/").replace(/\.rpy$/i, "");
    currentFallback.rawFilesByChapter.set(chapter, file);
  }

  if (resetActiveGraph || !currentFallback.graphState.initVariables?.size) {
    preParseInitialization(files, currentFallback.graphState);
  }

  if (request.maxCallStackDepth !== undefined) {
    currentFallback.graphState.maxCallStackDepth = request.maxCallStackDepth;
  }

  try {
    for (let idx = 0; idx < files.length; idx += 1) {
      if (signal?.aborted) {
        throw new DOMException("Parsing cancelled", "AbortError");
      }
      const tokenized = await tokenizeOneFile(files[idx], {}, idx);
      processTokenizedFile(currentFallback.graphState, tokenized, {
        captureDialogueLines: captureDialogueLines !== false,
        deferDetails,
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
      finalizeRoles(currentFallback.graphState);
      await fallbackBuildDialogueSearchIndex(
        currentFallback,
        currentFallback.graphState.nodes,
        Boolean(deferDetails || captureDialogueLines === false),
      );
    }

    const result: ParseWorkerClientResult = {
      nodes: currentFallback.graphState.nodes,
      edges: currentFallback.graphState.edges,
      diagnostics: currentFallback.graphState.diagnostics.length > 0
        ? currentFallback.graphState.diagnostics
        : undefined,
    };

    if (!isFinalChunk) {
      onPartialResult?.(result);
    }

    return result;
  } catch (error) {
    if (resetActiveGraph || isFinalChunk) {
      getActiveFallbackState(true);
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
    deferDetails,
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
      deferDetails,
      parserVariant,
      screenActionRules,
      projectMediaFiles: request.projectMediaFiles,
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
            deferDetails,
            parserVariant,
            screenActionRules,
            projectMediaFiles: request.projectMediaFiles,
            maxCallStackDepth: request.maxCallStackDepth,
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
    if (activeFallbackState?.miniSearch) {
      const rawResults = activeFallbackState.miniSearch.search(query);
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
  deferDetails?: boolean;
  parserVariant?: ParseWorkerClientRequest["parserVariant"];
  screenActionRules?: ParseWorkerClientRequest["screenActionRules"];
  projectMediaFiles?: ParseWorkerClientRequest["projectMediaFiles"];
  maxCallStackDepth?: number;
  signal?: AbortSignal;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
}

import type { PendingCallReturn } from "../parser/index.ts";

export interface ParseChunkResult {
  nodes: ParseWorkerClientResult["nodes"];
  edges: ParseWorkerClientResult["edges"];
  diagnostics?: ParseWorkerClientResult["diagnostics"];
  translations?: ParseWorkerClientResult["translations"];
  availableLanguages?: ParseWorkerClientResult["availableLanguages"];
}

interface InternalChunkResult extends ParseChunkResult {
  pendingCallReturns: PendingCallReturn[];
  hasReturnInLabel?: string[];
  hasReliableReturnInLabel: string[];
  calledLabels?: string[];
  calledFromMenuOptionTargets?: string[];
  globalScreens: string[];
  globalCharacters?: string[];
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
  initVariables?: Array<[string, InitVariableDescriptor]>;
  globalPersistentVariables?: Array<[string, VariableValue]>;
  globalLabelVariableLiteralTargets?: Array<[string, string]>;
  globalLabelVariableDictTargets?: Array<[string, Array<[string, string]>]>;
  globalLabelVariableListTargets?: Array<[string, string[]]>;
  nodeMutations?: Array<[string, VariableMutation[]]>;
  imageDefinitions?: Array<[string, string]>;
  assets?: FlowAsset[];
  allConditionalExpressions?: ParseGraphState["allConditionalExpressions"];
}

export function parseChunksInParallel({
  files,
  captureDialogueLines,
  deferDetails,
  parserVariant,
  screenActionRules,
  projectMediaFiles,
  maxCallStackDepth,
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

  // Sort files deterministically
  files.sort(compareFiles);

  for (const file of files) {
    if (file.content instanceof Uint8Array) {
      file.content = new TextDecoder("utf-8").decode(file.content);
    }
  }

  const poolSize = getPoolSize();
  const useWorkerIndices: number[] = [];
  if (poolSize <= 2) {
    for (let i = 0; i < poolSize; i++) useWorkerIndices.push(i);
  } else {
    for (let i = 1; i < poolSize; i++) useWorkerIndices.push(i);
  }
  const workerCount = useWorkerIndices.length;

  const scriptFiles: ParseInputFile[] = [];
  const translationFiles: ParseInputFile[] = [];

  for (const file of files) {
    const rawPath = file.relativePath ?? file.name;
    if (RENPY_TL_PATH_REGEX.test(rawPath)) {
      translationFiles.push(file);
    } else {
      scriptFiles.push(file);
    }
  }

  const effectiveScriptFiles = scriptFiles.length > 0 ? scriptFiles : files;
  const projectTranslations = translationFiles.length > 0
    ? scanTranslations(translationFiles)
    : undefined;

  const chunks: ParseWorkerClientRequest["files"][] = [];
  const chunkSize = Math.ceil(effectiveScriptFiles.length / workerCount);
  for (let i = 0; i < effectiveScriptFiles.length; i += chunkSize) {
    chunks.push(effectiveScriptFiles.slice(i, i + chunkSize));
  }

  return computeFileCacheKeys(effectiveScriptFiles).then((allCacheKeys) => {
    if (signal?.aborted) {
      throw new DOMException("Parsing cancelled", "AbortError");
    }

    const prePassStateGraph = createGraphState();
    preParseInitialization(effectiveScriptFiles, prePassStateGraph);

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

        try {
          getWorkerApi(workerIdx).parseChunk(chunkRequestId, chunkFilesArg, {
            fileCacheKeys: chunkCacheKeys,
            captureDialogueLines,
            deferDetails,
            parserVariant,
            screenActionRules,
            maxCallStackDepth,
            prePassState: {
              globalLabelVariableLiteralTargets: Array.from(
                prePassStateGraph.globalLabelVariableLiteralTargets.entries(),
              ),
              globalLabelVariableDictTargets: Array.from(
                prePassStateGraph.globalLabelVariableDictTargets.entries(),
              ).map(([k, v]) => [k, Array.from(v.entries())]),
              globalLabelVariableListTargets: Array.from(
                prePassStateGraph.globalLabelVariableListTargets.entries(),
              ),
              initVariables: prePassStateGraph.initVariables
                ? Array.from(prePassStateGraph.initVariables.entries())
                : undefined,
              globalPersistentVariables:
                prePassStateGraph.globalPersistentVariables
                  ? Array.from(
                    prePassStateGraph.globalPersistentVariables.entries(),
                  )
                  : undefined,
              globalScreens: Array.from(prePassStateGraph.globalScreens),
              globalCharacters: Array.from(prePassStateGraph.globalCharacters),
              imageDefinitions: prePassStateGraph.imageDefinitions
                ? Array.from(prePassStateGraph.imageDefinitions.entries())
                : undefined,
              screenDefinitions: prePassStateGraph.screenDefinitions
                ? Array.from(prePassStateGraph.screenDefinitions.entries())
                : undefined,
            },
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
        } catch (err) {
          signal?.removeEventListener("abort", onAbort);
          if (cancelTimeout !== undefined) {
            clearTimeout(cancelTimeout);
          }
          reject(err);
        }
      });
    });

    return Promise.all(chunkPromises).then((results) => {
      if (signal?.aborted) {
        throw new DOMException("Parsing cancelled", "AbortError");
      }

      const seenLabelCounts = new Map<string, number>();
      const seenMenuCounts = new Map<string, number>();
      const seenDecisionCounts = new Map<string, number>();
      const chunkRemapMaps: Map<string, string>[] = [];
      const chunkEdgeRemapMaps: Map<string, string>[] = [];
      const mergedNodes: ParseWorkerClientResult["nodes"] = [];
      const mergedEdges: ParseWorkerClientResult["edges"] = [];

      const canonicalLabelNames = new Set<string>();
      for (const r of results) {
        for (const [name] of r.canonicalLabelIds) {
          canonicalLabelNames.add(name);
        }
      }

      for (const r of results) {
        const idRemapForChunk = new Map<string, string>();

        // First pass over chunk nodes: main labels, menus, decisions
        for (const node of r.nodes) {
          if (node.type === "LABEL") {
            const isSceneSplit = node.id.includes("__scene_");
            if (!isSceneSplit) {
              const rawLabel = node.label || node.id.split("__shadow_")[0]!;
              const currentCount = (seenLabelCounts.get(rawLabel) ?? 0) + 1;
              seenLabelCounts.set(rawLabel, currentCount);

              const expectedId = currentCount === 1
                ? rawLabel
                : `${rawLabel}__shadow_${currentCount}`;

              if (node.id !== expectedId) {
                idRemapForChunk.set(node.id, expectedId);
                node.id = expectedId;
              }

              if (currentCount > 1) {
                node.isShadowed = true;
                node.shadowOfId = rawLabel;
              }
            }
          } else if (node.type === "MENU") {
            const rawId = node.id.split("__dup_")[0]!;
            const currentCount = (seenMenuCounts.get(rawId) ?? 0) + 1;
            seenMenuCounts.set(rawId, currentCount);
            const expectedId = currentCount === 1
              ? rawId
              : `${rawId}__dup_${currentCount}`;
            if (node.id !== expectedId) {
              idRemapForChunk.set(node.id, expectedId);
              node.id = expectedId;
            }
          } else if (node.type === "DECISION") {
            const rawId = node.id.split("__dup_")[0]!;
            const currentCount = (seenDecisionCounts.get(rawId) ?? 0) + 1;
            seenDecisionCounts.set(rawId, currentCount);
            const expectedId = currentCount === 1
              ? rawId
              : `${rawId}__dup_${currentCount}`;
            if (node.id !== expectedId) {
              idRemapForChunk.set(node.id, expectedId);
              node.id = expectedId;
            }
            if (node.condition) {
              node.condition = {
                ...node.condition,
                decisionNodeId: node.id,
              };
            }
          }
        }

        // Second pass over chunk nodes: scene splits
        for (const node of r.nodes) {
          if (node.id.includes("__scene_")) {
            const sceneMatch = /^(.*?)__scene_(\d+)$/.exec(node.id);
            if (sceneMatch) {
              const parentId = sceneMatch[1]!;
              const sceneIndex = sceneMatch[2]!;
              if (idRemapForChunk.has(parentId)) {
                const remappedParentId = idRemapForChunk.get(parentId)!;
                const newSceneId = `${remappedParentId}__scene_${sceneIndex}`;
                idRemapForChunk.set(node.id, newSceneId);
                node.id = newSceneId;
              }
            }
          }
        }

        // Third pass over chunk nodes: update parentLabelId if parent label was remapped, then add node
        for (const node of r.nodes) {
          if (node.parentLabelId && idRemapForChunk.has(node.parentLabelId)) {
            node.parentLabelId = idRemapForChunk.get(node.parentLabelId)!;
          }
          mergedNodes.push(node);
        }

        const edgeIdRemapForChunk = new Map<string, string>();
        for (const edge of r.edges) {
          const oldEdgeId = edge.id;
          const oldSource = edge.source;
          const oldTarget = edge.target;
          let remapped = false;
          if (idRemapForChunk.has(edge.source)) {
            edge.source = idRemapForChunk.get(edge.source)!;
            remapped = true;
          }
          if (idRemapForChunk.has(edge.target)) {
            edge.target = idRemapForChunk.get(edge.target)!;
            remapped = true;
          }
          if (edge.condition && edge.condition.decisionNodeId) {
            const decisionRemapped = idRemapForChunk.get(
              edge.condition.decisionNodeId,
            );
            if (decisionRemapped) {
              edge.condition = {
                ...edge.condition,
                decisionNodeId: decisionRemapped,
              };
            }
          }
          if (edge.callContext) {
            const siteRemapped = idRemapForChunk.get(
              edge.callContext.callSiteId,
            );
            const returnRemapped = idRemapForChunk.get(
              edge.callContext.returnTargetId,
            );
            if (siteRemapped || returnRemapped) {
              edge.callContext = {
                ...edge.callContext,
                callSiteId: siteRemapped ?? edge.callContext.callSiteId,
                returnTargetId: returnRemapped ??
                  edge.callContext.returnTargetId,
              };
            }
          }
          if (remapped) {
            const oldPrefix = `${
              edge.kind === "sequence" ? "seq" : edge.kind
            }_${oldSource}__${oldTarget}`;
            const newPrefix = `${
              edge.kind === "sequence" ? "seq" : edge.kind
            }_${edge.source}__${edge.target}`;
            if (edge.id.startsWith(oldPrefix)) {
              edge.id = newPrefix + edge.id.slice(oldPrefix.length);
            } else {
              edge.id = newPrefix;
            }
            if (edge.callContext) {
              edge.callContext = {
                ...edge.callContext,
                callEdgeId: edge.id,
              };
            }
            edgeIdRemapForChunk.set(oldEdgeId, edge.id);
          }
          mergedEdges.push(edge);
        }
        chunkRemapMaps.push(idRemapForChunk);
        chunkEdgeRemapMaps.push(edgeIdRemapForChunk);
      }
      const mergedDiagnostics = results.flatMap((r) => r.diagnostics ?? []);
      const mergedPendingCallReturns: PendingCallReturn[] = [];
      const mergedHasReliableReturnInLabelSet = new Set<string>();
      const mergedHasReturnInLabelSet = new Set<string>();
      const mergedCalledLabelsSet = new Set<string>();
      const mergedCalledFromMenuOptionTargetsSet = new Set<string>();

      for (let chunkIdx = 0; chunkIdx < results.length; chunkIdx += 1) {
        const r = results[chunkIdx]!;
        const remap = chunkRemapMaps[chunkIdx]!;
        const edgeRemap = chunkEdgeRemapMaps[chunkIdx]!;

        if (r.pendingCallReturns) {
          for (const pcr of r.pendingCallReturns) {
            const callTargetId = remap.get(pcr.callTargetId) ??
              pcr.callTargetId;
            const returnTargetId = pcr.returnTargetId
              ? (remap.get(pcr.returnTargetId) ?? pcr.returnTargetId)
              : pcr.returnTargetId;
            const callContextId = pcr.callContextId
              ? (remap.get(pcr.callContextId) ?? pcr.callContextId)
              : pcr.callContextId;
            const callEdgeId = edgeRemap.get(pcr.callEdgeId) ??
              (remap.get(pcr.callEdgeId) ?? pcr.callEdgeId);
            mergedPendingCallReturns.push({
              ...pcr,
              callTargetId,
              returnTargetId,
              callContextId,
              callEdgeId,
            });
          }
        }

        if (r.hasReturnInLabel) {
          for (const label of r.hasReturnInLabel) {
            const remapped = remap.get(label) ?? label;
            mergedHasReturnInLabelSet.add(remapped);
          }
        }

        if (r.hasReliableReturnInLabel) {
          for (const label of r.hasReliableReturnInLabel) {
            const remapped = remap.get(label) ?? label;
            mergedHasReliableReturnInLabelSet.add(remapped);
          }
        }

        if (r.calledLabels) {
          for (const label of r.calledLabels) {
            const remapped = remap.get(label) ?? label;
            mergedCalledLabelsSet.add(remapped);
          }
        }

        if (r.calledFromMenuOptionTargets) {
          for (const label of r.calledFromMenuOptionTargets) {
            const remapped = remap.get(label) ?? label;
            mergedCalledFromMenuOptionTargetsSet.add(remapped);
          }
        }
      }
      const mergedHasReturnInLabel = Array.from(mergedHasReturnInLabelSet);
      const mergedCalledLabels = Array.from(mergedCalledLabelsSet);
      const mergedCalledFromMenuOptionTargets = Array.from(
        mergedCalledFromMenuOptionTargetsSet,
      );
      const mergedGlobalCharacters = Array.from(
        new Set(results.flatMap((r) => r.globalCharacters ?? [])),
      );
      const mergedHasReliableReturnInLabel = Array.from(
        mergedHasReliableReturnInLabelSet,
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
      for (let chunkIdx = 0; chunkIdx < results.length; chunkIdx += 1) {
        const r = results[chunkIdx]!;
        const remap = chunkRemapMaps[chunkIdx];
        for (const [name, id] of r.canonicalLabelIds) {
          if (!canonicalMap.has(name)) {
            const finalId = remap?.get(id) ?? id;
            canonicalMap.set(name, finalId);
          }
        }
      }
      const mergedCanonicalLabelIds = Array.from(canonicalMap.entries());

      const mergedNodeMutationsMap = new Map<string, VariableMutation[]>();
      for (let chunkIdx = 0; chunkIdx < results.length; chunkIdx += 1) {
        const r = results[chunkIdx]!;
        const remap = chunkRemapMaps[chunkIdx]!;
        if (r.nodeMutations) {
          for (const [nodeId, mutations] of r.nodeMutations) {
            const finalNodeId = remap.get(nodeId) ?? nodeId;
            const remappedMutations = mutations.map((m) => ({
              ...m,
              nodeId: remap.get(m.nodeId) ?? m.nodeId,
            }));
            const existing = mergedNodeMutationsMap.get(finalNodeId) ?? [];
            mergedNodeMutationsMap.set(finalNodeId, [
              ...existing,
              ...remappedMutations,
            ]);
          }
        }
      }
      const mergedNodeMutations = Array.from(mergedNodeMutationsMap.entries());
      const mergedInitVariables = results.flatMap((r) => r.initVariables ?? []);
      const mergedGlobalPersistentVariables = results.flatMap(
        (r) => r.globalPersistentVariables ?? [],
      );

      const mergedGlobalLabelVariableLiteralTargetsMap = new Map<
        string,
        string
      >();
      for (
        const [k, v] of prePassStateGraph.globalLabelVariableLiteralTargets
          .entries()
      ) {
        mergedGlobalLabelVariableLiteralTargetsMap.set(k, v);
      }
      for (const r of results) {
        if (r.globalLabelVariableLiteralTargets) {
          for (const [k, v] of r.globalLabelVariableLiteralTargets) {
            mergedGlobalLabelVariableLiteralTargetsMap.set(k, v);
          }
        }
      }
      const mergedGlobalLabelVariableLiteralTargets = Array.from(
        mergedGlobalLabelVariableLiteralTargetsMap.entries(),
      );

      const mergedGlobalLabelVariableDictTargetsMap = new Map<
        string,
        Map<string, string>
      >();
      for (
        const [k, v] of prePassStateGraph.globalLabelVariableDictTargets
          .entries()
      ) {
        mergedGlobalLabelVariableDictTargetsMap.set(k, new Map(v));
      }
      for (const r of results) {
        if (r.globalLabelVariableDictTargets) {
          for (const [k, entries] of r.globalLabelVariableDictTargets) {
            let existingDict = mergedGlobalLabelVariableDictTargetsMap.get(k);
            if (!existingDict) {
              existingDict = new Map();
              mergedGlobalLabelVariableDictTargetsMap.set(k, existingDict);
            }
            for (const [entryK, entryV] of entries) {
              existingDict.set(entryK, entryV);
            }
          }
        }
      }
      const mergedGlobalLabelVariableDictTargets = Array.from(
        mergedGlobalLabelVariableDictTargetsMap.entries(),
      ).map(([k, v]): [string, Array<[string, string]>] => [
        k,
        Array.from(v.entries()),
      ]);

      const mergedGlobalLabelVariableListTargetsMap = new Map<
        string,
        string[]
      >();
      for (
        const [k, v] of prePassStateGraph.globalLabelVariableListTargets
          .entries()
      ) {
        mergedGlobalLabelVariableListTargetsMap.set(k, [...v]);
      }
      for (const r of results) {
        if (r.globalLabelVariableListTargets) {
          for (const [k, list] of r.globalLabelVariableListTargets) {
            const existingList =
              mergedGlobalLabelVariableListTargetsMap.get(k) ?? [];
            mergedGlobalLabelVariableListTargetsMap.set(
              k,
              Array.from(new Set([...existingList, ...list])),
            );
          }
        }
      }
      const mergedGlobalLabelVariableListTargets = Array.from(
        mergedGlobalLabelVariableListTargetsMap.entries(),
      );

      const mergedImageDefinitionsMap = new Map<string, string>();
      if (prePassStateGraph.imageDefinitions) {
        for (const [k, v] of prePassStateGraph.imageDefinitions.entries()) {
          mergedImageDefinitionsMap.set(k, v);
        }
      }
      for (const r of results) {
        if (r.imageDefinitions) {
          for (const [k, v] of r.imageDefinitions) {
            mergedImageDefinitionsMap.set(k, v);
          }
        }
      }
      const mergedImageDefinitions = Array.from(
        mergedImageDefinitionsMap.entries(),
      );

      const mergedAssets = results.flatMap((r) => r.assets ?? []);
      const mergedAllConditionalExpressions = results.flatMap(
        (r) => r.allConditionalExpressions ?? [],
      );

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
          files,
          nodes: mergedNodes,
          edges: mergedEdges,
          diagnostics: mergedDiagnostics,
          pendingCallReturns: mergedPendingCallReturns,
          hasReturnInLabel: mergedHasReturnInLabel,
          hasReliableReturnInLabel: mergedHasReliableReturnInLabel,
          calledLabels: mergedCalledLabels,
          calledFromMenuOptionTargets: mergedCalledFromMenuOptionTargets,
          globalScreens: mergedGlobalScreens,
          globalCharacters: mergedGlobalCharacters,
          labelDefinitionCount: mergedLabelDefinitionCount,
          canonicalLabelIds: mergedCanonicalLabelIds,
          initVariables: mergedInitVariables,
          globalPersistentVariables: mergedGlobalPersistentVariables,
          globalLabelVariableLiteralTargets:
            mergedGlobalLabelVariableLiteralTargets,
          globalLabelVariableDictTargets: mergedGlobalLabelVariableDictTargets,
          globalLabelVariableListTargets: mergedGlobalLabelVariableListTargets,
          nodeMutations: mergedNodeMutations,
          imageDefinitions: mergedImageDefinitions,
          assets: mergedAssets,
          projectMediaFiles,
          maxCallStackDepth,
          allConditionalExpressions: mergedAllConditionalExpressions,
          translations: projectTranslations,
          availableLanguages: projectTranslations?.availableLanguages,
          screenDefinitions: prePassStateGraph.screenDefinitions
            ? Array.from(prePassStateGraph.screenDefinitions.entries())
            : undefined,
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
              resolve({
                ...finalResult,
                translations: projectTranslations ?? finalResult.translations,
                availableLanguages: projectTranslations?.availableLanguages ??
                  finalResult.availableLanguages,
              });
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

    const transfers: Transferable[] = [];
    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        transfers.push(file.content.buffer);
      }
    }

    const filesArg = transfers.length > 0 ? transfer(files, transfers) : files;

    return getWorkerApi(0).tokenize(requestId, filesArg, { fileCacheKeys });
  });
}

export function extractNodeDetailsInWorker(
  nodeIds: string[],
  sessionId?: string,
  signal?: AbortSignal,
): Promise<Record<string, NodeDetailsPayload>> {
  if (!areWorkersSupported()) {
    if (signal?.aborted) {
      return Promise.reject(
        new DOMException("Extract details cancelled", "AbortError"),
      );
    }
    const fallbackState = getActiveFallbackState();
    const targetSet = new Set(nodeIds);
    const unhydratedNodes = fallbackState.graphState.nodes.filter(
      (n) => targetSet.has(n.id) && !n.isDetailsLoaded && !n.dialogueLines,
    );
    return (async () => {
      if (
        unhydratedNodes.length > 0 && fallbackState.rawFilesByChapter.size > 0
      ) {
        const tokenizedFilesByChapter = new Map<
          string,
          { document: TextDocument; tokenTree: TokenTree }
        >();
        for (
          const [chapter, rawFile] of fallbackState.rawFilesByChapter.entries()
        ) {
          const tokenized = await tokenizeOneFile(rawFile);
          tokenizedFilesByChapter.set(chapter, {
            document: tokenized.document,
            tokenTree: tokenized.tokenTree,
          });
        }
        const extracted = extractNodeDetailsFromTokens(
          unhydratedNodes,
          tokenizedFilesByChapter,
        );
        for (const [id, payload] of Object.entries(extracted)) {
          const node = fallbackState.graphState.nodeMap.get(id);
          if (node) {
            if (payload.dialogueLines) {
              node.dialogueLines = payload.dialogueLines;
            }
            if (payload.dialogueLineNums) {
              node.dialogueLineNums = payload.dialogueLineNums;
            }
            if (payload.audioAssetCues) {
              node.audioAssetCues = payload.audioAssetCues;
            }
            node.isDetailsLoaded = true;
          }
        }
      }

      const nodes = fallbackState.graphState.nodes.filter((n) =>
        targetSet.has(n.id)
      );
      const details: Record<string, NodeDetailsPayload> = {};
      for (const node of nodes) {
        details[node.id] = {
          nodeId: node.id,
          dialogueLines: node.dialogueLines,
          dialogueLineNums: node.dialogueLineNums,
          audioAssetCues: node.audioAssetCues,
        };
      }
      return details;
    })();
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
