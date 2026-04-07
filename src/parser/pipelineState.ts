import type { FlowEdge, FlowNode } from '../domain';
import { MultiDirectedGraph } from 'graphology';
import type { ParseGraphState, ParseScanState, EdgeKind } from './pipelineTypes';

export function createGraphState(): ParseGraphState {
  return {
    graph: new MultiDirectedGraph<FlowNode, FlowEdge>(),
    nodes: [],
    edges: [],
    nodeIds: new Set<string>(),
    edgeIds: new Set<string>(),
    nodeMap: new Map<string, FlowNode>(),
    edgeMap: new Map<string, FlowEdge>(),
    pendingGraphEdgeIds: new Set<string>(),
    menuCounter: 0,
    allLabelIds: new Set<string>(),
    incomingByLabel: new Map<string, Set<EdgeKind>>(),
    outgoingByLabel: new Map<string, Set<EdgeKind>>(),
    hasReturnInLabel: new Set<string>(),
    calledLabels: new Set<string>(),
    calledFromMenuOptionTargets: new Set<string>(),
    pendingCallReturns: [],
    warnings: [],
    warningIds: new Set<string>(),
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
