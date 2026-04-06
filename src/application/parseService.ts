import type { FlowEdge, FlowNode } from '../domain/graph';
import { parseRenpyFilesInWorker, searchDialogueLinesInWorker } from '../parseInWorker';
import type { DialogueSearchResult } from '../infrastructure/workerProtocol';

export interface ParseServiceRequest {
  files: Array<{ name: string; content: string }>;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
  captureDialogueLines?: boolean;
  onProgress?: (progress: {
    doneFiles: number;
    totalFiles: number;
    currentFile: string;
    elapsedMs?: number;
  }) => void;
  onPartialResult?: (partial: { nodes: FlowNode[]; edges: FlowEdge[] }) => void;
  signal?: AbortSignal;
}

export interface ParseService {
  parse(request: ParseServiceRequest): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }>;
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
