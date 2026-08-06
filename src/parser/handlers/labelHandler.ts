import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import { type ConditionMetadata, type FlowEdge } from "../../domain/index.ts";
import { createDecisionConditionMetadata } from "./conditionHandler.ts";
import { menuHasFallthrough } from "./menuHandler.ts";
import { edgeIdWithOption, menuAtDepth } from "../scanTransitions.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "../graphMutations.ts";

/**
 * Determines whether the current scanner position lies within the indentation scope
 * of the currently active label block.
 */
export function isWithinCurrentLabelScope(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  lineIndent: number,
): boolean {
  if (meta.hasLabelStatement) {
    return true;
  }
  if (
    scanState.currentLabelId === null || scanState.currentLabelIndent === null
  ) {
    return false;
  }
  return lineIndent > scanState.currentLabelIndent;
}

export const LABEL_SCENE_ID_SEPARATOR = "__scene_";

export function toSceneLabelId(
  baseLabelId: string,
  sceneIndex: number,
): string {
  return `${baseLabelId}${LABEL_SCENE_ID_SEPARATOR}${sceneIndex}`;
}

export function replaceSetEntry(
  set: Set<string>,
  fromId: string,
  toId: string,
): void {
  if (!set.delete(fromId)) return;
  set.add(toId);
}

export function remapMapKey<T>(
  map: Map<string, T>,
  fromId: string,
  toId: string,
): void {
  if (!map.has(fromId)) return;
  const value = map.get(fromId) as T;
  map.delete(fromId);
  map.set(toId, value);
}

/**
 * Re-maps all incoming references, outgoing connections, and label definition indices
 * from an old label ID to a new label ID. Used when a label is split into scenes.
 */
export function remapLabelIdReferences(
  state: ParseGraphState,
  fromId: string,
  toId: string,
): void {
  if (fromId === toId) return;
  const node = state.nodeMap.get(fromId);
  if (node) {
    node.id = toId;
    state.nodeMap.delete(fromId);
    state.nodeMap.set(toId, node);
  }
  if (state.nodeIds.delete(fromId)) state.nodeIds.add(toId);
  if (state.allLabelIds.delete(fromId)) state.allLabelIds.add(toId);
  remapMapKey(state.outgoingByLabel, fromId, toId);
  remapMapKey(state.incomingByLabel, fromId, toId);
  replaceSetEntry(state.hasReturnInLabel, fromId, toId);
  replaceSetEntry(state.hasReliableReturnInLabel, fromId, toId);
  replaceSetEntry(state.calledLabels, fromId, toId);
  replaceSetEntry(state.calledFromMenuOptionTargets, fromId, toId);

  if (state.nodeMutations?.has(fromId)) {
    const muts = state.nodeMutations.get(fromId)!;
    state.nodeMutations.delete(fromId);
    for (const m of muts) {
      m.nodeId = toId;
    }
    const existing = state.nodeMutations.get(toId) ?? [];
    state.nodeMutations.set(toId, [...existing, ...muts]);
  }

  for (const pendingCallReturn of state.pendingCallReturns) {
    if (pendingCallReturn.returnTargetId === fromId) {
      pendingCallReturn.returnTargetId = toId;
    }
    if (pendingCallReturn.callTargetId === fromId) {
      pendingCallReturn.callTargetId = toId;
    }
  }
  if (state.graph.hasNode(fromId)) {
    const incidentEdges = state.graph.edges(fromId);
    for (const edgeId of incidentEdges) {
      const edge = state.edgeMap.get(edgeId);
      if (edge) {
        if (edge.source === fromId) edge.source = toId;
        if (edge.target === fromId) edge.target = toId;
      }
    }
  } else {
    for (const edge of state.edges) {
      if (edge.source === fromId) edge.source = toId;
      if (edge.target === fromId) edge.target = toId;
    }
  }
  for (const stateNode of state.nodeMap.values()) {
    if (stateNode.parentLabelId === fromId) {
      stateNode.parentLabelId = toId;
    }
  }
  for (
    const [labelName, canonicalLabelId] of state.canonicalLabelIdByName
      .entries()
  ) {
    if (canonicalLabelId === fromId) {
      state.canonicalLabelIdByName.set(labelName, toId);
    }
  }

  // Update state.graph incrementally
  if (state.graph.hasNode(fromId)) {
    const edges = state.graph.edges(fromId);
    const edgeDataMap = new Map<
      string,
      { source: string; target: string; data: FlowEdge }
    >();
    for (const edgeId of edges) {
      const source = state.graph.source(edgeId);
      const target = state.graph.target(edgeId);
      const data = state.graph.getEdgeAttributes(edgeId);
      edgeDataMap.set(edgeId, { source, target, data });
      state.graph.dropEdge(edgeId);
    }
    state.graph.dropNode(fromId);
    if (node) {
      state.graph.addNode(toId, node);
    }
    for (const [edgeId, edgeInfo] of edgeDataMap.entries()) {
      const newSource = edgeInfo.source === fromId ? toId : edgeInfo.source;
      const newTarget = edgeInfo.target === fromId ? toId : edgeInfo.target;
      if (state.graph.hasNode(newSource) && state.graph.hasNode(newTarget)) {
        state.graph.addDirectedEdgeWithKey(
          edgeId,
          newSource,
          newTarget,
          edgeInfo.data,
        );
      } else {
        state.pendingGraphEdgeIds.add(edgeId);
      }
    }
  }

  for (const edgeId of state.pendingGraphEdgeIds) {
    const edge = state.edgeMap.get(edgeId);
    if (edge) {
      if (edge.source === fromId) edge.source = toId;
      if (edge.target === fromId) edge.target = toId;
    }
  }

  for (const edgeId of [...state.pendingGraphEdgeIds]) {
    const edge = state.edgeMap.get(edgeId);
    if (
      edge && state.graph.hasNode(edge.source) &&
      state.graph.hasNode(edge.target)
    ) {
      if (!state.graph.hasEdge(edge.id)) {
        state.graph.addDirectedEdgeWithKey(
          edge.id,
          edge.source,
          edge.target,
          edge,
        );
      }
      state.pendingGraphEdgeIds.delete(edgeId);
    }
  }
}

export function connectSceneSplitFromSource(
  state: ParseGraphState,
  sourceId: string,
  nextSceneId: string,
  label?: string,
  condition?: ConditionMetadata,
): void {
  const baseEdgeId = `seq_${sourceId}__${nextSceneId}`;
  addEdge(state, {
    id: label ? edgeIdWithOption(baseEdgeId, label) : baseEdgeId,
    source: sourceId,
    target: nextSceneId,
    kind: "sequence",
    label,
    condition,
  });
  addOutgoing(state, sourceId, "sequence");
  addIncoming(state, nextSceneId, "sequence");
}

/**
 * Automatically splits a label into consecutive scenes (e.g. "LabelName: Scene 2")
 * if the dialogue line count within the scene boundaries exceeds the specified threshold.
 * This ensures large linear label blocks are broken down into digestible nodes.
 */
export function splitCurrentLabelOnSceneBoundary(
  state: ParseGraphState,
  scanState: ParseScanState,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
  sceneSplitDialogueThreshold?: number,
): void {
  const currentLabelId = scanState.currentLabelId;
  const currentLabelBaseId = scanState.currentLabelBaseId;
  const currentLabelDeclaredName = scanState.currentLabelDeclaredName;
  if (!currentLabelId || !currentLabelBaseId || !currentLabelDeclaredName) {
    return;
  }
  if (!scanState.currentLabelHasContentSinceSceneBoundary) return;
  const threshold = sceneSplitDialogueThreshold ?? 16;
  if ((scanState.currentSceneDialogueCount ?? 0) < threshold) return;

  let activeSceneId = currentLabelId;
  if (!scanState.currentLabelHasSplit) {
    const sceneOneId = toSceneLabelId(currentLabelBaseId, 1);
    remapLabelIdReferences(state, currentLabelId, sceneOneId);
    const sceneOneNode = state.nodeMap.get(sceneOneId);
    if (sceneOneNode) {
      sceneOneNode.label = `${currentLabelDeclaredName}: Scene 1`;
    }
    activeSceneId = sceneOneId;
    scanState.currentLabelId = sceneOneId;
    scanState.currentLabelHasSplit = true;
    scanState.currentLabelSceneIndex = 1;
  }

  const sceneIndex = (scanState.currentLabelSceneIndex ?? 1) + 1;
  const nextSceneId = toSceneLabelId(currentLabelBaseId, sceneIndex);
  addNode(state, {
    id: nextSceneId,
    type: "LABEL",
    label: `${currentLabelDeclaredName}: Scene ${sceneIndex}`,
    dialogueCount: 0,
    chapter,
  });

  const connectedSources = new Set<string>();

  const activeMenu = meta.hasMenuOptionBlock
    ? menuAtDepth(scanState.menuStack, menuDepth)
    : null;

  if (activeMenu) {
    connectSceneSplitFromSource(
      state,
      activeMenu.id,
      nextSceneId,
      activeMenu.optionText ?? undefined,
    );
    connectedSources.add(activeMenu.id);
  }

  if (scanState.pendingMenuFallthroughIds.length > 0) {
    for (const sourceId of scanState.pendingMenuFallthroughIds) {
      if (!connectedSources.has(sourceId)) {
        connectSceneSplitFromSource(state, sourceId, nextSceneId, "next");
        connectedSources.add(sourceId);
      }
    }
    scanState.pendingMenuFallthroughIds = [];
  }

  for (let index = scanState.menuStack.length - 1; index >= 0; index -= 1) {
    const menu = scanState.menuStack[index];
    if (menuHasFallthrough(menu) && !connectedSources.has(menu.id)) {
      connectSceneSplitFromSource(
        state,
        menu.id,
        nextSceneId,
        "next",
      );
      connectedSources.add(menu.id);
    }
  }

  if (connectedSources.size === 0) {
    const activeDecision = scanState
      .conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ];
    if (activeDecision) {
      connectSceneSplitFromSource(
        state,
        activeDecision.decisionNodeId,
        nextSceneId,
        undefined,
        createDecisionConditionMetadata(activeDecision),
      );
    } else {
      connectSceneSplitFromSource(state, activeSceneId, nextSceneId, "next");
    }
  }

  scanState.currentLabelId = nextSceneId;
  scanState.currentLabelSceneIndex = sceneIndex;
  scanState.currentSceneDialogueCount = 0;
  scanState.currentLabelHasContentSinceSceneBoundary = false;
}
