import type { FlowEdge, FlowNode } from '../domain/graph';

export const PARSER_WORKER_PROTOCOL_VERSION = 1 as const;

export interface ParseProgressPayload {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

export interface ParseRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: 'parse';
  requestId: number;
  files: Array<{ name: string; content: string }>;
  wantsProgress?: boolean;
  captureDialogueLines?: boolean;
  appendToActiveGraph?: boolean;
  isFinalChunk?: boolean;
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
  partial?: boolean;
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
