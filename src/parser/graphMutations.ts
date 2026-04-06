import type { FlowEdge, FlowNode } from '../domain';
import type { ParseGraphState, EdgeKind } from './pipelineTypes';
import { assertInvariant } from './pipelineInvariants';

export function addNode(state: ParseGraphState, node: FlowNode) {
  if (!state.nodeIds.has(node.id)) {
    state.nodeIds.add(node.id);
    state.nodes.push(node);
    state.nodeMap.set(node.id, node);
  }
}

export function addEdge(state: ParseGraphState, edge: FlowEdge) {
  if (!state.edgeIds.has(edge.id)) {
    assertInvariant(Boolean(edge.source), `edge ${edge.id} has empty source`);
    assertInvariant(Boolean(edge.target), `edge ${edge.id} has empty target`);
    state.edgeIds.add(edge.id);
    state.edges.push(edge);
  }
}

export function addIncoming(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  const existing = state.incomingByLabel.get(labelId) ?? new Set<EdgeKind>();
  existing.add(kind);
  state.incomingByLabel.set(labelId, existing);
}

export function addOutgoing(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  const existing = state.outgoingByLabel.get(labelId) ?? new Set<EdgeKind>();
  existing.add(kind);
  state.outgoingByLabel.set(labelId, existing);
}
