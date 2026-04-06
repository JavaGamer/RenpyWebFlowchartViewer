import type { FlowEdge, FlowNode } from '../domain';

export const PARSER_WORKER_PROTOCOL_VERSION = 1 as const;

export interface ParseProgressPayload {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

/**
 * Client-side parse request shape used by the worker wrapper.
 * This is not a structured-cloneable worker protocol payload because it may
 * contain callbacks and an AbortSignal.
 */
export interface ParseWorkerClientRequest {
  files: Array<{ name: string; content: string }>;
  onProgress?: (progress: ParseProgressPayload) => void;
  signal?: AbortSignal;
  maxParallelFiles?: number;
  captureDialogueLines?: boolean;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
  onPartialResult?: (partial: ParseWorkerClientResult) => void;
}

/**
 * Client-side parse result shape returned by the worker wrapper.
 * This is distinct from the wire-level worker protocol message types below.
 */
export interface ParseWorkerClientResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** @deprecated Use ParseWorkerClientRequest. */
export type ParseWorkerRequest = ParseWorkerClientRequest;
/** @deprecated Use ParseWorkerClientResult. */
export type ParseWorkerResult = ParseWorkerClientResult;

export interface ParseRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'parse';
  requestId: number;
  files: Array<{ name: string; content: string }>;
  fileCacheKeys?: string[];
  wantsProgress?: boolean;
  maxParallelFiles?: number;
  captureDialogueLines?: boolean;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
}

export interface DialogueSearchResult {
  nodeId: string;
  nodeLabel: string;
  lineIndex: number;
  lineText: string;
}

export interface SearchRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'search';
  requestId: number;
  query: string;
  nodeIds?: string[];
  maxResults?: number;
}

export interface CancelRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'cancel';
  requestId: number;
}

export type WorkerRequestMessage = ParseRequestMessage | SearchRequestMessage | CancelRequestMessage;

export interface ProgressResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'progress';
  requestId: number;
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

export interface ResultResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'result';
  requestId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  elapsedMs?: number;
  partial?: boolean;
}

export interface ErrorResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'error';
  requestId: number;
  message: string;
  elapsedMs?: number;
}

export interface SearchResultResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'search_result';
  requestId: number;
  results: DialogueSearchResult[];
  elapsedMs?: number;
}

export type WorkerResponseMessage =
  | ProgressResponseMessage
  | ResultResponseMessage
  | ErrorResponseMessage
  | SearchResultResponseMessage;
