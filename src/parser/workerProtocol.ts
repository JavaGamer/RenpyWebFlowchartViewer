import type {
  AudioAssetCue,
  FlowAsset,
  FlowEdge,
  FlowNode,
  SourceLocation,
} from "../domain/index.ts";
import type { ParserVariant, ScreenActionRule } from "../config/parserRules.ts";
import type {
  InitVariableDescriptor,
  ParseInputFile,
  PendingCallReturn,
  VariableMutation,
  VariableValue,
} from "./pipelineTypes.ts";

export const PARSER_WORKER_PROTOCOL_VERSION = 4 as const;

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
  files: ParseInputFile[];
  onProgress?: (progress: ParseProgressPayload) => void;
  signal?: AbortSignal;
  maxParallelFiles?: number;
  captureDialogueLines?: boolean;
  deferDetails?: boolean;
  parserVariant?: ParserVariant;
  screenActionRules?: ScreenActionRule[];
  sceneSplitDialogueThreshold?: number;
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  maxCallStackDepth?: number;
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
  diagnostics?: ParseDiagnosticPayload[];
}

export interface ParseRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "parse";
  requestId: number;
  files: ParseInputFile[];
  fileCacheKeys?: string[];
  wantsProgress?: boolean;
  maxParallelFiles?: number;
  captureDialogueLines?: boolean;
  deferDetails?: boolean;
  parserVariant?: ParserVariant;
  screenActionRules?: ScreenActionRule[];
  sceneSplitDialogueThreshold?: number;
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  maxCallStackDepth?: number;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
}

export interface TokenizeRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "tokenize";
  requestId: number;
  files: ParseInputFile[];
  fileCacheKeys?: string[];
  storeOffThread?: boolean;
}

export interface SerializedTokenPayload {
  type: number;
  metaTokens: number[];
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  startOffset: number;
  endOffset: number;
  val?: string;
}

export interface SerializedTokenizedFilePayload {
  fileIndex: number;
  cacheKey?: string;
  chapter: string;
  docText: string;
  tokens: SerializedTokenPayload[];
}

export interface NodeDetailsPayload {
  nodeId: string;
  dialogueLines?: string[];
  dialogueLineNums?: number[];
  audioAssetCues?: AudioAssetCue[];
}

export interface ExtractDetailsRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "extract_details";
  requestId: number;
  sessionId?: string;
  nodeIds: string[];
}

export interface DialogueSearchResult {
  nodeId: string;
  nodeLabel: string;
  lineIndex: number;
  lineText: string;
}

export interface SearchRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "search";
  requestId: number;
  query: string;
  nodeIds?: string[];
  maxResults?: number;
}

export interface ParseChunkRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "parse_chunk";
  requestId: number;
  files: ParseInputFile[];
  fileCacheKeys?: string[];
  captureDialogueLines?: boolean;
  deferDetails?: boolean;
  parserVariant?: ParserVariant;
  screenActionRules?: ScreenActionRule[];
  sceneSplitDialogueThreshold?: number;
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  maxCallStackDepth?: number;
}

export interface FinalizeRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "finalize";
  requestId: number;
  sessionId?: string;
  files?: ParseInputFile[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnosticPayload[];
  pendingCallReturns: PendingCallReturn[];
  hasReturnInLabel?: string[];
  hasReliableReturnInLabel: string[];
  calledLabels?: string[];
  calledFromMenuOptionTargets?: string[];
  globalScreens: string[];
  globalCharacters?: string[];
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
  initVariables?: Array<[string, InitVariableDescriptor]>;
  globalPersistentVariables?: Array<[string, VariableValue]>;
  globalLabelVariableLiteralTargets?: Array<[string, string]>;
  globalLabelVariableDictTargets?: Array<[string, Array<[string, string]>]>;
  globalLabelVariableListTargets?: Array<[string, string[]]>;
  nodeMutations?: Array<[string, VariableMutation[]]>;
  imageDefinitions?: Array<[string, string]>;
  assets?: FlowAsset[];
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  maxCallStackDepth?: number;
  allConditionalExpressions?: Array<{
    expression: string;
    branchKind: string;
    chapter?: string;
    sourceId?: string;
    sourceLocation?: SourceLocation;
  }>;
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
}

export interface CancelRequestMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "cancel";
  requestId: number;
}

export type WorkerRequestMessage =
  | ParseRequestMessage
  | ParseChunkRequestMessage
  | TokenizeRequestMessage
  | ExtractDetailsRequestMessage
  | FinalizeRequestMessage
  | SearchRequestMessage
  | CancelRequestMessage;

export interface ProgressResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "progress";
  requestId: number;
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

export interface ResultResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "result";
  requestId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnosticPayload[];
  elapsedMs?: number;
  partial?: boolean;
}

export interface ParseDiagnosticPayload {
  code:
    | "dynamic_target"
    | "normalization"
    | "unresolved_target"
    | "shadowed_label"
    | "missing_asset";
  severity: "warning" | "error";
  message: string;
  location?: {
    chapter?: string;
    construct?: string;
    targetExpression?: string;
    edgeId?: string;
    sourceId?: string;
    targetId?: string;
    sourceLocation?: SourceLocation;
  };
  context?: {
    category?:
      | "invalid_node"
      | "duplicate_node"
      | "missing_edge_source"
      | "missing_edge_target"
      | "invalid_edge_kind"
      | "duplicate_semantic_edge"
      | "shadowed_label"
      | "shadowed_target_resolution"
      | "unreachable_label"
      | "infinite_loop"
      | "missing_return"
      | "uncalled_return"
      | "dead_branch"
      | "dead_menu_option"
      | "missing_asset"
      | "dangling_stack"
      | "call_cycle_deadlock"
      | "unused_variable"
      | "undeclared_variable"
      | "excessive_call_depth";
    detail?: string;
  };
  recoveryAction?: string;
}

export interface DynamicTargetParseDiagnosticPayload
  extends ParseDiagnosticPayload {
  code: "dynamic_target";
  location: {
    chapter: string;
    construct: string;
    targetExpression: string;
    sourceId?: string;
  };
}

export interface UnresolvedTargetParseDiagnosticPayload
  extends ParseDiagnosticPayload {
  code: "unresolved_target";
  location: {
    edgeId: string;
    sourceId: string;
    targetId: string;
  };
}

export interface NormalizationParseDiagnosticPayload
  extends ParseDiagnosticPayload {
  code: "normalization";
  context: {
    category:
      | "invalid_node"
      | "duplicate_node"
      | "missing_edge_source"
      | "missing_edge_target"
      | "invalid_edge_kind"
      | "duplicate_semantic_edge"
      | "shadowed_label"
      | "shadowed_target_resolution"
      | "unreachable_label"
      | "infinite_loop"
      | "missing_return"
      | "uncalled_return"
      | "dead_branch"
      | "dead_menu_option"
      | "missing_asset"
      | "dangling_stack"
      | "call_cycle_deadlock"
      | "unused_variable"
      | "undeclared_variable"
      | "excessive_call_depth";
    detail?: string;
  };
}

export interface ShadowedLabelParseDiagnosticPayload
  extends ParseDiagnosticPayload {
  code: "shadowed_label";
}

export interface MissingAssetParseDiagnosticPayload
  extends ParseDiagnosticPayload {
  code: "missing_asset";
}

export type StrictParseDiagnosticPayload =
  | DynamicTargetParseDiagnosticPayload
  | UnresolvedTargetParseDiagnosticPayload
  | NormalizationParseDiagnosticPayload
  | ShadowedLabelParseDiagnosticPayload
  | MissingAssetParseDiagnosticPayload;

export interface ErrorResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "error";
  requestId: number;
  message: string;
  elapsedMs?: number;
}

export interface SearchResultResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "search_result";
  requestId: number;
  results: DialogueSearchResult[];
  elapsedMs?: number;
}

export interface ChunkResultResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "chunk_result";
  requestId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnosticPayload[];
  pendingCallReturns?: PendingCallReturn[];
  hasReturnInLabel?: string[];
  hasReliableReturnInLabel?: string[];
  calledLabels?: string[];
  calledFromMenuOptionTargets?: string[];
  globalScreens?: string[];
  globalCharacters?: string[];
  labelDefinitionCount?: Array<[string, number]>;
  canonicalLabelIds?: Array<[string, string]>;
  initVariables?: Array<[string, InitVariableDescriptor]>;
  globalPersistentVariables?: Array<[string, VariableValue]>;
  globalLabelVariableLiteralTargets?: Array<[string, string]>;
  globalLabelVariableDictTargets?: Array<[string, Array<[string, string]>]>;
  globalLabelVariableListTargets?: Array<[string, string[]]>;
  nodeMutations?: Array<[string, VariableMutation[]]>;
  imageDefinitions?: Array<[string, string]>;
  assets?: FlowAsset[];
  allConditionalExpressions?: Array<{
    expression: string;
    branchKind: string;
    chapter?: string;
    sourceId?: string;
    sourceLocation?: SourceLocation;
  }>;
  elapsedMs?: number;
}

export interface TokenizeResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "tokenize_result";
  requestId: number;
  fileCacheKeys: string[];
  tokenizedFiles?: SerializedTokenizedFilePayload[];
  elapsedMs?: number;
}

export interface ExtractDetailsResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "extract_details_result";
  requestId: number;
  details: Record<string, NodeDetailsPayload>;
  elapsedMs?: number;
}

export interface FinalizeResponseMessage {
  protocolVersion: typeof PARSER_WORKER_PROTOCOL_VERSION;
  type: "finalize_result";
  requestId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnosticPayload[];
  elapsedMs?: number;
  partial?: boolean;
}

export type WorkerResponseMessage =
  | ProgressResponseMessage
  | ResultResponseMessage
  | ChunkResultResponseMessage
  | TokenizeResponseMessage
  | ExtractDetailsResponseMessage
  | FinalizeResponseMessage
  | ErrorResponseMessage
  | SearchResultResponseMessage;
