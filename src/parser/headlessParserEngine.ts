import pLimit from "p-limit";
import {
  compareFiles,
  type DialogueSearchResult,
  type FlowEdge,
  type FlowNode,
  type NodeDetailsPayload,
  type ProjectTranslations,
} from "../domain/index.ts";
import { createGraphState } from "./pipelineState.ts";
import { extractNodeDetailsFromTokens } from "./tokenScanStage.ts";
import { finalizeRoles } from "./roleFinalization.ts";
import { materializeCallReturnEdges } from "./callReturnFinalization.ts";
import { runControlFlowAnalysis } from "./controlFlowAnalysis.ts";
import { RENPY_TL_PATH_REGEX, scanTranslations } from "./translationScanner.ts";
import {
  processTokenizedFile,
  type TokenizedFile,
  tokenizeOneFile,
} from "./filePipeline.ts";
import { preParseInitialization } from "./initMapper.ts";
import type {
  ParseDiagnostic,
  ParseGraphState,
  ParseInputFile,
  TextDocument,
  TokenTree,
} from "./pipelineTypes.ts";
import {
  applyPrePassState,
  type FinalizeChunkOptions,
  type InternalChunkResult,
  mergeChunkIntoState,
  type PrePassState,
} from "./chunkProtocol.ts";
import {
  BoundedTokenizedCache,
  type TokenizedCacheEntry,
} from "./tokenizedCache.ts";
import {
  buildDialogueSearchIndex,
  type DialogueSearchTargetSession,
  searchDialogueIndex,
} from "./dialogueSearchIndex.ts";
import type { DialogueSearchDocument } from "../config/searchConfig.ts";
import {
  deserializeVariantPlugin,
  getParserVariantPlugins,
  type ParserVariant,
  registerParserVariantPlugin,
  type ScreenActionRule,
  type SerializableParserVariantPlugin,
  unregisterParserVariantPlugin,
} from "./plugins/index.ts";

export interface ParserSessionState extends DialogueSearchTargetSession {
  accumulatedState: ParseGraphState;
  rawFilesByChapter: Map<string, ParseInputFile>;
  dialogueSearchDocs: DialogueSearchDocument[];
  dialogueSearchMiniSearch:
    | import("minisearch").default<DialogueSearchDocument>
    | null;
  translations?: ProjectTranslations;
  availableLanguages?: string[];
}

export interface ParserProgressPayload {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

export interface HeadlessParseOptions {
  files: ParseInputFile[];
  sessionId?: string;
  fileCacheKeys?: string[];
  resetActiveGraph?: boolean;
  appendToActiveGraph?: boolean;
  isFinalChunk?: boolean;
  captureDialogueLines?: boolean;
  deferDetails?: boolean;
  parserVariant?: ParserVariant;
  customVariantPlugins?: SerializableParserVariantPlugin[];
  screenActionRules?: ScreenActionRule[];
  sceneSplitDialogueThreshold?: number;
  pruneDeadEndDecisions?: boolean;
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  maxCallStackDepth?: number;
  maxParallelFiles?: number;
  wantsProgress?: boolean;
  onProgress?: (progress: ParserProgressPayload) => void;
  onPartialResult?: (result: HeadlessParseResult) => void;
  signal?: AbortSignal;
  isCancelled?: () => boolean;
}

export interface HeadlessParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnostic[];
  translations?: ProjectTranslations;
  availableLanguages?: string[];
}

async function yieldToEventLoop(): Promise<void> {
  if (
    typeof globalThis !== "undefined" &&
    "scheduler" in globalThis &&
    typeof (globalThis as unknown as {
        scheduler?: { yield?: () => Promise<void> };
      })
        .scheduler?.yield === "function"
  ) {
    await (globalThis as unknown as {
      scheduler: { yield: () => Promise<void> };
    })
      .scheduler.yield();
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

export class HeadlessParserEngine {
  private sessions = new Map<string, ParserSessionState>();
  private tokenizedCache = new BoundedTokenizedCache(200);

  public getSession(sessionId = "default"): ParserSessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        accumulatedState: createGraphState(),
        rawFilesByChapter: new Map(),
        dialogueSearchDocs: [],
        dialogueSearchMiniSearch: null,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  public clearSession(sessionId?: string): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    } else {
      this.sessions.clear();
    }
  }

  public pruneOldSessions(activeSessionId: string): void {
    for (const sId of Array.from(this.sessions.keys())) {
      if (sId !== activeSessionId) {
        this.sessions.delete(sId);
      }
    }
  }

  public getTokenizedCache(): BoundedTokenizedCache {
    return this.tokenizedCache;
  }

  public async getOrFetchTokenizedMap(
    session: ParserSessionState,
    nodes: FlowNode[],
  ): Promise<Map<string, { document: TextDocument; tokenTree: TokenTree }>> {
    const tokenizedFilesByChapter = new Map<
      string,
      { document: TextDocument; tokenTree: TokenTree }
    >();

    for (const entry of this.tokenizedCache.values()) {
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
        const tokenized = await tokenizeOneFile(rawFile, {
          tokenizedCache: this.tokenizedCache,
        });
        tokenizedFilesByChapter.set(chapter, {
          document: tokenized.document,
          tokenTree: tokenized.tokenTree,
        });
      }
    }

    return tokenizedFilesByChapter;
  }

  public async searchDialogueLines(request: {
    query: string;
    sessionId?: string;
    nodeIds?: string[];
    maxResults?: number;
    signal?: AbortSignal;
    isCancelled?: () => boolean;
  }): Promise<DialogueSearchResult[]> {
    if (request.signal?.aborted || request.isCancelled?.()) {
      return [];
    }
    const session = this.getSession(request.sessionId || "default");
    return searchDialogueIndex(session, request.query, {
      nodeIds: request.nodeIds,
      maxResults: request.maxResults,
    });
  }

  public async extractNodeDetails(
    nodeIds: string[],
    sessionId = "default",
    signal?: AbortSignal,
    isCancelled?: () => boolean,
  ): Promise<Record<string, NodeDetailsPayload>> {
    if (signal?.aborted || isCancelled?.()) {
      throw new DOMException("Extract details cancelled", "AbortError");
    }

    const session = this.getSession(sessionId);
    const targetSet = new Set(nodeIds);
    const unhydratedNodes = session.accumulatedState.nodes.filter(
      (n) => targetSet.has(n.id) && !n.isDetailsLoaded && !n.dialogueLines,
    );

    if (unhydratedNodes.length > 0 && session.rawFilesByChapter.size > 0) {
      const tokenizedFilesByChapter = await this.getOrFetchTokenizedMap(
        session,
        unhydratedNodes,
      );
      const extracted = extractNodeDetailsFromTokens(
        unhydratedNodes,
        tokenizedFilesByChapter,
      );
      for (const [id, payload] of Object.entries(extracted)) {
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

          if (payload.dialogueLines && session.dialogueSearchMiniSearch) {
            for (let idx = 0; idx < payload.dialogueLines.length; idx += 1) {
              const doc: DialogueSearchDocument = {
                id: `${node.id}::${idx + 1}`,
                nodeId: node.id,
                nodeLabel: node.label,
                lineIndex: idx + 1,
                lineText: payload.dialogueLines[idx]!,
              };
              session.dialogueSearchDocs.push(doc);
              session.dialogueSearchMiniSearch.add(doc);
            }
          }
        }
      }
      return extracted;
    }

    const fallback: Record<string, NodeDetailsPayload> = {};
    for (const id of nodeIds) {
      const node = session.accumulatedState.nodeMap.get(id);
      if (node && (node.dialogueLines || node.audioAssetCues)) {
        fallback[id] = {
          nodeId: id,
          dialogueLines: node.dialogueLines,
          dialogueLineNums: node.dialogueLineNums,
          audioAssetCues: node.audioAssetCues,
        };
      }
    }
    return fallback;
  }

  public async tokenizeFiles(
    files: ParseInputFile[],
    options: {
      fileCacheKeys?: string[];
      maxParallelFiles?: number;
      isCancelled?: () => boolean;
    } = {},
  ): Promise<{ fileCacheKeys: string[]; elapsedMs: number }> {
    const startedAt = performance.now();
    const effectiveLimit = Math.max(1, options.maxParallelFiles ?? 4);
    const limit = pLimit(effectiveLimit);

    const keys = await Promise.all(
      files.map((file, idx) =>
        limit(async () => {
          if (options.isCancelled?.()) return "";
          const tokenized = await tokenizeOneFile(
            file,
            {
              tokenizedCache: this.tokenizedCache,
              fileCacheKeys: options.fileCacheKeys,
            },
            idx,
          );
          return tokenized.cacheKey ?? "";
        })
      ),
    );

    return {
      fileCacheKeys: keys,
      elapsedMs: performance.now() - startedAt,
    };
  }

  public async parse(
    options: HeadlessParseOptions,
  ): Promise<HeadlessParseResult> {
    const {
      files,
      sessionId = "default",
      fileCacheKeys,
      resetActiveGraph = false,
      isFinalChunk = true,
      captureDialogueLines = true,
      deferDetails,
      parserVariant,
      customVariantPlugins,
      screenActionRules,
      sceneSplitDialogueThreshold,
      pruneDeadEndDecisions,
      projectMediaFiles,
      maxCallStackDepth,
      maxParallelFiles,
      onProgress,
      onPartialResult,
      signal,
      isCancelled,
    } = options;

    if (signal?.aborted || isCancelled?.()) {
      throw new DOMException("Parsing cancelled", "AbortError");
    }

    if (customVariantPlugins && customVariantPlugins.length > 0) {
      for (const def of customVariantPlugins) {
        try {
          registerParserVariantPlugin(deserializeVariantPlugin(def));
        } catch {
          // Safe to ignore if already registered
        }
      }
    }

    const session = this.getSession(sessionId);

    if (resetActiveGraph) {
      this.pruneOldSessions(sessionId);
      for (const plugin of getParserVariantPlugins()) {
        if (plugin.isCustom) unregisterParserVariantPlugin(plugin.id);
      }
      session.accumulatedState = createGraphState(
        parserVariant,
        screenActionRules,
      );
      session.rawFilesByChapter.clear();
      session.dialogueSearchDocs = [];
      session.dialogueSearchMiniSearch = null;
    }

    if (projectMediaFiles) {
      session.accumulatedState.projectMediaFiles = projectMediaFiles;
    }
    if (maxCallStackDepth !== undefined) {
      session.accumulatedState.maxCallStackDepth = maxCallStackDepth;
    }

    // Deterministic file sort
    files.sort(compareFiles);

    // Track raw files and decode byte buffers
    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        file.content = new TextDecoder("utf-8").decode(file.content);
      }
      const chapterSource = file.relativePath ?? file.name;
      const chapter = chapterSource.replace(/\\/g, "/").replace(/\.rpy$/i, "");
      session.rawFilesByChapter.set(chapter, file);
    }

    // Translation scan
    const hasTlFiles = files.some((f) =>
      RENPY_TL_PATH_REGEX.test(f.relativePath ?? f.name)
    );
    if (hasTlFiles) {
      const projectTl = scanTranslations(files);
      session.translations = projectTl;
      session.availableLanguages = projectTl.availableLanguages;
    }

    if (resetActiveGraph || !session.accumulatedState.initVariables?.size) {
      preParseInitialization(files, session.accumulatedState);
    }

    // Parallel or sequential tokenization
    const concurrency = Math.max(1, maxParallelFiles ?? 1);
    let tokenizedFiles: Array<TokenizedFile | undefined> = [];

    if (files.length > 1 && concurrency > 1) {
      const limit = pLimit(concurrency);
      tokenizedFiles = await Promise.all(
        files.map((file, idx) =>
          limit(async () => {
            if (signal?.aborted || isCancelled?.()) return undefined;
            return await tokenizeOneFile(
              file,
              {
                tokenizedCache: this.tokenizedCache,
                fileCacheKeys,
              },
              idx,
            );
          })
        ),
      );
    }

    let lastYield = performance.now();
    const startedAt = performance.now();

    for (let idx = 0; idx < files.length; idx += 1) {
      if (signal?.aborted || isCancelled?.()) {
        throw new DOMException("Parsing cancelled", "AbortError");
      }

      const now = performance.now();
      if (idx > 0 && (idx % 20 === 0 || now - lastYield > 25)) {
        await yieldToEventLoop();
        lastYield = performance.now();
      }

      const file = files[idx]!;
      let tokenized = tokenizedFiles[idx];
      if (!tokenized) {
        tokenized = await tokenizeOneFile(
          file,
          {
            tokenizedCache: this.tokenizedCache,
            fileCacheKeys,
          },
          idx,
        );
      }

      processTokenizedFile(session.accumulatedState, tokenized, {
        captureDialogueLines: captureDialogueLines !== false,
        deferDetails,
        parserVariant,
        screenActionRules,
        sceneSplitDialogueThreshold,
        pruneDeadEndDecisions,
      });

      onProgress?.({
        doneFiles: idx + 1,
        totalFiles: files.length,
        currentFile: file.relativePath ?? file.name,
        elapsedMs: performance.now() - startedAt,
      });
    }

    if (isFinalChunk) {
      finalizeRoles(session.accumulatedState, {
        pruneDeadEndDecisions,
      });
      materializeCallReturnEdges(session.accumulatedState);
      runControlFlowAnalysis(
        session.accumulatedState,
        session.accumulatedState.projectMediaFiles,
      );
      buildDialogueSearchIndex(
        session,
        session.accumulatedState.nodes,
        session.translations,
      );
    }

    const result: HeadlessParseResult = {
      nodes: session.accumulatedState.nodes,
      edges: session.accumulatedState.edges,
      diagnostics: session.accumulatedState.diagnostics.length > 0
        ? session.accumulatedState.diagnostics
        : undefined,
      translations: session.translations,
      availableLanguages: session.availableLanguages,
    };

    if (!isFinalChunk) {
      onPartialResult?.(result);
    }

    return result;
  }

  public async parseChunk(
    files: ParseInputFile[],
    options: {
      tokenizedCache?: Map<string, TokenizedCacheEntry>;
      fileCacheKeys?: string[];
      captureDialogueLines?: boolean;
      deferDetails?: boolean;
      parserVariant?: ParserVariant;
      customVariantPlugins?: SerializableParserVariantPlugin[];
      screenActionRules?: ScreenActionRule[];
      sceneSplitDialogueThreshold?: number;
      pruneDeadEndDecisions?: boolean;
      maxCallStackDepth?: number;
      prePassState?: PrePassState;
      isCancelled?: () => boolean;
    },
  ): Promise<InternalChunkResult> {
    if (
      options.customVariantPlugins && options.customVariantPlugins.length > 0
    ) {
      for (const def of options.customVariantPlugins) {
        try {
          registerParserVariantPlugin(deserializeVariantPlugin(def));
        } catch {
          // ignore if already registered
        }
      }
    }
    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        file.content = new TextDecoder("utf-8").decode(file.content);
      }
    }
    const chunkState = createGraphState(
      options.parserVariant,
      options.screenActionRules,
    );
    applyPrePassState(chunkState, options.prePassState);

    for (let idx = 0; idx < files.length; idx += 1) {
      if (options.isCancelled?.()) {
        throw new Error("Chunk parsing cancelled");
      }
      if (idx > 0 && idx % 5 === 0) {
        await yieldToEventLoop();
      }
      const tokenized = await tokenizeOneFile(
        files[idx]!,
        {
          tokenizedCache: options.tokenizedCache ?? this.tokenizedCache,
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
        pruneDeadEndDecisions: options.pruneDeadEndDecisions,
      });
    }

    if (options.isCancelled?.()) {
      throw new Error("Chunk parsing cancelled");
    }

    return {
      nodes: chunkState.nodes,
      edges: chunkState.edges,
      diagnostics: chunkState.diagnostics.length > 0
        ? chunkState.diagnostics
        : undefined,
      pendingCallReturns: chunkState.pendingCallReturns,
      hasReturnInLabel: Array.from(chunkState.hasReturnInLabel),
      hasReliableReturnInLabel: Array.from(chunkState.hasReliableReturnInLabel),
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
  }

  public async finalize(
    options: FinalizeChunkOptions & { isCancelled?: () => boolean },
  ): Promise<HeadlessParseResult> {
    if (options.isCancelled?.()) {
      throw new Error("Finalize cancelled");
    }
    if (
      options.customVariantPlugins && options.customVariantPlugins.length > 0
    ) {
      for (const def of options.customVariantPlugins) {
        try {
          registerParserVariantPlugin(deserializeVariantPlugin(def));
        } catch {
          // ignore if already registered
        }
      }
    }
    const sessionId = options.sessionId || "default";
    const session = this.getSession(sessionId);
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

    if (options.resetActiveGraph) {
      this.pruneOldSessions(sessionId);
      for (const plugin of getParserVariantPlugins()) {
        if (plugin.isCustom) unregisterParserVariantPlugin(plugin.id);
      }
    }

    if (appendToActiveGraph) {
      if (options.resetActiveGraph) {
        session.accumulatedState = createGraphState(
          options.parserVariant,
          options.screenActionRules,
        );
        session.rawFilesByChapter.clear();
        session.dialogueSearchDocs = [];
        session.dialogueSearchMiniSearch = null;
      }

      mergeChunkIntoState(session.accumulatedState, options);

      if (isFinalChunk) {
        finalizeRoles(session.accumulatedState, {
          pruneDeadEndDecisions: options.pruneDeadEndDecisions,
        });
        materializeCallReturnEdges(session.accumulatedState);
        runControlFlowAnalysis(
          session.accumulatedState,
          options.projectMediaFiles,
        );
        buildDialogueSearchIndex(
          session,
          session.accumulatedState.nodes,
          options.translations ?? session.accumulatedState.translations,
        );
      }

      if (options.isCancelled?.()) {
        throw new Error("Finalize cancelled");
      }

      return {
        nodes: session.accumulatedState.nodes,
        edges: session.accumulatedState.edges,
        diagnostics: session.accumulatedState.diagnostics.length > 0
          ? session.accumulatedState.diagnostics
          : undefined,
        translations: session.accumulatedState.translations,
        availableLanguages: session.accumulatedState.availableLanguages,
      };
    } else {
      const state = createGraphState(
        options.parserVariant,
        options.screenActionRules,
      );
      mergeChunkIntoState(state, options);
      session.accumulatedState = state;

      finalizeRoles(state, {
        pruneDeadEndDecisions: options.pruneDeadEndDecisions,
      });
      materializeCallReturnEdges(state);
      runControlFlowAnalysis(state, options.projectMediaFiles);
      buildDialogueSearchIndex(session, state.nodes, options.translations);

      if (options.isCancelled?.()) {
        throw new Error("Finalize cancelled");
      }

      return {
        nodes: state.nodes,
        edges: state.edges,
        diagnostics: state.diagnostics.length > 0
          ? state.diagnostics
          : undefined,
        translations: options.translations ?? state.translations,
        availableLanguages: options.availableLanguages ??
          state.availableLanguages,
      };
    }
  }
}

export const headlessParserEngine = new HeadlessParserEngine();
