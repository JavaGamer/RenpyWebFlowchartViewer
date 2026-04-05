import type { FlowEdge, FlowNode } from '../domain/graph';
import { parseRenpyFilesInWorker } from '../parseInWorker';

export interface ParseServiceRequest {
  files: Array<{ name: string; content: string }>;
  onProgress?: (progress: {
    doneFiles: number;
    totalFiles: number;
    currentFile: string;
    elapsedMs?: number;
  }) => void;
  signal?: AbortSignal;
}

export interface ParseService {
  parse(request: ParseServiceRequest): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }>;
}

export const workerParseService: ParseService = {
  parse(request) {
    return parseRenpyFilesInWorker(request);
  },
};
