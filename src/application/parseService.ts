import {
  parseRenpyFilesInWorker,
  searchDialogueLinesInWorker,
  type ParseWorkerClientRequest,
  type ParseWorkerClientResult,
  type DialogueSearchResult,
} from '../infrastructure';

export type ParseServiceRequest = ParseWorkerClientRequest;
export type ParseServiceResult = ParseWorkerClientResult;

export interface ParseService {
  parse(request: ParseServiceRequest): Promise<ParseServiceResult>;
  searchDialogueLines(request: {
    query: string;
    nodeIds?: string[];
    maxResults?: number;
    signal?: AbortSignal;
  }): Promise<DialogueSearchResult[]>;
}

export const workerParseService: ParseService = {
  parse(request) {
    return parseRenpyFilesInWorker(request);
  },
  searchDialogueLines(request) {
    return searchDialogueLinesInWorker(request);
  },
};
