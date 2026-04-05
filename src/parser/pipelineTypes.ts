import type { FlowNode, FlowEdge } from '../domain/graph';

export type EdgeKind = 'sequence' | 'jump' | 'call' | 'call_return';

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
  nodes: FlowNode[];
  edges: FlowEdge[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  nodeMap: Map<string, FlowNode>;
  menuCounter: number;
  allLabelIds: Set<string>;
  incomingByLabel: Map<string, Set<EdgeKind>>;
  outgoingByLabel: Map<string, Set<EdgeKind>>;
  hasReturnInLabel: Set<string>;
  calledLabels: Set<string>;
  calledFromMenuOptionTargets: Set<string>;
  pendingCallReturns: Array<{ callerLabelId: string; callTargetId: string }>;
}

export interface ParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface ParseProgress {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
}

export interface ParseOptions {
  onProgress?: (progress: ParseProgress) => void;
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
  hasSayNarrator: boolean;
  hasSayCharacter: boolean;
  hasSayStatement: boolean;
}
