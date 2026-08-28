import { expose } from "comlink";
import {
  createFileGraphFragment,
  createGraphState,
  extractNodeDetailsFromTokens,
  type FileGraphFragment,
  finalizeRoles,
  type InitVariableDescriptor,
  materializeCallReturnEdges,
  type NodeDetailsPayload,
  type ParseDiagnostic,
  type ParseGraphState,
  type ParseInputFile,
  parseRenpyFiles,
  type PendingCallReturn,
  preParseInitialization,
  processTokenizedFile,
  runControlFlowAnalysis,
  type TokenizedFile,
  tokenizeOneFile,
  type VariableMutation,
  type VariableValue,
} from "../parser/index.ts";
import MiniSearch from "minisearch";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TokenTree } from "@renpy/ast/out/tokenizer/token-definitions.js";
import pLimit from "p-limit";
import {
  DIALOGUE_MINISEARCH_OPTIONS,
  type DialogueSearchDocument,
} from "../config/searchConfig.ts";
import { DIALOGUE_SEARCH_MAX_RESULTS } from "../config/viewerConfig.ts";
import type { ParserVariant, ScreenActionRule } from "../config/parserRules.ts";
import {
  compareFiles,
  type FlowAsset,
  type FlowEdge,
  type FlowNode,
  type ProjectTranslations,
} from "../domain/index.ts";
import type {
  DialogueSearchResult,
  ParseDiagnosticPayload,
  ParseWorkerClientResult,
} from "./workerProtocol.ts";

type TokenizedCacheEntry = {
  chapter: string;
  document: TextDocument;
  tokenTree: TokenTree;
};

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
  rawFilesByChapter: Map<string, ParseInputFile>;
  dialogueSearchDocs: DialogueSearchDocument[];
  dialogueSearchMiniSearch: MiniSearch<DialogueSearchDocument> | null;
}

const sessions = new Map<string, SessionState>();

function getSession(sessionId: string): SessionState {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      accumulatedState: createGraphState(),
      rawFilesByChapter: new Map(),
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

async function getOrFetchTokenizedMap(
  session: SessionState,
  nodes: FlowNode[],
): Promise<Map<string, { document: TextDocument; tokenTree: TokenTree }>> {
  const tokenizedFilesByChapter = new Map<
    string,
    { document: TextDocument; tokenTree: TokenTree }
  >();

  for (const entry of tokenizedCache.values()) {
    const rawFile = session.rawFilesByChapter.get(entry.chapter);
    if (rawFile) {
      const rawContentStr = typeof rawFile.content === "string"
        ? rawFile.content
        : new TextDecoder("utf-8").decode(rawFile.content);
      if (entry.document.getText() === rawContentStr) {
        tokenizedFilesByChapter.set(entry.chapter, {
          document: entry.document,
          tokenTree: entry.tokenTree,
        });
      }
    }
  }

  const missingChapters = new Set<string>();
  for (const node of nodes) {
    const chapter = node.chapter || "";
    if (chapter && !tokenizedFilesByChapter.has(chapter)) {
      missingChapters.add(chapter);
    }
  }

  for (const chapter of missingChapters) {
    const rawFile = session.rawFilesByChapter.get(chapter);
    if (rawFile) {
      const tokenized = await tokenizeOneFile(rawFile, { tokenizedCache });
      tokenizedFilesByChapter.set(chapter, {
        document: tokenized.document,
        tokenTree: tokenized.tokenTree,
      });
    }
  }

  return tokenizedFilesByChapter;
}

async function buildDialogueSearchIndex(
  session: SessionState,
  nodes: FlowNode[],
  deferUnhydrated = false,
) {
  session.dialogueSearchDocs = [];
  if (!deferUnhydrated) {
    const unhydrated = nodes.filter((n) =>
      n.dialogueCount > 0 && !n.dialogueLines
    );
    if (unhydrated.length > 0) {
      const tokenizedFilesByChapter = await getOrFetchTokenizedMap(
        session,
        unhydrated,
      );
      const extractedDetails = extractNodeDetailsFromTokens(
        unhydrated,
        tokenizedFilesByChapter,
      );
      for (const [id, payload] of Object.entries(extractedDetails)) {
        const node = session.accumulatedState.nodeMap.get(id);
        if (node && payload.dialogueLines) {
          node.dialogueLines = payload.dialogueLines;
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
      session.dialogueSearchDocs.push({
        id: `${node.id}::${idx + 1}`,
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }

  if (session.accumulatedState?.translations) {
    const tl = session.accumulatedState.translations;
    for (const [lang, langData] of Object.entries(tl.translationsByLanguage)) {
      for (
        const [rawBlockId, lines] of Object.entries(langData.dialogueByNodeId)
      ) {
        let canonicalNodeId = rawBlockId;
        if (!session.accumulatedState.nodeMap.has(rawBlockId)) {
          const hashMatch = /^(.+)_[0-9a-fA-F]{8}$/.exec(rawBlockId);
          if (hashMatch) {
            const stripped = hashMatch[1]!;
            if (session.accumulatedState.nodeMap.has(stripped)) {
              canonicalNodeId = stripped;
            } else if (
              session.accumulatedState.canonicalLabelIdByName?.has(stripped)
            ) {
              canonicalNodeId = session.accumulatedState.canonicalLabelIdByName
                .get(stripped)!;
            }
          } else if (
            session.accumulatedState.canonicalLabelIdByName?.has(rawBlockId)
          ) {
            canonicalNodeId = session.accumulatedState.canonicalLabelIdByName
              .get(rawBlockId)!;
          }
        }
        const targetNode = session.accumulatedState.nodeMap.get(
          canonicalNodeId,
        );
        const nodeLabel = targetNode?.label ?? canonicalNodeId;

        for (let idx = 0; idx < lines.length; idx += 1) {
          session.dialogueSearchDocs.push({
            id: `${rawBlockId}::tl_${lang}::${idx + 1}`,
            nodeId: canonicalNodeId,
            nodeLabel,
            lineIndex: idx + 1,
            lineText: lines[idx]!,
          });
        }
      }
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

export const parserApi = {
  async parse(
    requestId: number,
    files: ParseInputFile[],
    options: {
      sessionId?: string;
      fileCacheKeys?: string[];
      wantsProgress?: boolean;
      maxParallelFiles?: number;
      captureDialogueLines?: boolean;
      deferDetails?: boolean;
      parserVariant?: ParserVariant;
      screenActionRules?: ScreenActionRule[];
      sceneSplitDialogueThreshold?: number;
      projectMediaFiles?:
        | Array<{ relativePath: string; fileName: string }>
        | Set<string>
        | string[];
      maxCallStackDepth?: number;
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
    // Sort files deterministically
    files.sort(compareFiles);

    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        file.content = new TextDecoder("utf-8").decode(file.content);
      }
      const chapterSource = file.relativePath ?? file.name;
      const chapter = chapterSource.replace(/\\/g, "/").replace(/\.rpy$/i, "");
      session.rawFilesByChapter.set(chapter, file);
    }

    try {
      let result;
      if (appendToActiveGraph) {
        if (resetActiveGraph) {
          for (const sId of Array.from(sessions.keys())) {
            if (sId !== sessionId) {
              sessions.delete(sId);
            }
          }
          session.accumulatedState = createGraphState();
          session.rawFilesByChapter.clear();
          session.dialogueSearchDocs = [];
          session.dialogueSearchMiniSearch = null;
        }

        preParseInitialization(
          files,
          session.accumulatedState,
        );

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
            deferDetails: options.deferDetails,
            parserVariant: options.parserVariant,
            screenActionRules: options.screenActionRules,
            sceneSplitDialogueThreshold: options.sceneSplitDialogueThreshold,
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
        if (options.projectMediaFiles) {
          session.accumulatedState.projectMediaFiles =
            options.projectMediaFiles;
        }
        if (isFinalChunk) {
          finalizeRoles(session.accumulatedState);
          buildDialogueSearchIndex(
            session,
            session.accumulatedState.nodes,
            Boolean(
              options.deferDetails || options.captureDialogueLines === false,
            ),
          );
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
          deferDetails: options.deferDetails,
          parserVariant: options.parserVariant,
          screenActionRules: options.screenActionRules,
          projectMediaFiles: options.projectMediaFiles,
          maxCallStackDepth: options.maxCallStackDepth,
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
        if (result.initVariables) {
          session.accumulatedState.initVariables = new Map(
            result.initVariables,
          );
        }
        if (result.nodeMutations) {
          session.accumulatedState.nodeMutations = new Map(
            result.nodeMutations,
          );
        }
        if (result.assets) {
          session.accumulatedState.assets = [...result.assets];
        }
        if (options.projectMediaFiles) {
          session.accumulatedState.projectMediaFiles =
            options.projectMediaFiles;
        }
        if (result.diagnostics) {
          session.accumulatedState.diagnostics = [...result.diagnostics];
        }
        for (const n of result.nodes) {
          session.accumulatedState.nodeMap.set(n.id, n);
        }
        for (const e of result.edges) {
          session.accumulatedState.edgeMap.set(e.id, e);
        }
        buildDialogueSearchIndex(
          session,
          result.nodes,
          Boolean(
            options.deferDetails || options.captureDialogueLines === false,
          ),
        );
      }

      if (wantsProgress && pendingProgress) {
        onProgress(pendingProgress);
      }

      return result;
    } finally {
      const wasCancelled = cancelledRequests.has(requestId);
      if (activeRequestId === requestId) {
        activeRequestId = null;
      }
      cancelledRequests.delete(requestId);
      if (wasCancelled) {
        clearSession(sessionId);
      }
    }
  },

  async parseChunk(
    requestId: number,
    files: ParseInputFile[],
    options: {
      tokenizedCache?: Map<string, TokenizedCacheEntry>;
      fileCacheKeys?: string[];
      captureDialogueLines?: boolean;
      deferDetails?: boolean;
      parserVariant?: ParserVariant;
      screenActionRules?: ScreenActionRule[];
      sceneSplitDialogueThreshold?: number;
      maxCallStackDepth?: number;
      prePassState?: {
        globalLabelVariableLiteralTargets?: Array<[string, string]>;
        globalLabelVariableDictTargets?: Array<
          [string, Array<[string, string]>]
        >;
        globalLabelVariableListTargets?: Array<[string, string[]]>;
        initVariables?: Array<[string, InitVariableDescriptor]>;
        globalPersistentVariables?: Array<[string, VariableValue]>;
        globalScreens?: string[];
        globalCharacters?: string[];
        imageDefinitions?: Array<[string, string]>;
        screenDefinitions?: Array<
          [string, import("../parser/pipelineTypes.ts").ScreenDefinition]
        >;
      };
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
      if (options.prePassState) {
        if (options.prePassState.globalLabelVariableLiteralTargets) {
          for (
            const [k, v] of options.prePassState
              .globalLabelVariableLiteralTargets
          ) {
            chunkState.globalLabelVariableLiteralTargets.set(k, v);
          }
        }
        if (options.prePassState.globalLabelVariableDictTargets) {
          for (
            const [k, entries] of options.prePassState
              .globalLabelVariableDictTargets
          ) {
            chunkState.globalLabelVariableDictTargets.set(
              k,
              new Map(entries),
            );
          }
        }
        if (options.prePassState.globalLabelVariableListTargets) {
          for (
            const [k, list] of options.prePassState
              .globalLabelVariableListTargets
          ) {
            chunkState.globalLabelVariableListTargets.set(k, [...list]);
          }
        }
        if (options.prePassState.initVariables) {
          if (!chunkState.initVariables) chunkState.initVariables = new Map();
          for (
            const [vName, desc] of options.prePassState.initVariables
          ) {
            chunkState.initVariables.set(vName, desc);
          }
        }
        if (options.prePassState.globalPersistentVariables) {
          if (!chunkState.globalPersistentVariables) {
            chunkState.globalPersistentVariables = new Map();
          }
          for (
            const [k, v] of options.prePassState.globalPersistentVariables
          ) {
            chunkState.globalPersistentVariables.set(k, v);
          }
        }
        if (options.prePassState.globalScreens) {
          for (const s of options.prePassState.globalScreens) {
            chunkState.globalScreens.add(s);
          }
        }
        if (options.prePassState.globalCharacters) {
          for (const c of options.prePassState.globalCharacters) {
            chunkState.globalCharacters.add(c);
          }
        }
        if (options.prePassState.imageDefinitions) {
          if (!chunkState.imageDefinitions) {
            chunkState.imageDefinitions = new Map();
          }
          for (const [k, v] of options.prePassState.imageDefinitions) {
            chunkState.imageDefinitions.set(k, v);
          }
        }
        if (options.prePassState.screenDefinitions) {
          if (!chunkState.screenDefinitions) {
            chunkState.screenDefinitions = new Map();
          }
          for (const [k, v] of options.prePassState.screenDefinitions) {
            chunkState.screenDefinitions.set(k, v);
          }
        }
      }
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
          {
            tokenizedCache: options.tokenizedCache ?? tokenizedCache,
            fileCacheKeys: options.fileCacheKeys,
          },
          idx,
        );
        processTokenizedFile(chunkState, tokenized, {
          captureDialogueLines: options.captureDialogueLines !== false,
          deferDetails: options.deferDetails,
          parserVariant: options.parserVariant,
          screenActionRules: options.screenActionRules,
          sceneSplitDialogueThreshold: options.sceneSplitDialogueThreshold,
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
        hasReturnInLabel: Array.from(chunkState.hasReturnInLabel),
        hasReliableReturnInLabel: Array.from(
          chunkState.hasReliableReturnInLabel,
        ),
        calledLabels: Array.from(chunkState.calledLabels),
        calledFromMenuOptionTargets: Array.from(
          chunkState.calledFromMenuOptionTargets,
        ),
        globalScreens: Array.from(chunkState.globalScreens),
        globalCharacters: Array.from(chunkState.globalCharacters),
        labelDefinitionCount: Array.from(
          chunkState.labelDefinitionCountByName.entries(),
        ),
        canonicalLabelIds: Array.from(
          chunkState.canonicalLabelIdByName.entries(),
        ),
        initVariables: chunkState.initVariables
          ? Array.from(chunkState.initVariables.entries())
          : undefined,
        globalPersistentVariables: chunkState.globalPersistentVariables
          ? Array.from(chunkState.globalPersistentVariables.entries())
          : undefined,
        globalLabelVariableLiteralTargets: Array.from(
          chunkState.globalLabelVariableLiteralTargets.entries(),
        ),
        globalLabelVariableDictTargets: Array.from(
          chunkState.globalLabelVariableDictTargets.entries(),
        ).map(([k, v]) => [k, Array.from(v.entries())]),
        globalLabelVariableListTargets: Array.from(
          chunkState.globalLabelVariableListTargets.entries(),
        ),
        nodeMutations: chunkState.nodeMutations
          ? Array.from(chunkState.nodeMutations.entries())
          : undefined,
        imageDefinitions: chunkState.imageDefinitions
          ? Array.from(chunkState.imageDefinitions.entries())
          : undefined,
        assets: chunkState.assets,
        allConditionalExpressions: chunkState.allConditionalExpressions,
      };
    } finally {
      cancelledRequests.delete(requestId);
    }
  },

  async parseFileFragment(
    requestId: number,
    file: ParseInputFile,
    options: {
      fileCacheKey?: string;
      captureDialogueLines?: boolean;
      deferDetails?: boolean;
      parserVariant?: ParserVariant;
      screenActionRules?: ScreenActionRule[];
      sceneSplitDialogueThreshold?: number;
    },
    fileIndex: number = 0,
  ): Promise<FileGraphFragment> {
    if (file.content instanceof Uint8Array) {
      file.content = new TextDecoder("utf-8").decode(file.content);
    }
    try {
      if (cancelledRequests.has(requestId)) {
        throw new Error("File fragment parsing cancelled");
      }
      const tokenized = await tokenizeOneFile(
        file,
        {
          tokenizedCache,
          fileCacheKeys: options.fileCacheKey
            ? [options.fileCacheKey]
            : undefined,
        },
        fileIndex,
      );
      const state = createGraphState();
      processTokenizedFile(state, tokenized, {
        captureDialogueLines: options.captureDialogueLines !== false,
        deferDetails: options.deferDetails,
        parserVariant: options.parserVariant,
        screenActionRules: options.screenActionRules,
        sceneSplitDialogueThreshold: options.sceneSplitDialogueThreshold,
      });
      return createFileGraphFragment(state, file, fileIndex);
    } finally {
      cancelledRequests.delete(requestId);
    }
  },

  async tokenize(
    requestId: number,
    files: ParseInputFile[],
    options: {
      fileCacheKeys?: string[];
      storeOffThread?: boolean;
    } = {},
  ): Promise<{ fileCacheKeys: string[]; elapsedMs: number }> {
    const startedAt = performance.now();
    const fileCacheKeys: string[] = [];
    for (let idx = 0; idx < files.length; idx += 1) {
      if (cancelledRequests.has(requestId)) {
        cancelledRequests.delete(requestId);
        throw new Error("Tokenize cancelled");
      }
      const file = files[idx]!;
      if (file.content instanceof Uint8Array) {
        file.content = new TextDecoder("utf-8").decode(file.content);
      }
      const tokenized = await tokenizeOneFile(
        file,
        { tokenizedCache, fileCacheKeys: options.fileCacheKeys },
        idx,
      );
      if (tokenized.cacheKey) {
        fileCacheKeys.push(tokenized.cacheKey);
      }
    }
    cancelledRequests.delete(requestId);
    return {
      fileCacheKeys,
      elapsedMs: performance.now() - startedAt,
    };
  },

  async extractDetails(
    requestId: number,
    nodeIds: string[],
    options: { sessionId?: string } = {},
  ): Promise<Record<string, NodeDetailsPayload>> {
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      return {};
    }
    const sessionId = options.sessionId || "default";
    const session = getSession(sessionId);
    const targetNodeSet = new Set(nodeIds);
    const nodesToExtract = session.accumulatedState.nodes.filter((n) =>
      targetNodeSet.has(n.id)
    );

    const tokenizedFilesByChapter = await getOrFetchTokenizedMap(
      session,
      nodesToExtract,
    );

    const details = extractNodeDetailsFromTokens(
      nodesToExtract,
      tokenizedFilesByChapter,
    );

    for (const [id, payload] of Object.entries(details)) {
      const node = session.accumulatedState.nodeMap.get(id);
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

    cancelledRequests.delete(requestId);
    return details;
  },

  // deno-lint-ignore require-await
  async finalize(
    requestId: number,
    options: {
      sessionId?: string;
      files?: ParseInputFile[];
      nodes: FlowNode[];
      edges: FlowEdge[];
      diagnostics?: ParseDiagnosticPayload[];
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
      projectMediaFiles?:
        | Array<{ relativePath: string; fileName: string }>
        | Set<string>
        | string[];
      maxCallStackDepth?: number;
      allConditionalExpressions?: ParseGraphState["allConditionalExpressions"];
      screenDefinitions?: Array<
        [string, import("../parser/pipelineTypes.ts").ScreenDefinition]
      >;
      translations?: ProjectTranslations;
      availableLanguages?: string[];
      appendToActiveGraph?: boolean;
      resetActiveGraph?: boolean;
      isFinalChunk?: boolean;
      deferDetails?: boolean;
      captureDialogueLines?: boolean;
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

    if (options.files) {
      for (const file of options.files) {
        if (file.content instanceof Uint8Array) {
          file.content = new TextDecoder("utf-8").decode(file.content);
        }
        const chapterSource = file.relativePath ?? file.name;
        const chapter = chapterSource.replace(/\\/g, "/").replace(
          /\.rpy$/i,
          "",
        );
        session.rawFilesByChapter.set(chapter, file);
      }
    }

    try {
      if (appendToActiveGraph) {
        if (options.resetActiveGraph) {
          for (const sId of Array.from(sessions.keys())) {
            if (sId !== sessionId) {
              sessions.delete(sId);
            }
          }
          session.accumulatedState = createGraphState();
          session.rawFilesByChapter.clear();
          session.dialogueSearchDocs = [];
          session.dialogueSearchMiniSearch = null;
        }

        if (!session.accumulatedState.labelsByChapter) {
          session.accumulatedState.labelsByChapter = new Map();
        }
        for (const node of options.nodes) {
          session.accumulatedState.nodes.push(node);
          session.accumulatedState.nodeMap.set(node.id, node);
          if (node.type === "LABEL" && node.chapter) {
            let chapterMap = session.accumulatedState.labelsByChapter.get(
              node.chapter,
            );
            if (!chapterMap) {
              chapterMap = new Map();
              session.accumulatedState.labelsByChapter.set(
                node.chapter,
                chapterMap,
              );
            }
            const rawLabel = node.label || node.id.split("__shadow_")[0]!;
            if (!chapterMap.has(rawLabel)) {
              chapterMap.set(rawLabel, node.id);
            }
          }
        }
        for (const edge of options.edges) {
          session.accumulatedState.edges.push(edge);
          session.accumulatedState.edgeMap.set(edge.id, edge);
        }
        if (options.diagnostics) {
          session.accumulatedState.diagnostics.push(
            ...(options.diagnostics as ParseDiagnostic[]),
          );
        }
        session.accumulatedState.pendingCallReturns.push(
          ...(options.pendingCallReturns as PendingCallReturn[]),
        );
        if (options.hasReturnInLabel) {
          for (const label of options.hasReturnInLabel) {
            session.accumulatedState.hasReturnInLabel.add(label);
          }
        }
        for (const label of options.hasReliableReturnInLabel) {
          session.accumulatedState.hasReliableReturnInLabel.add(label);
        }
        if (options.calledLabels) {
          for (const label of options.calledLabels) {
            session.accumulatedState.calledLabels.add(label);
          }
        }
        if (options.calledFromMenuOptionTargets) {
          for (const label of options.calledFromMenuOptionTargets) {
            session.accumulatedState.calledFromMenuOptionTargets.add(label);
          }
        }
        for (const screen of options.globalScreens) {
          session.accumulatedState.globalScreens.add(screen);
        }
        if (options.globalCharacters) {
          for (const c of options.globalCharacters) {
            session.accumulatedState.globalCharacters.add(c);
          }
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

        if (options.nodeMutations) {
          if (!session.accumulatedState.nodeMutations) {
            session.accumulatedState.nodeMutations = new Map();
          }
          for (const [nId, muts] of options.nodeMutations) {
            const existing = session.accumulatedState.nodeMutations.get(nId) ??
              [];
            session.accumulatedState.nodeMutations.set(nId, [
              ...existing,
              ...muts,
            ]);
          }
        }
        if (options.initVariables) {
          if (!session.accumulatedState.initVariables) {
            session.accumulatedState.initVariables = new Map();
          }
          for (const [vName, desc] of options.initVariables) {
            const existing = session.accumulatedState.initVariables.get(vName);
            let shouldOverwrite: boolean;
            if (!existing) {
              shouldOverwrite = true;
            } else if (existing.kind === "define" && desc.kind !== "define") {
              shouldOverwrite = desc.priority > existing.priority;
            } else if (desc.kind === "define" && existing.kind !== "define") {
              shouldOverwrite = desc.priority >= existing.priority;
            } else if (desc.kind === "default" && existing.kind === "default") {
              shouldOverwrite = desc.priority > existing.priority;
            } else {
              shouldOverwrite = desc.priority >= existing.priority;
            }
            if (shouldOverwrite) {
              session.accumulatedState.initVariables.set(vName, desc);
            }
          }
        }
        if (options.globalPersistentVariables) {
          if (!session.accumulatedState.globalPersistentVariables) {
            session.accumulatedState.globalPersistentVariables = new Map();
          }
          for (const [k, v] of options.globalPersistentVariables) {
            session.accumulatedState.globalPersistentVariables.set(k, v);
          }
        }
        if (options.globalLabelVariableLiteralTargets) {
          for (const [k, v] of options.globalLabelVariableLiteralTargets) {
            session.accumulatedState.globalLabelVariableLiteralTargets.set(
              k,
              v,
            );
          }
        }
        if (options.globalLabelVariableDictTargets) {
          for (const [k, entries] of options.globalLabelVariableDictTargets) {
            let existingDict = session.accumulatedState
              .globalLabelVariableDictTargets.get(k);
            if (!existingDict) {
              existingDict = new Map();
              session.accumulatedState.globalLabelVariableDictTargets.set(
                k,
                existingDict,
              );
            }
            for (const [entryK, entryV] of entries) {
              existingDict.set(entryK, entryV);
            }
          }
        }
        if (options.globalLabelVariableListTargets) {
          for (const [k, list] of options.globalLabelVariableListTargets) {
            const existingList =
              session.accumulatedState.globalLabelVariableListTargets.get(k) ??
                [];
            session.accumulatedState.globalLabelVariableListTargets.set(
              k,
              Array.from(new Set([...existingList, ...list])),
            );
          }
        }
        if (options.assets) {
          if (!session.accumulatedState.assets) {
            session.accumulatedState.assets = [];
          }
          session.accumulatedState.assets.push(...options.assets);
        }
        if (options.imageDefinitions) {
          if (!session.accumulatedState.imageDefinitions) {
            session.accumulatedState.imageDefinitions = new Map();
          }
          for (const [k, v] of options.imageDefinitions) {
            session.accumulatedState.imageDefinitions.set(k, v);
          }
        }
        if (options.projectMediaFiles) {
          session.accumulatedState.projectMediaFiles =
            options.projectMediaFiles;
        }

        if (options.allConditionalExpressions) {
          if (!session.accumulatedState.allConditionalExpressions) {
            session.accumulatedState.allConditionalExpressions = [];
          }
          session.accumulatedState.allConditionalExpressions.push(
            ...options.allConditionalExpressions,
          );
        }
        if (options.maxCallStackDepth !== undefined) {
          session.accumulatedState.maxCallStackDepth =
            options.maxCallStackDepth;
        }

        if (isFinalChunk) {
          finalizeRoles(session.accumulatedState);
          materializeCallReturnEdges(session.accumulatedState);
          runControlFlowAnalysis(
            session.accumulatedState,
            options.projectMediaFiles,
          );
          buildDialogueSearchIndex(
            session,
            session.accumulatedState.nodes,
            Boolean(
              options.deferDetails || options.captureDialogueLines === false,
            ),
          );
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
          translations: session.accumulatedState.translations,
          availableLanguages: session.accumulatedState.availableLanguages,
        };
      } else {
        const state = createGraphState();
        state.nodes = options.nodes;
        state.edges = options.edges;
        state.labelsByChapter = new Map();
        for (const n of options.nodes) {
          state.nodeMap.set(n.id, n);
          if (n.type === "LABEL" && n.chapter) {
            let chapterMap = state.labelsByChapter.get(n.chapter);
            if (!chapterMap) {
              chapterMap = new Map();
              state.labelsByChapter.set(n.chapter, chapterMap);
            }
            const rawLabel = n.label || n.id.split("__shadow_")[0]!;
            if (!chapterMap.has(rawLabel)) {
              chapterMap.set(rawLabel, n.id);
            }
          }
        }
        for (const e of options.edges) state.edgeMap.set(e.id, e);
        state.diagnostics = options.diagnostics
          ? (options.diagnostics as ParseDiagnostic[])
          : [];
        state.pendingCallReturns = options
          .pendingCallReturns as PendingCallReturn[];
        if (options.hasReturnInLabel) {
          state.hasReturnInLabel = new Set(options.hasReturnInLabel);
        }
        state.hasReliableReturnInLabel = new Set(
          options.hasReliableReturnInLabel,
        );
        if (options.calledLabels) {
          state.calledLabels = new Set(options.calledLabels);
        }
        if (options.calledFromMenuOptionTargets) {
          state.calledFromMenuOptionTargets = new Set(
            options.calledFromMenuOptionTargets,
          );
        }
        state.globalScreens = new Set(options.globalScreens);
        if (options.globalCharacters) {
          state.globalCharacters = new Set(options.globalCharacters);
        }
        state.labelDefinitionCountByName = new Map(
          options.labelDefinitionCount,
        );
        state.canonicalLabelIdByName = new Map(options.canonicalLabelIds);

        if (options.nodeMutations) {
          state.nodeMutations = new Map();
          for (const [nId, muts] of options.nodeMutations) {
            const existing = state.nodeMutations.get(nId) ?? [];
            state.nodeMutations.set(nId, [...existing, ...muts]);
          }
        }
        if (options.initVariables) {
          state.initVariables = new Map();
          for (const [vName, desc] of options.initVariables) {
            const existing = state.initVariables.get(vName);
            let shouldOverwrite: boolean;
            if (!existing) {
              shouldOverwrite = true;
            } else if (existing.kind === "define" && desc.kind === "default") {
              shouldOverwrite = false;
            } else if (desc.kind === "define" && existing.kind === "default") {
              shouldOverwrite = true;
            } else if (desc.kind === "default" && existing.kind === "default") {
              shouldOverwrite = desc.priority > existing.priority;
            } else {
              shouldOverwrite = desc.priority >= existing.priority;
            }
            if (shouldOverwrite) {
              state.initVariables.set(vName, desc);
            }
          }
        }
        if (options.globalPersistentVariables) {
          state.globalPersistentVariables = new Map(
            options.globalPersistentVariables,
          );
        }
        if (options.globalLabelVariableLiteralTargets) {
          for (const [k, v] of options.globalLabelVariableLiteralTargets) {
            state.globalLabelVariableLiteralTargets.set(k, v);
          }
        }
        if (options.globalLabelVariableDictTargets) {
          for (const [k, entries] of options.globalLabelVariableDictTargets) {
            let existingDict = state.globalLabelVariableDictTargets.get(k);
            if (!existingDict) {
              existingDict = new Map();
              state.globalLabelVariableDictTargets.set(k, existingDict);
            }
            for (const [entryK, entryV] of entries) {
              existingDict.set(entryK, entryV);
            }
          }
        }
        if (options.globalLabelVariableListTargets) {
          for (const [k, list] of options.globalLabelVariableListTargets) {
            const existingList = state.globalLabelVariableListTargets.get(k) ??
              [];
            state.globalLabelVariableListTargets.set(
              k,
              Array.from(new Set([...existingList, ...list])),
            );
          }
        }
        if (options.assets) {
          state.assets = [...options.assets];
        }
        if (options.imageDefinitions) {
          state.imageDefinitions = new Map(options.imageDefinitions);
        }
        if (options.projectMediaFiles) {
          state.projectMediaFiles = options.projectMediaFiles;
        }
        if (options.allConditionalExpressions) {
          state.allConditionalExpressions = [
            ...options.allConditionalExpressions,
          ];
        }
        if (options.maxCallStackDepth !== undefined) {
          state.maxCallStackDepth = options.maxCallStackDepth;
        }
        if (options.screenDefinitions) {
          state.screenDefinitions = new Map(options.screenDefinitions);
        }
        if (options.translations) {
          state.translations = options.translations;
        }
        if (options.availableLanguages) {
          state.availableLanguages = options.availableLanguages;
        }

        session.accumulatedState = state;

        finalizeRoles(state);
        materializeCallReturnEdges(state);
        runControlFlowAnalysis(state, options.projectMediaFiles);
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
          translations: options.translations ?? state.translations,
          availableLanguages: options.availableLanguages ??
            state.availableLanguages,
        };
      }
    } finally {
      const wasCancelled = cancelledRequests.has(requestId);
      cancelledRequests.delete(requestId);
      if (wasCancelled) {
        clearSession(sessionId);
      }
    }
  },

  // deno-lint-ignore require-await
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
