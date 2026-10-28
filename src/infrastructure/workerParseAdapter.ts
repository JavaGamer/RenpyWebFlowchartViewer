import type { NodeDetailsPayload } from "../domain/index.ts";
import type { ParseInputFile } from "../parser/index.ts";
import type {
  DialogueSearchResult,
  ParseWorkerClientRequest,
  ParseWorkerClientResult,
} from "./workerProtocol.ts";
import {
  extractNodeDetailsInWorker,
  parseRenpyFilesInWorker,
  searchDialogueLinesInWorker,
  tokenizeFilesInWorker,
} from "./parserWorkerClient.ts";

export const workerParseService = {
  parse(
    request: ParseWorkerClientRequest,
  ): Promise<ParseWorkerClientResult> {
    return parseRenpyFilesInWorker(request);
  },
  searchDialogueLines(request: {
    query: string;
    nodeIds?: string[];
    maxResults?: number;
    signal?: AbortSignal;
  }): Promise<DialogueSearchResult[]> {
    return searchDialogueLinesInWorker(request);
  },
  tokenizeFiles(
    files: ParseInputFile[],
    signal?: AbortSignal,
  ): Promise<{ fileCacheKeys: string[]; elapsedMs: number }> {
    return tokenizeFilesInWorker(files, signal);
  },
  extractNodeDetails(
    nodeIds: string[],
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, NodeDetailsPayload>> {
    return extractNodeDetailsInWorker(nodeIds, sessionId, signal);
  },
};
