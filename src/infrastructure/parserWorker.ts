import { expose } from "comlink";
import {
  type FinalizeChunkOptions,
  headlessParserEngine,
  type InternalChunkResult,
  type ParseInputFile,
  type ParserVariant,
  type PrePassState,
  type ScreenActionRule,
  type SerializableParserVariantPlugin,
  type TokenizedCacheEntry,
} from "../parser/index.ts";
import type {
  DialogueSearchResult,
  NodeDetailsPayload,
} from "../domain/index.ts";
import type {
  ParseDiagnosticPayload,
  ParseWorkerClientResult,
} from "./workerProtocol.ts";

export interface ProgressPayload {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

export type { InternalChunkResult };

let activeRequestId: number | null = null;
const cancelledRequests = new Set<number>();

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
      customVariantPlugins?: SerializableParserVariantPlugin[];
      screenActionRules?: ScreenActionRule[];
      sceneSplitDialogueThreshold?: number;
      pruneDeadEndDecisions?: boolean;
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
    activeRequestId = requestId;
    try {
      const isCancelled = () =>
        activeRequestId !== requestId || cancelledRequests.has(requestId);

      const res = await headlessParserEngine.parse({
        files,
        sessionId: options.sessionId,
        fileCacheKeys: options.fileCacheKeys,
        resetActiveGraph: options.resetActiveGraph,
        appendToActiveGraph: options.appendToActiveGraph,
        isFinalChunk: options.isFinalChunk,
        captureDialogueLines: options.captureDialogueLines,
        deferDetails: options.deferDetails,
        parserVariant: options.parserVariant,
        customVariantPlugins: options.customVariantPlugins,
        screenActionRules: options.screenActionRules,
        sceneSplitDialogueThreshold: options.sceneSplitDialogueThreshold,
        pruneDeadEndDecisions: options.pruneDeadEndDecisions,
        projectMediaFiles: options.projectMediaFiles,
        maxCallStackDepth: options.maxCallStackDepth,
        maxParallelFiles: options.maxParallelFiles,
        wantsProgress: options.wantsProgress,
        onProgress,
        isCancelled,
      });

      return {
        nodes: res.nodes,
        edges: res.edges,
        diagnostics: res.diagnostics as ParseDiagnosticPayload[] | undefined,
        translations: res.translations,
        availableLanguages: res.availableLanguages,
      };
    } finally {
      const wasCancelled = cancelledRequests.has(requestId);
      cancelledRequests.delete(requestId);
      if (wasCancelled && options.sessionId) {
        headlessParserEngine.clearSession(options.sessionId);
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
      customVariantPlugins?: SerializableParserVariantPlugin[];
      screenActionRules?: ScreenActionRule[];
      sceneSplitDialogueThreshold?: number;
      pruneDeadEndDecisions?: boolean;
      maxCallStackDepth?: number;
      prePassState?: PrePassState;
    },
  ): Promise<InternalChunkResult> {
    try {
      const res = await headlessParserEngine.parseChunk(files, {
        ...options,
        isCancelled: () => cancelledRequests.has(requestId),
      });
      return res as InternalChunkResult;
    } finally {
      cancelledRequests.delete(requestId);
    }
  },

  async finalize(
    requestId: number,
    options: FinalizeChunkOptions,
  ): Promise<ParseWorkerClientResult> {
    try {
      const res = await headlessParserEngine.finalize({
        ...options,
        isCancelled: () => cancelledRequests.has(requestId),
      });
      return {
        nodes: res.nodes,
        edges: res.edges,
        diagnostics: res.diagnostics as ParseDiagnosticPayload[] | undefined,
        translations: res.translations,
        availableLanguages: res.availableLanguages,
      };
    } finally {
      const wasCancelled = cancelledRequests.has(requestId);
      cancelledRequests.delete(requestId);
      if (wasCancelled && options.sessionId) {
        headlessParserEngine.clearSession(options.sessionId);
      }
    }
  },

  tokenize(
    requestId: number,
    files: ParseInputFile[],
    options: {
      fileCacheKeys?: string[];
      storeOffThread?: boolean;
    } = {},
  ): Promise<{ fileCacheKeys: string[]; elapsedMs: number }> {
    try {
      if (cancelledRequests.has(requestId)) {
        return Promise.resolve({ fileCacheKeys: [], elapsedMs: 0 });
      }
      return headlessParserEngine.tokenizeFiles(files, {
        fileCacheKeys: options.fileCacheKeys,
        isCancelled: () => cancelledRequests.has(requestId),
      });
    } finally {
      cancelledRequests.delete(requestId);
    }
  },

  extractDetails(
    requestId: number,
    nodeIds: string[],
    options: { sessionId?: string } = {},
  ): Promise<Record<string, NodeDetailsPayload>> {
    try {
      if (cancelledRequests.has(requestId)) {
        return Promise.resolve({});
      }
      return headlessParserEngine.extractNodeDetails(
        nodeIds,
        options.sessionId,
        undefined,
        () => cancelledRequests.has(requestId),
      );
    } finally {
      cancelledRequests.delete(requestId);
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
    try {
      if (cancelledRequests.has(requestId)) {
        return [];
      }
      return await headlessParserEngine.searchDialogueLines({
        query,
        sessionId: options.sessionId,
        nodeIds: options.nodeIds,
        maxResults: options.maxResults,
        isCancelled: () => cancelledRequests.has(requestId),
      });
    } finally {
      cancelledRequests.delete(requestId);
    }
  },

  cancel(requestId: number) {
    cancelledRequests.add(requestId);
  },
};

expose(parserApi);

export type ParserWorkerApi = typeof parserApi;
export default null as unknown;
