/**
 * src/parser/headlessParserEngine.ts
 *
 * Clean Headless Parser Engine powered by the modern AST Story Graph pipeline.
 * Manages sessions, dialogue search indexing, and details extraction.
 */

import { MultiDirectedGraph } from "graphology";
import {
  type DialogueSearchResult,
  type FlowEdge,
  type FlowNode,
  type NodeDetailsPayload,
  type ProjectTranslations,
} from "../domain/index.ts";
import type {
  ParseDiagnostic,
  ParseGraphState,
  ParseInputFile,
} from "./pipelineTypes.ts";
import {
  buildDialogueSearchIndex,
  type DialogueSearchTargetSession,
  searchDialogueIndex,
} from "./dialogueSearchIndex.ts";
import type { DialogueSearchDocument } from "../config/searchConfig.ts";
import { parseRenpyFilesModern } from "./modernParseService.ts";
import type {
  ParserVariant,
  ScreenActionRule,
  SerializableParserVariantPlugin,
} from "./plugins/index.ts";

export interface ParserSessionState extends DialogueSearchTargetSession {
  accumulatedState: ParseGraphState;
  rawFilesByChapter: Map<string, ParseInputFile>;
  nodeDetailsById?: Map<string, NodeDetailsPayload>;
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

export class HeadlessParserEngine {
  private sessions: Map<string, ParserSessionState> = new Map();

  public getSession(sessionId = "default"): ParserSessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        accumulatedState: {
          graph: new MultiDirectedGraph(),
          nodes: [],
          edges: [],
          nodeIds: new Set(),
          edgeIds: new Set(),
          nodeMap: new Map(),
          edgeMap: new Map(),
          pendingGraphEdgeIds: new Set(),
          menuCounter: 0,
          decisionCounter: 0,
          allLabelIds: new Set(),
          incomingByLabel: new Map(),
          outgoingByLabel: new Map(),
          hasReturnInLabel: new Set(),
          hasReliableReturnInLabel: new Set(),
          calledLabels: new Set(),
          calledFromMenuOptionTargets: new Set(),
          pendingCallReturns: [],
          canonicalLabelIdByName: new Map(),
          labelDefinitionCountByName: new Map(),
          labelsByChapter: new Map(),
          globalLabelVariableLiteralTargets: new Map(),
          globalLabelVariableDictTargets: new Map(),
          globalLabelVariableListTargets: new Map(),
          globalScreens: new Set(),
          globalCharacters: new Set(),
          diagnostics: [],
          diagnosticIds: new Set(),
        },
        rawFilesByChapter: new Map(),
        nodeDetailsById: new Map(),
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

  public searchDialogueLines(request: {
    query: string;
    sessionId?: string;
    nodeIds?: string[];
    maxResults?: number;
    signal?: AbortSignal;
    isCancelled?: () => boolean;
  }): Promise<DialogueSearchResult[]> {
    if (request.signal?.aborted || request.isCancelled?.()) {
      return Promise.resolve([]);
    }
    const session = this.getSession(request.sessionId || "default");
    return Promise.resolve(
      searchDialogueIndex(session, request.query, {
        nodeIds: request.nodeIds,
        maxResults: request.maxResults,
      }),
    );
  }

  public extractNodeDetails(
    nodeIds: string[],
    sessionId = "default",
    signal?: AbortSignal,
    isCancelled?: () => boolean,
  ): Promise<Record<string, NodeDetailsPayload>> {
    if (signal?.aborted || isCancelled?.()) {
      throw new DOMException("Extract details cancelled", "AbortError");
    }

    const session = this.getSession(sessionId);
    const result: Record<string, NodeDetailsPayload> = {};
    for (const id of nodeIds) {
      const details = session.nodeDetailsById?.get(id);
      if (details) {
        result[id] = details;
        const node = session.accumulatedState.nodeMap.get(id);
        if (node) {
          node.dialogueLines = details.dialogueLines;
          node.dialogueLineNums = details.dialogueLineNums;
          node.audioAssetCues = details.audioAssetCues;
          node.isDetailsLoaded = true;
        }
      } else {
        const node = session.accumulatedState.nodeMap.get(id);
        if (node && (node.dialogueLines || node.audioAssetCues)) {
          result[id] = {
            nodeId: id,
            dialogueLines: node.dialogueLines,
            dialogueLineNums: node.dialogueLineNums,
            audioAssetCues: node.audioAssetCues,
          };
          node.isDetailsLoaded = true;
        }
      }
    }
    return Promise.resolve(result);
  }

  public tokenizeFiles(
    files: ParseInputFile[],
    options?: { fileCacheKeys?: string[]; isCancelled?: () => boolean },
  ): Promise<{ fileCacheKeys: string[]; elapsedMs: number }> {
    const keys =
      options?.fileCacheKeys && options.fileCacheKeys.length === files.length
        ? options.fileCacheKeys
        : files.map((f, i) => `key_${f.name}_${i}`);
    return Promise.resolve({ fileCacheKeys: keys, elapsedMs: 0 });
  }

  public async parse(
    options: HeadlessParseOptions,
  ): Promise<HeadlessParseResult> {
    const {
      files,
      sessionId = "default",
      resetActiveGraph = false,
      parserVariant,
      onProgress,
      signal,
      isCancelled,
    } = options;

    if (signal?.aborted || isCancelled?.()) {
      throw new DOMException("Parsing cancelled", "AbortError");
    }

    const session = this.getSession(sessionId);

    if (resetActiveGraph) {
      this.pruneOldSessions(sessionId);
      session.accumulatedState = {
        graph: new MultiDirectedGraph(),
        nodes: [],
        edges: [],
        nodeIds: new Set(),
        edgeIds: new Set(),
        nodeMap: new Map(),
        edgeMap: new Map(),
        pendingGraphEdgeIds: new Set(),
        menuCounter: 0,
        decisionCounter: 0,
        allLabelIds: new Set(),
        incomingByLabel: new Map(),
        outgoingByLabel: new Map(),
        hasReturnInLabel: new Set(),
        hasReliableReturnInLabel: new Set(),
        calledLabels: new Set(),
        calledFromMenuOptionTargets: new Set(),
        pendingCallReturns: [],
        canonicalLabelIdByName: new Map(),
        labelDefinitionCountByName: new Map(),
        labelsByChapter: new Map(),
        globalLabelVariableLiteralTargets: new Map(),
        globalLabelVariableDictTargets: new Map(),
        globalLabelVariableListTargets: new Map(),
        globalScreens: new Set(),
        globalCharacters: new Set(),
        diagnostics: [],
        diagnosticIds: new Set(),
      };
      session.rawFilesByChapter.clear();
      session.nodeDetailsById = new Map();
      session.dialogueSearchDocs = [];
      session.dialogueSearchMiniSearch = null;
    }

    const modernResult = await parseRenpyFilesModern(files, {
      signal,
      parserVariant,
      deferDetails: options.deferDetails,
      captureDialogueLines: options.captureDialogueLines,
      onProgress: onProgress
        ? (p) =>
          onProgress({
            doneFiles: p.doneFiles,
            totalFiles: p.totalFiles,
            currentFile: p.currentFile,
            elapsedMs: 0,
          })
        : undefined,
    });

    session.accumulatedState.nodes = modernResult.nodes;
    session.accumulatedState.edges = modernResult.edges;
    session.accumulatedState.nodeMap = new Map(
      modernResult.nodes.map((n) => [n.id, n]),
    );
    session.accumulatedState.edgeMap = new Map(
      modernResult.edges.map((e) => [e.id, e]),
    );
    if (modernResult.diagnostics) {
      session.accumulatedState.diagnostics = modernResult.diagnostics;
    }
    if (modernResult.nodeDetails) {
      session.nodeDetailsById = modernResult.nodeDetails;
    }

    for (const file of files) {
      if (file.content instanceof Uint8Array) {
        file.content = new TextDecoder("utf-8").decode(file.content);
      }
      const chapterSource = file.relativePath ?? file.name;
      const chapter = chapterSource.replace(/\\/g, "/").replace(/\.rpy$/i, "");
      session.rawFilesByChapter.set(chapter, file);
    }

    buildDialogueSearchIndex(
      session,
      session.accumulatedState.nodes,
      session.translations,
    );

    return {
      nodes: modernResult.nodes,
      edges: modernResult.edges,
      diagnostics: modernResult.diagnostics,
      translations: session.translations,
      availableLanguages: session.availableLanguages,
    };
  }
}

export const headlessParserEngine = new HeadlessParserEngine();
