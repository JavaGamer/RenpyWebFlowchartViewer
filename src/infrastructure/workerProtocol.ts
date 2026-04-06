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
  wantsProgress?: boolean;
}

export interface CancelRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'cancel';
  requestId: number;
}

export type WorkerRequestMessage = ParseRequestMessage | CancelRequestMessage;

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
}

export interface ErrorResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'error';
  requestId: number;
  message: string;
  elapsedMs?: number;
}

export type WorkerResponseMessage =
  | ProgressResponseMessage
  | ResultResponseMessage
  | ErrorResponseMessage;
