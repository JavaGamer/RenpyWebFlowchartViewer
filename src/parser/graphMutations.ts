import type { FlowEdge, FlowNode } from '../domain';
import type { ParseGraphState, EdgeKind } from './pipelineTypes';
import { assertInvariant } from './pipelineInvariants';

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

  for (const edge of state.edges) {
    if (state.graph.hasEdge(edge.id)) continue;
    if (!state.graph.hasNode(edge.source) || !state.graph.hasNode(edge.target)) continue;
    state.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
  }
}

export function addEdge(state: ParseGraphState, edge: FlowEdge) {
  if (state.graph.hasEdge(edge.id) || state.edgeIds.has(edge.id)) return;
  assertInvariant(Boolean(edge.source), `edge ${edge.id} has empty source`);
  assertInvariant(Boolean(edge.target), `edge ${edge.id} has empty target`);
  if (state.graph.hasNode(edge.source) && state.graph.hasNode(edge.target)) {
    state.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
  }
  state.edgeIds.add(edge.id);
  state.edges.push(edge);
}

export function addIncoming(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  addLabelTraffic(state.incomingByLabel, labelId, kind);
}

export function addOutgoing(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  addLabelTraffic(state.outgoingByLabel, labelId, kind);
}
