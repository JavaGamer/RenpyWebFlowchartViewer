import type { FlowNode, FlowEdge } from '../domain';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree } from '@renpy/ast/out/tokenizer/token-definitions';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';
import type { MultiDirectedGraph } from 'graphology';

export type EdgeKind = 'sequence' | 'jump' | 'call' | 'call_return';

export interface ParseWarning {
  code: 'dynamic_target';
  chapter: string;
  construct: string;
  targetExpression: string;
  message: string;
  sourceId?: string;
}

export interface ParseScanState {
  currentLabelId: string | null;
  menuStack: Array<{ id: string; optionText: string | null }>;
  conditionalIndentStack: number[];
  labelHasExplicitExit: boolean;
  waitForLabelName: boolean;
  waitForJumpTarget: boolean;
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
  allLabelIds: Set<string>;
  incomingByLabel: Map<string, Set<EdgeKind>>;
  outgoingByLabel: Map<string, Set<EdgeKind>>;
  hasReturnInLabel: Set<string>;
  calledLabels: Set<string>;
  calledFromMenuOptionTargets: Set<string>;
  pendingCallReturns: Array<{ callerLabelId: string; callTargetId: string }>;
  warnings: ParseWarning[];
  warningIds: Set<string>;
}

export interface ParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings?: ParseWarning[];
}

export interface ParseProgress {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
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
