import type {
  DialogueSearchResult,
  ParseWorkerClientRequest,
  ParseWorkerClientResult,
} from "../parser/index.ts";
import {
  parseRenpyFilesInWorker,
  searchDialogueLinesInWorker,
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
};
