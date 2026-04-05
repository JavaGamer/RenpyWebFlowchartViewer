import type { FlowNode } from '../types';
import type { ParseGraphState, ParseScanState, EdgeKind } from './pipelineTypes';

export function createGraphState(): ParseGraphState {
  return {
    nodes: [],
    edges: [],
    nodeIds: new Set<string>(),
    edgeIds: new Set<string>(),
    nodeMap: new Map<string, FlowNode>(),
    menuCounter: 0,
    allLabelIds: new Set<string>(),
    incomingByLabel: new Map<string, Set<EdgeKind>>(),
    outgoingByLabel: new Map<string, Set<EdgeKind>>(),
    hasReturnInLabel: new Set<string>(),
    calledLabels: new Set<string>(),
    calledFromMenuOptionTargets: new Set<string>(),
    pendingCallReturns: [],
  };
}

export function createScanState(): ParseScanState {
  return {
    currentLabelId: null,
    menuStack: [],
    conditionalIndentStack: [],
    labelHasExplicitExit: false,
    waitForLabelName: false,
    waitForJumpTarget: false,
    waitForCallTarget: false,
    waitForMenuNameForId: null,
  };
}
