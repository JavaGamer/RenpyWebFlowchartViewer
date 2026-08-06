import type { FlowEdge, FlowNode } from "../domain/index.ts";
import { MultiDirectedGraph } from "graphology";
import type {
  EdgeKind,
  ParseGraphState,
  ParseScanState,
} from "./pipelineTypes.ts";

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
    labelsByChapter: new Map<string, Map<string, string>>(),
    globalLabelVariableLiteralTargets: new Map<string, string>(),
    globalLabelVariableDictTargets: new Map<string, Map<string, string>>(),
    globalLabelVariableListTargets: new Map<string, string[]>(),
    globalScreens: new Set<string>(),
    globalCharacters: new Set<string>(),
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
    currentSceneDialogueCount: 0,
    currentLabelStartLoc: null,
    currentLabelEndLoc: null,
    currentMenuStartLoc: null,
    labelVariableLiteralTargets: new Map<string, string>(),
    labelVariableDictTargets: new Map<string, Map<string, string>>(),
    labelVariableListTargets: new Map<string, string[]>(),
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
    lastConditionalLine: undefined,
    lastProcessedCustomLineNum: undefined,
  };
}
