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
  if (state.nodeIds.has(node.id)) return;
  state.nodeIds.add(node.id);
  state.nodes.push(node);
  state.nodeMap.set(node.id, node);
}

export function addEdge(state: ParseGraphState, edge: FlowEdge) {
  if (state.edgeIds.has(edge.id)) return;
  assertInvariant(Boolean(edge.source), `edge ${edge.id} has empty source`);
  assertInvariant(Boolean(edge.target), `edge ${edge.id} has empty target`);
  state.edgeIds.add(edge.id);
  state.edges.push(edge);
}

export function addIncoming(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  addLabelTraffic(state.incomingByLabel, labelId, kind);
}

export function addOutgoing(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  addLabelTraffic(state.outgoingByLabel, labelId, kind);
}
