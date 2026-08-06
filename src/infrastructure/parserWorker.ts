import { expose } from "comlink";
import {
  createGraphState,
  finalizeRoles,
  type ParseDiagnostic,
  type ParseGraphState,
  type ParseInputFile,
  parseRenpyFiles,
  type PendingCallReturn,
  processTokenizedFile,
  type TokenizedFile,
  tokenizeOneFile,
} from "../parser/index.ts";
import MiniSearch from "minisearch";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TokenTree } from "@renpy/ast/out/tokenizer/token-definitions";
import pLimit from "p-limit";
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

interface SessionState {
  accumulatedState: ParseGraphState;
  dialogueSearchDocs: DialogueSearchDocument[];
  dialogueSearchMiniSearch: MiniSearch<DialogueSearchDocument> | null;
}

const sessions = new Map<string, SessionState>();

function getSession(sessionId: string): SessionState {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      accumulatedState: createGraphState(),
      dialogueSearchDocs: [],
      dialogueSearchMiniSearch: null,
    };
    sessions.set(sessionId, session);
  }
  return session;
}

function clearSession(sessionId: string) {
  sessions.delete(sessionId);
}

function buildDialogueSearchIndex(
  session: SessionState,
  nodes: { id: string; label: string; dialogueLines?: string[] }[],
) {
  session.dialogueSearchDocs = [];
  for (const node of nodes) {
    if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
    for (let idx = 0; idx < node.dialogueLines.length; idx += 1) {
      session.dialogueSearchDocs.push({
        id: `${node.id}::${idx + 1}`,
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }
  if (session.dialogueSearchDocs.length > 0) {
    session.dialogueSearchMiniSearch = new MiniSearch(
      DIALOGUE_MINISEARCH_OPTIONS,
    );
    session.dialogueSearchMiniSearch.addAll(session.dialogueSearchDocs);
  } else {
    session.dialogueSearchMiniSearch = null;
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
  pendingCallReturns: PendingCallReturn[];
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
      sessionId?: string;
      fileCacheKeys?: string[];
      wantsProgress?: boolean;
      maxParallelFiles?: number;
      captureDialogueLines?: boolean;
      parserVariant?: ParserVariant;
      screenActionRules?: ScreenActionRule[];
      appendToActiveGraph?: boolean;
      resetActiveGraph?: boolean;
      isFinalChunk?: boolean;
    } = {},
    onProgress?: (progress: ProgressPayload) => void,
  ): Promise<ParseWorkerClientResult> {
    const sessionId = options.sessionId || "default";
    const session = getSession(sessionId);
    activeRequestId = requestId;
    const startedAt = performance.now();
    const wantsProgress = options.wantsProgress !== false && !!onProgress;
    const appendToActiveGraph = options.appendToActiveGraph === true;
    const resetActiveGraph = options.resetActiveGraph === true;
    const isFinalChunk = options.isFinalChunk !== false;
    const progressThrottleMs = files.length > 40 ? 30 : 0;
    let lastProgressAt = 0;
    let pendingProgress: ProgressPayload | null = null;

    // Decode files if they are in Uint8Array format
    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        file.content = new TextDecoder("utf-8").decode(file.content);
      }
    }

    try {
      let result;
      if (appendToActiveGraph) {
        if (resetActiveGraph) {
          session.accumulatedState = createGraphState();
          session.dialogueSearchDocs = [];
          session.dialogueSearchMiniSearch = null;
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
                return await tokenizeOneFile(
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
          // Yield to event loop every 5 files to allow cancellation processing
          if (idx > 0 && idx % 5 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
          processTokenizedFile(session.accumulatedState, tokenized, {
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
          finalizeRoles(session.accumulatedState);
          buildDialogueSearchIndex(session, session.accumulatedState.nodes);
        }
        result = {
          nodes: session.accumulatedState.nodes,
          edges: session.accumulatedState.edges,
          diagnostics: session.accumulatedState.diagnostics.length > 0
            ? session.accumulatedState.diagnostics
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
        session.accumulatedState = createGraphState();
        session.accumulatedState.nodes = result.nodes;
        session.accumulatedState.edges = result.edges;
        buildDialogueSearchIndex(session, result.nodes);
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
        clearSession(sessionId);
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
    // Decode files if they are in Uint8Array format
    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        file.content = new TextDecoder("utf-8").decode(file.content);
      }
    }
    try {
      const chunkState = createGraphState();
      for (let idx = 0; idx < files.length; idx += 1) {
        if (cancelledRequests.has(requestId)) {
          throw new Error("Chunk parsing cancelled");
        }
        // Yield to event loop every 5 files to allow cancellation processing
        if (idx > 0 && idx % 5 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
      sessionId?: string;
      nodes: FlowNode[];
      edges: FlowEdge[];
      diagnostics?: ParseDiagnosticPayload[];
      pendingCallReturns: PendingCallReturn[];
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
    const sessionId = options.sessionId || "default";
    const session = getSession(sessionId);
    const appendToActiveGraph = options.appendToActiveGraph === true;
    const isFinalChunk = options.isFinalChunk !== false;

    try {
      if (appendToActiveGraph) {
        if (options.resetActiveGraph) {
          session.accumulatedState = createGraphState();
          session.dialogueSearchDocs = [];
          session.dialogueSearchMiniSearch = null;
        }

        session.accumulatedState.nodes.push(...options.nodes);
        session.accumulatedState.edges.push(...options.edges);
        if (options.diagnostics) {
          session.accumulatedState.diagnostics.push(
            ...(options.diagnostics as ParseDiagnostic[]),
          );
        }
        session.accumulatedState.pendingCallReturns.push(
          ...(options.pendingCallReturns as PendingCallReturn[]),
        );
        for (const label of options.hasReliableReturnInLabel) {
          session.accumulatedState.hasReliableReturnInLabel.add(label);
        }
        for (const screen of options.globalScreens) {
          session.accumulatedState.globalScreens.add(screen);
        }
        for (const [name, count] of options.labelDefinitionCount) {
          session.accumulatedState.labelDefinitionCountByName.set(
            name,
            (session.accumulatedState.labelDefinitionCountByName.get(name) ??
              0) +
              count,
          );
        }
        for (const [name, id] of options.canonicalLabelIds) {
          session.accumulatedState.canonicalLabelIdByName.set(name, id);
        }

        if (isFinalChunk) {
          finalizeRoles(session.accumulatedState);
          buildDialogueSearchIndex(session, session.accumulatedState.nodes);
        }

        if (cancelledRequests.has(requestId)) {
          throw new Error("Finalize cancelled");
        }

        return {
          nodes: session.accumulatedState.nodes,
          edges: session.accumulatedState.edges,
          diagnostics: session.accumulatedState.diagnostics.length > 0
            ? (session.accumulatedState.diagnostics as ParseDiagnosticPayload[])
            : undefined,
        };
      } else {
        const state = createGraphState();
        state.nodes = options.nodes;
        state.edges = options.edges;
        state.diagnostics = options.diagnostics
          ? (options.diagnostics as ParseDiagnostic[])
          : [];
        state.pendingCallReturns = options.pendingCallReturns as PendingCallReturn[];
        state.hasReliableReturnInLabel = new Set(
          options.hasReliableReturnInLabel,
        );
        state.globalScreens = new Set(options.globalScreens);
        state.labelDefinitionCountByName = new Map(
          options.labelDefinitionCount,
        );
        state.canonicalLabelIdByName = new Map(options.canonicalLabelIds);

        finalizeRoles(state);
        buildDialogueSearchIndex(session, state.nodes);

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
        clearSession(sessionId);
      }
    }
  },

  async search(
    requestId: number,
    query: string,
    options: {
      sessionId?: string;
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
    const sessionId = options.sessionId || "default";
    const session = getSession(sessionId);
    const maxResults = Math.max(
      1,
      Math.min(options.maxResults ?? 500, DIALOGUE_SEARCH_MAX_RESULTS),
    );
    const allowedIds = options.nodeIds ? new Set(options.nodeIds) : null;
    let results: DialogueSearchResult[] = [];
    if (session.dialogueSearchMiniSearch) {
      const rawResults = session.dialogueSearchMiniSearch.search(q);
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
export default null as unknown;
