import { expose } from "comlink";
import { parseRenpyFiles } from "../parser/parser.ts";
import MiniSearch from "minisearch";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TokenTree } from "@renpy/ast/out/tokenizer/token-definitions";
import { createGraphState } from "../parser/pipelineState.ts";
import type { ParseDiagnostic, ParseInputFile } from "../parser/pipelineTypes.ts";
import pLimit from "p-limit";
import {
  processTokenizedFile,
  type TokenizedFile,
  tokenizeOneFile,
} from "../parser/filePipeline.ts";
import { finalizeRoles } from "../parser/roleFinalization.ts";
import {
  DIALOGUE_MINISEARCH_OPTIONS,
  type DialogueSearchDocument,
} from "../config/searchConfig.ts";
import { DIALOGUE_SEARCH_MAX_RESULTS } from "../config/viewerConfig.ts";
import type { ParserVariant, ScreenActionRule } from "../config/parserRules.ts";
import type { FlowEdge, FlowNode } from "../domain/index.ts";
import type {
  DialogueSearchResult,
  ParseDiagnosticPayload,
  ParseWorkerClientResult,
} from "./workerProtocol.ts";

type TokenizedCacheEntry = { document: TextDocument; tokenTree: TokenTree };

class BoundedTokenizedCache extends Map<string, TokenizedCacheEntry> {
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    super();
    this.maxEntries = maxEntries;
  }

  override get(key: string): TokenizedCacheEntry | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  override set(key: string, value: TokenizedCacheEntry): this {
    if (super.has(key)) {
      super.delete(key);
    }
    super.set(key, value);
    while (this.size > this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey === undefined) break;
      super.delete(oldestKey);
    }
    return this;
  }
}

const MAX_TOKENIZED_CACHE_ENTRIES = 200;

let activeRequestId: number | null = null;
const cancelledRequests = new Set<number>();
const tokenizedCache = new BoundedTokenizedCache(MAX_TOKENIZED_CACHE_ENTRIES);
let accumulatedState = createGraphState();
let dialogueSearchDocs: DialogueSearchDocument[] = [];
let dialogueSearchMiniSearch: MiniSearch<DialogueSearchDocument> | null = null;

function buildDialogueSearchIndex(
  nodes: { id: string; label: string; dialogueLines?: string[] }[],
) {
  dialogueSearchDocs = [];
  for (const node of nodes) {
    if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
    for (let idx = 0; idx < node.dialogueLines.length; idx += 1) {
      dialogueSearchDocs.push({
        id: `${node.id}::${idx + 1}`,
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }
  if (dialogueSearchDocs.length > 0) {
    dialogueSearchMiniSearch = new MiniSearch(DIALOGUE_MINISEARCH_OPTIONS);
    dialogueSearchMiniSearch.addAll(dialogueSearchDocs);
  } else {
    dialogueSearchMiniSearch = null;
  }
}

export interface ProgressPayload {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

export interface InternalChunkResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnosticPayload[];
  pendingCallReturns: Array<{ returnTargetId: string; callTargetId: string }>;
  hasReliableReturnInLabel: string[];
  globalScreens: string[];
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
}

const parserApi = {
  async parse(
    requestId: number,
    files: ParseInputFile[],
    options: {
      fileCacheKeys?: string[];
      wantsProgress?: boolean;
      maxParallelFiles?: number;
      captureDialogueLines?: boolean;
      parserVariant?: ParserVariant;
      screenActionRules?: ScreenActionRule[];
      appendToActiveGraph?: boolean;
      resetActiveGraph?: boolean;
      isFinalChunk?: boolean;
    },
    onProgress?: (progress: ProgressPayload) => void,
  ): Promise<ParseWorkerClientResult> {
    activeRequestId = requestId;
    const startedAt = performance.now();
    const wantsProgress = options.wantsProgress !== false && !!onProgress;
    const appendToActiveGraph = options.appendToActiveGraph === true;
    const resetActiveGraph = options.resetActiveGraph === true;
    const isFinalChunk = options.isFinalChunk !== false;
    const progressThrottleMs = files.length > 40 ? 30 : 0;
    let lastProgressAt = 0;
    let pendingProgress: ProgressPayload | null = null;

    try {
      let result;
      if (appendToActiveGraph) {
        if (resetActiveGraph) {
          accumulatedState = createGraphState();
          dialogueSearchDocs = [];
          dialogueSearchMiniSearch = null;
        }

        const hardwareConcurrency = typeof navigator !== "undefined"
          ? navigator.hardwareConcurrency
          : 1;
        const defaultMaxParallel = Math.max(
          1,
          Math.min(4, hardwareConcurrency),
        );
        const effectiveMaxParallel = options.maxParallelFiles ??
          defaultMaxParallel;

        let tokenizedFiles: Array<TokenizedFile | undefined> = [];
        if (files.length > 1 && effectiveMaxParallel > 1) {
          const limit = pLimit(effectiveMaxParallel);
          tokenizedFiles = await Promise.all(
            files.map((file, idx) =>
              limit(async () => {
                if (
                  activeRequestId !== requestId ||
                  cancelledRequests.has(requestId)
                ) {
                  return undefined;
                }
                return tokenizeOneFile(
                  file,
                  {
                    tokenizedCache,
                    fileCacheKeys: options.fileCacheKeys,
                  },
                  idx,
                );
              })
            ),
          );
        }

        for (let idx = 0; idx < files.length; idx += 1) {
          if (activeRequestId !== requestId) {
            throw new Error("Parsing superceded by another request");
          }
          if (cancelledRequests.has(requestId)) {
            throw new Error("Parsing cancelled");
          }
          const file = files[idx];
          let tokenized = tokenizedFiles[idx];
          if (!tokenized) {
            tokenized = await tokenizeOneFile(
              file,
              {
                tokenizedCache,
                fileCacheKeys: options.fileCacheKeys,
              },
              idx,
            );
          }
          processTokenizedFile(accumulatedState, tokenized, {
            captureDialogueLines: options.captureDialogueLines !== false,
            parserVariant: options.parserVariant,
            screenActionRules: options.screenActionRules,
          });

          if (wantsProgress) {
            const now = performance.now();
            const nextProgress: ProgressPayload = {
              doneFiles: idx + 1,
              totalFiles: files.length,
              currentFile: file.relativePath ?? file.name,
              elapsedMs: performance.now() - startedAt,
            };
            pendingProgress = nextProgress;
            if (
              progressThrottleMs <= 0 ||
              now - lastProgressAt >= progressThrottleMs ||
              idx + 1 === files.length
            ) {
              onProgress(nextProgress);
              lastProgressAt = now;
              pendingProgress = null;
            }
          }
        }
        if (isFinalChunk) {
          finalizeRoles(accumulatedState);
          buildDialogueSearchIndex(accumulatedState.nodes);
        }
        result = {
          nodes: accumulatedState.nodes,
          edges: accumulatedState.edges,
          diagnostics: accumulatedState.diagnostics.length > 0
            ? accumulatedState.diagnostics
            : undefined,
        };
      } else {
        result = await parseRenpyFiles(files, {
          maxParallelFiles: options.maxParallelFiles,
          tokenizedCache,
          fileCacheKeys: options.fileCacheKeys,
          captureDialogueLines: options.captureDialogueLines !== false,
          parserVariant: options.parserVariant,
          screenActionRules: options.screenActionRules,
          onProgress: ({ doneFiles, totalFiles, currentFile }) => {
            if (cancelledRequests.has(requestId)) {
              throw new Error("Parsing cancelled");
            }
            if (!wantsProgress) return;
            const now = performance.now();
            const nextProgress: ProgressPayload = {
              doneFiles,
              totalFiles,
              currentFile,
              elapsedMs: performance.now() - startedAt,
            };
            pendingProgress = nextProgress;
            if (
              progressThrottleMs <= 0 ||
              now - lastProgressAt >= progressThrottleMs ||
              doneFiles === totalFiles
            ) {
              onProgress(nextProgress);
              lastProgressAt = now;
              pendingProgress = null;
            }
          },
        });
        accumulatedState = createGraphState();
        accumulatedState.nodes = result.nodes;
        accumulatedState.edges = result.edges;
        buildDialogueSearchIndex(result.nodes);
      }

      if (wantsProgress && pendingProgress) {
        onProgress(pendingProgress);
        pendingProgress = null;
      }

      if (cancelledRequests.has(requestId)) {
        throw new Error("Parsing cancelled");
      }

      return {
        nodes: result.nodes,
        edges: result.edges,
        diagnostics: result.diagnostics as ParseDiagnosticPayload[] | undefined,
      };
    } finally {
      const wasCancelled = cancelledRequests.has(requestId);
      if (activeRequestId === requestId) {
        activeRequestId = null;
      }
      cancelledRequests.delete(requestId);
      if ((appendToActiveGraph && isFinalChunk) || wasCancelled) {
        accumulatedState = createGraphState();
      }
      if (wasCancelled) {
        dialogueSearchDocs = [];
        dialogueSearchMiniSearch = null;
      }
    }
  },

  async parseChunk(
    requestId: number,
    files: ParseInputFile[],
    options: {
      fileCacheKeys?: string[];
      captureDialogueLines?: boolean;
      parserVariant?: ParserVariant;
      screenActionRules?: ScreenActionRule[];
    },
  ): Promise<InternalChunkResult> {
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      throw new Error("Chunk parsing cancelled");
    }
    try {
      const chunkState = createGraphState();
      for (let idx = 0; idx < files.length; idx += 1) {
        if (cancelledRequests.has(requestId)) {
          throw new Error("Chunk parsing cancelled");
        }
        const tokenized = await tokenizeOneFile(
          files[idx],
          { tokenizedCache, fileCacheKeys: options.fileCacheKeys },
          idx,
        );
        processTokenizedFile(chunkState, tokenized, {
          captureDialogueLines: options.captureDialogueLines !== false,
          parserVariant: options.parserVariant,
          screenActionRules: options.screenActionRules,
        });
      }
      if (cancelledRequests.has(requestId)) {
        throw new Error("Chunk parsing cancelled");
      }
      return {
        nodes: chunkState.nodes,
        edges: chunkState.edges,
        diagnostics: chunkState.diagnostics.length > 0
          ? (chunkState.diagnostics as ParseDiagnosticPayload[])
          : undefined,
        pendingCallReturns: chunkState.pendingCallReturns,
        hasReliableReturnInLabel: Array.from(
          chunkState.hasReliableReturnInLabel,
        ),
        globalScreens: Array.from(chunkState.globalScreens),
        labelDefinitionCount: Array.from(
          chunkState.labelDefinitionCountByName.entries(),
        ),
        canonicalLabelIds: Array.from(
          chunkState.canonicalLabelIdByName.entries(),
        ),
      };
    } finally {
      cancelledRequests.delete(requestId);
    }
  },

  async finalize(
    requestId: number,
    options: {
      nodes: FlowNode[];
      edges: FlowEdge[];
      diagnostics?: ParseDiagnosticPayload[];
      pendingCallReturns: Array<
        { returnTargetId: string; callTargetId: string }
      >;
      hasReliableReturnInLabel: string[];
      globalScreens: string[];
      labelDefinitionCount: Array<[string, number]>;
      canonicalLabelIds: Array<[string, string]>;
      appendToActiveGraph?: boolean;
      resetActiveGraph?: boolean;
      isFinalChunk?: boolean;
    },
  ): Promise<ParseWorkerClientResult> {
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      throw new Error("Finalize cancelled");
    }
    const appendToActiveGraph = options.appendToActiveGraph === true;
    const isFinalChunk = options.isFinalChunk !== false;

    try {
      if (appendToActiveGraph) {
        if (options.resetActiveGraph) {
          accumulatedState = createGraphState();
          dialogueSearchDocs = [];
          dialogueSearchMiniSearch = null;
        }

        accumulatedState.nodes.push(...options.nodes);
        accumulatedState.edges.push(...options.edges);
        if (options.diagnostics) {
          accumulatedState.diagnostics.push(
            ...(options.diagnostics as ParseDiagnostic[]),
          );
        }
        accumulatedState.pendingCallReturns.push(...options.pendingCallReturns);
        for (const label of options.hasReliableReturnInLabel) {
          accumulatedState.hasReliableReturnInLabel.add(label);
        }
        for (const screen of options.globalScreens) {
          accumulatedState.globalScreens.add(screen);
        }
        for (const [name, count] of options.labelDefinitionCount) {
          accumulatedState.labelDefinitionCountByName.set(
            name,
            (accumulatedState.labelDefinitionCountByName.get(name) ?? 0) +
              count,
          );
        }
        for (const [name, id] of options.canonicalLabelIds) {
          accumulatedState.canonicalLabelIdByName.set(name, id);
        }

        if (isFinalChunk) {
          finalizeRoles(accumulatedState);
          buildDialogueSearchIndex(accumulatedState.nodes);
        }

        if (cancelledRequests.has(requestId)) {
          throw new Error("Finalize cancelled");
        }

        return {
          nodes: accumulatedState.nodes,
          edges: accumulatedState.edges,
          diagnostics: accumulatedState.diagnostics.length > 0
            ? (accumulatedState.diagnostics as ParseDiagnosticPayload[])
            : undefined,
        };
      } else {
        const state = createGraphState();
        state.nodes = options.nodes;
        state.edges = options.edges;
        state.diagnostics = options.diagnostics
          ? (options.diagnostics as ParseDiagnostic[])
          : [];
        state.pendingCallReturns = options.pendingCallReturns;
        state.hasReliableReturnInLabel = new Set(
          options.hasReliableReturnInLabel,
        );
        state.globalScreens = new Set(options.globalScreens);
        state.labelDefinitionCountByName = new Map(
          options.labelDefinitionCount,
        );
        state.canonicalLabelIdByName = new Map(options.canonicalLabelIds);

        finalizeRoles(state);
        buildDialogueSearchIndex(state.nodes);

        if (cancelledRequests.has(requestId)) {
          throw new Error("Finalize cancelled");
        }

        return {
          nodes: state.nodes,
          edges: state.edges,
          diagnostics: state.diagnostics.length > 0
            ? (state.diagnostics as ParseDiagnosticPayload[])
            : undefined,
        };
      }
    } finally {
      const wasCancelled = cancelledRequests.has(requestId);
      cancelledRequests.delete(requestId);
      if ((appendToActiveGraph && isFinalChunk) || wasCancelled) {
        accumulatedState = createGraphState();
      }
      if (wasCancelled) {
        dialogueSearchDocs = [];
        dialogueSearchMiniSearch = null;
      }
    }
  },

  async search(
    requestId: number,
    query: string,
    options: {
      nodeIds?: string[];
      maxResults?: number;
    },
  ): Promise<DialogueSearchResult[]> {
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      return [];
    }
    const q = query.trim();
    if (!q) {
      cancelledRequests.delete(requestId);
      return [];
    }
    const maxResults = Math.max(
      1,
      Math.min(options.maxResults ?? 500, DIALOGUE_SEARCH_MAX_RESULTS),
    );
    const allowedIds = options.nodeIds ? new Set(options.nodeIds) : null;
    let results: DialogueSearchResult[] = [];
    if (dialogueSearchMiniSearch) {
      const rawResults = dialogueSearchMiniSearch.search(q);
      const filtered = allowedIds
        ? rawResults.filter((entry) => allowedIds.has(entry.nodeId))
        : rawResults;
      results = filtered.slice(0, maxResults).map((entry) => ({
        nodeId: entry.nodeId,
        nodeLabel: entry.nodeLabel,
        lineIndex: entry.lineIndex,
        lineText: entry.lineText,
      })) as DialogueSearchResult[];
    }
    cancelledRequests.delete(requestId);
    return results;
  },

  cancel(requestId: number) {
    cancelledRequests.add(requestId);
  },
};

expose(parserApi);

export type ParserWorkerApi = typeof parserApi;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default null as any;
