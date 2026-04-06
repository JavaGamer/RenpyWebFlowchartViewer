import type { FlowEdge, FlowNode } from '../domain/graph';
import {
  parseRenpyFilesInWorker,
  searchDialogueLinesInWorker,
  type ParseWorkerClientRequest,
  type ParseWorkerClientResult,
} from '../infrastructure';
import type { DialogueSearchResult } from '../infrastructure/workerProtocol';

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
