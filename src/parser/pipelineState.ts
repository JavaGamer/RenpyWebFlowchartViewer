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
    decisionCounter: 0,
    allLabelIds: new Set<string>(),
    incomingByLabel: new Map<string, Set<EdgeKind>>(),
    outgoingByLabel: new Map<string, Set<EdgeKind>>(),
    hasReturnInLabel: new Set<string>(),
    hasReliableReturnInLabel: new Set<string>(),
    calledLabels: new Set<string>(),
    calledFromMenuOptionTargets: new Set<string>(),
    pendingCallReturns: [],
    canonicalLabelIdByName: new Map<string, string>(),
    labelDefinitionCountByName: new Map<string, number>(),
    diagnostics: [],
    diagnosticIds: new Set<string>(),
  };
}

export function createScanState(): ParseScanState {
  return {
    currentLabelId: null,
    currentLabelIndent: null,
    currentLabelDeclaredName: null,
    currentLabelBaseId: null,
    currentLabelSceneIndex: 1,
    currentLabelHasSplit: false,
    currentLabelHasContentSinceSceneBoundary: false,
    labelVariableLiteralTargets: new Map<string, string>(),
    menuStack: [],
    pendingMenuFallthroughIds: [],
    conditionalIndentStack: [],
    pendingConditionalHeader: null,
    conditionalDecisionStack: [],
    labelHasExplicitExit: false,
    waitForLabelName: false,
    waitForJumpTarget: false,
    waitForJumpExpressionTarget: false,
    waitForCallTarget: false,
    waitForMenuNameForId: null,
  };
}
