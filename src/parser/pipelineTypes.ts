import type { FlowNode, FlowEdge } from '../domain';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree } from '@renpy/ast/out/tokenizer/token-definitions';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';
import type { MultiDirectedGraph } from 'graphology';

export type EdgeKind = 'sequence' | 'jump' | 'call' | 'call_return';
export type ConditionalBranchKind = 'if' | 'elif' | 'else';

export interface PendingConditionalHeader {
  kind: ConditionalBranchKind;
  indent: number;
  expression: string | null;
}

export interface ConditionalDecisionContext {
  indent: number;
  decisionNodeId: string;
  sourceId: string | null;
  branchKind: ConditionalBranchKind;
  expression: string | null;
  references: string[];
}

export interface ParseDiagnosticLocation {
  chapter?: string;
  construct?: string;
  sourceId?: string;
  targetId?: string;
  edgeId?: string;
  targetExpression?: string;
}

export interface ParseDiagnosticContext {
  category?:
    | 'invalid_node'
    | 'duplicate_node'
    | 'missing_edge_source'
    | 'missing_edge_target'
    | 'invalid_edge_kind'
    | 'duplicate_semantic_edge'
    | 'shadowed_label'
    | 'shadowed_target_resolution';
  detail?: string;
}

interface ParseDiagnosticBase {
  severity: 'warning' | 'error';
  message: string;
  location?: ParseDiagnosticLocation;
  context?: ParseDiagnosticContext;
  recoveryAction?: string;
}

export interface DynamicTargetParseDiagnostic extends ParseDiagnosticBase {
  code: 'dynamic_target';
  location: {
    chapter: string;
    construct: string;
    targetExpression: string;
    sourceId?: string;
  };
}

export interface NormalizationParseDiagnostic extends ParseDiagnosticBase {
  code: 'normalization';
  context: {
    category:
      | 'invalid_node'
      | 'duplicate_node'
      | 'missing_edge_source'
      | 'missing_edge_target'
      | 'invalid_edge_kind'
      | 'duplicate_semantic_edge'
      | 'shadowed_label'
      | 'shadowed_target_resolution';
    detail?: string;
  };
}

export interface ShadowedLabelParseDiagnostic extends ParseDiagnosticBase {
  code: 'shadowed_label';
}

export interface UnresolvedTargetParseDiagnostic extends ParseDiagnosticBase {
  code: 'unresolved_target';
  location: {
    edgeId: string;
    sourceId: string;
    targetId: string;
  };
}

export type ParseDiagnostic =
  | DynamicTargetParseDiagnostic
  | NormalizationParseDiagnostic
  | UnresolvedTargetParseDiagnostic
  | ShadowedLabelParseDiagnostic;

export interface ParseScanState {
  currentLabelId: string | null;
  currentLabelIndent: number | null;
  labelVariableLiteralTargets: Map<string, string>;
  menuStack: Array<{ id: string; optionText: string | null }>;
  pendingMenuFallthroughIds: string[];
  conditionalIndentStack: number[];
  pendingConditionalHeader: PendingConditionalHeader | null;
  conditionalDecisionStack: ConditionalDecisionContext[];
  labelHasExplicitExit: boolean;
  waitForLabelName: boolean;
  waitForJumpTarget: boolean;
  waitForJumpExpressionTarget: boolean;
  waitForCallTarget: boolean;
  waitForMenuNameForId: string | null;
}

export interface ParseGraphState {
  graph: MultiDirectedGraph<FlowNode, FlowEdge>;
  nodes: FlowNode[];
  edges: FlowEdge[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  nodeMap: Map<string, FlowNode>;
  edgeMap: Map<string, FlowEdge>;
  pendingGraphEdgeIds: Set<string>;
  menuCounter: number;
  decisionCounter: number;
  allLabelIds: Set<string>;
  incomingByLabel: Map<string, Set<EdgeKind>>;
  outgoingByLabel: Map<string, Set<EdgeKind>>;
  hasReturnInLabel: Set<string>;
  hasReliableReturnInLabel: Set<string>;
  calledLabels: Set<string>;
  calledFromMenuOptionTargets: Set<string>;
  pendingCallReturns: Array<{ returnTargetId: string; callTargetId: string }>;
  canonicalLabelIdByName: Map<string, string>;
  labelDefinitionCountByName: Map<string, number>;
  diagnostics: ParseDiagnostic[];
  diagnosticIds: Set<string>;
}

export interface ParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnostic[];
}

export interface ParseProgress {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
}

export interface ParseInputFile {
  name: string;
  content: string;
  relativePath?: string;
}

export interface ParseOptions {
  onProgress?: (progress: ParseProgress) => void;
  maxParallelFiles?: number;
  tokenizedCache?: Map<string, { document: TextDocument; tokenTree: TokenTree }>;
  fileCacheKeys?: string[];
  captureDialogueLines?: boolean;
  parserVariant?: ParserVariant;
  screenActionRules?: ScreenActionRule[];
}

export interface TokenMetaFlags {
  menuDepth: number;
  hasLabelStatement: boolean;
  hasMenuStatement: boolean;
  hasMenuBlock: boolean;
  hasMenuOption: boolean;
  hasMenuOptionBlock: boolean;
  hasJumpStatement: boolean;
  hasCallStatement: boolean;
  hasPythonBlock: boolean;
  hasScreenBlock: boolean;
  hasSayNarrator: boolean;
  hasSayCharacter: boolean;
  hasSayStatement: boolean;
}
