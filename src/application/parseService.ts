import type {
  DialogueSearchResult,
  NodeDetailsPayload,
  ParseInputFile,
  ParseWorkerClientRequest,
  ParseWorkerClientResult,
} from "../parser/index.ts";

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
  tokenizeFiles?(
    files: ParseInputFile[],
    signal?: AbortSignal,
  ): Promise<{ fileCacheKeys: string[]; elapsedMs: number }>;
  extractNodeDetails?(
    nodeIds: string[],
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<Record<string, NodeDetailsPayload>>;
}
