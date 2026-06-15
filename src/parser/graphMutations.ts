import type { FlowEdge, FlowNode } from "../domain";
import type { EdgeKind, ParseGraphState } from "./pipelineTypes";
import { assertInvariant } from "./pipelineInvariants";

function addLabelTraffic(
  bucket: Map<string, Set<EdgeKind>>,
  labelId: string,
  kind: EdgeKind,
) {
  const existing = bucket.get(labelId);
  if (existing) {
    existing.add(kind);
    return;
  }
  bucket.set(labelId, new Set<EdgeKind>([kind]));
}

export function addNode(state: ParseGraphState, node: FlowNode) {
  if (state.graph.hasNode(node.id)) return;
  state.graph.addNode(node.id, node);
  state.nodeIds.add(node.id);
  state.nodes.push(node);
  state.nodeMap.set(node.id, node);

  if (state.pendingGraphEdgeIds.size === 0) return;
  for (const edgeId of Array.from(state.pendingGraphEdgeIds)) {
    const edge = state.edgeMap.get(edgeId);
    if (!edge) {
      state.pendingGraphEdgeIds.delete(edgeId);
      continue;
    }
    if (
      !state.graph.hasNode(edge.source) || !state.graph.hasNode(edge.target)
    ) continue;
    state.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
    state.pendingGraphEdgeIds.delete(edge.id);
  }
}

export function addEdge(state: ParseGraphState, edge: FlowEdge) {
  if (state.graph.hasEdge(edge.id) || state.edgeIds.has(edge.id)) return;
  assertInvariant(Boolean(edge.source), `edge ${edge.id} has empty source`);
  assertInvariant(Boolean(edge.target), `edge ${edge.id} has empty target`);
  if (state.graph.hasNode(edge.source) && state.graph.hasNode(edge.target)) {
    state.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
  } else {
    state.pendingGraphEdgeIds.add(edge.id);
  }
  state.edgeIds.add(edge.id);
  state.edges.push(edge);
  state.edgeMap.set(edge.id, edge);
}

export function addIncoming(
  state: ParseGraphState,
  labelId: string,
  kind: EdgeKind,
) {
  addLabelTraffic(state.incomingByLabel, labelId, kind);
}

export function addOutgoing(
  state: ParseGraphState,
  labelId: string,
  kind: EdgeKind,
) {
  addLabelTraffic(state.outgoingByLabel, labelId, kind);
}
