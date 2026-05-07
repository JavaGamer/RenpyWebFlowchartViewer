import type { FlowEdge, FlowNode } from '../domain';
import type { ParseGraphState, EdgeKind } from './pipelineTypes';
import { addParseDiagnostic } from './warnings';
import { MultiDirectedGraph } from 'graphology';

const VALID_EDGE_KINDS = new Set<EdgeKind>(['sequence', 'jump', 'call', 'call_return']);

function normalizeEdgeKind(edge: FlowEdge): EdgeKind {
  if (edge.kind && VALID_EDGE_KINDS.has(edge.kind)) return edge.kind;
  if (edge.id.startsWith('jump_')) return 'jump';
  if (edge.id.startsWith('call_')) return 'call';
  if (edge.id.startsWith('ret_')) return 'call_return';
  return 'sequence';
}

function stableSemanticEdgeId(edge: FlowEdge, kind: EdgeKind): string {
  return `${kind}|${edge.source}|${edge.target}|${edge.label ?? ''}`;
}

function resolveNormalizedEdgeId(edge: FlowEdge, kind: EdgeKind): string {
  return edge.id || `${kind}_${edge.source}__${edge.target}`;
}

function addLabelTraffic(
  bucket: Map<string, Set<EdgeKind>>,
  labelId: string,
  kind: EdgeKind,
): void {
  const existing = bucket.get(labelId);
  if (existing) {
    existing.add(kind);
    return;
  }
  bucket.set(labelId, new Set([kind]));
}

function rebuildReturnTrackingSet(existing: Set<string>, validNodeIds: Set<string>): Set<string> {
  return new Set(Array.from(existing).filter((labelId) => validNodeIds.has(labelId)));
}

export function normalizeGraphState(state: ParseGraphState): void {
  const normalizedNodes: FlowNode[] = [];
  const nodeMap = new Map<string, FlowNode>();

  for (const node of state.nodes) {
    if (!node.id) {
      addParseDiagnostic(
        state,
        {
          code: 'normalization',
          severity: 'warning',
          message: 'Dropped node with empty ID during parser normalization.',
          context: {
            category: 'invalid_node',
            detail: node.label,
          },
          recoveryAction: 'Ensure every parsed node has a non-empty stable ID.',
        },
        `diagnostic|normalization|invalid_node|${node.label}`,
      );
      continue;
    }
    if (nodeMap.has(node.id)) continue;
    nodeMap.set(node.id, node);
    normalizedNodes.push(node);
  }

  const normalizedEdges: FlowEdge[] = [];
  const semanticEdgeKeys = new Set<string>();
  const nodeIds = new Set(normalizedNodes.map((node) => node.id));

  for (const edge of state.edges) {
    if (!edge.source) {
      addParseDiagnostic(
        state,
        {
          code: 'normalization',
          severity: 'warning',
          message: `Dropped edge "${edge.id}" because source is empty.`,
          location: {
            edgeId: edge.id,
            targetId: edge.target,
          },
          context: {
            category: 'missing_edge_source',
          },
          recoveryAction: 'Ensure jump/call edge generation always sets a source ID.',
        },
        `diagnostic|normalization|missing_edge_source|${edge.id}`,
      );
      continue;
    }
    if (!edge.target) {
      addParseDiagnostic(
        state,
        {
          code: 'normalization',
          severity: 'warning',
          message: `Dropped edge "${edge.id}" because target is empty.`,
          location: {
            edgeId: edge.id,
            sourceId: edge.source,
          },
          context: {
            category: 'missing_edge_target',
          },
          recoveryAction: 'Ensure jump/call edge generation always sets a target ID.',
        },
        `diagnostic|normalization|missing_edge_target|${edge.id}`,
      );
      continue;
    }

    if (!nodeIds.has(edge.source)) {
      addParseDiagnostic(
        state,
        {
          code: 'normalization',
          severity: 'warning',
          message: `Dropped edge "${edge.id}" because source node "${edge.source}" does not exist.`,
          location: {
            edgeId: edge.id,
            sourceId: edge.source,
            targetId: edge.target,
          },
          context: {
            category: 'missing_edge_source',
          },
          recoveryAction: 'Ensure edge sources reference emitted nodes.',
        },
        `diagnostic|normalization|missing_edge_source_node|${edge.id}|${edge.source}`,
      );
      continue;
    }

    const normalizedKind = normalizeEdgeKind(edge);
    const normalizedEdgeId = resolveNormalizedEdgeId(edge, normalizedKind);
    if (edge.kind !== normalizedKind) {
      addParseDiagnostic(
        state,
        {
          code: 'normalization',
          severity: 'warning',
          message: `Normalized edge kind for "${normalizedEdgeId}" to "${normalizedKind}".`,
          location: {
            edgeId: normalizedEdgeId,
            sourceId: edge.source,
            targetId: edge.target,
          },
          context: {
            category: 'invalid_edge_kind',
            detail: String(edge.kind ?? 'undefined'),
          },
          recoveryAction: 'Emit edge kinds using known values: sequence, jump, call, or call_return.',
        },
        `diagnostic|normalization|invalid_edge_kind|${normalizedEdgeId}|${normalizedKind}|${edge.kind ?? 'undefined'}`,
      );
    }

    if (!nodeIds.has(edge.target)) {
      addParseDiagnostic(
        state,
        {
          code: 'unresolved_target',
          severity: 'warning',
          message: `Edge "${normalizedEdgeId}" targets unresolved label "${edge.target}".`,
          location: {
            edgeId: normalizedEdgeId,
            sourceId: edge.source,
            targetId: edge.target,
          },
          recoveryAction: 'Define the target label or update the jump/call target expression.',
        },
        `diagnostic|unresolved_target|${normalizedEdgeId}|${edge.source}|${edge.target}`,
      );
    }

    const normalizedEdge: FlowEdge = {
      ...edge,
      kind: normalizedKind,
      id: normalizedEdgeId,
    };
    const semanticKey = stableSemanticEdgeId(normalizedEdge, normalizedKind);
    if (semanticEdgeKeys.has(semanticKey)) {
      addParseDiagnostic(
        state,
        {
          code: 'normalization',
          severity: 'warning',
          message: `Dropped duplicate semantic edge "${normalizedEdge.id}".`,
          location: {
            edgeId: normalizedEdge.id,
            sourceId: normalizedEdge.source,
            targetId: normalizedEdge.target,
          },
          context: {
            category: 'duplicate_semantic_edge',
            detail: semanticKey,
          },
          recoveryAction: 'Avoid emitting duplicate edges with identical semantic meaning.',
        },
        `diagnostic|normalization|duplicate_semantic_edge|${semanticKey}`,
      );
      continue;
    }
    semanticEdgeKeys.add(semanticKey);
    normalizedEdges.push(normalizedEdge);
  }

  state.nodes = normalizedNodes;
  state.edges = normalizedEdges;
  state.nodeMap = new Map(normalizedNodes.map((node) => [node.id, node]));
  state.edgeMap = new Map(normalizedEdges.map((edge) => [edge.id, edge]));
  state.nodeIds = new Set(normalizedNodes.map((node) => node.id));
  state.edgeIds = new Set(normalizedEdges.map((edge) => edge.id));
  state.allLabelIds = new Set(normalizedNodes.filter((node) => node.type === 'LABEL').map((node) => node.id));

  state.incomingByLabel = new Map();
  state.outgoingByLabel = new Map();
  state.calledLabels = new Set();
  state.calledFromMenuOptionTargets = new Set();
  state.hasReturnInLabel = rebuildReturnTrackingSet(state.hasReturnInLabel, state.nodeIds);

  for (const edge of normalizedEdges) {
    const edgeKind = edge.kind ?? 'sequence';
    if (state.nodeIds.has(edge.source)) {
      addLabelTraffic(state.outgoingByLabel, edge.source, edgeKind);
    }
    if (state.nodeIds.has(edge.target)) {
      addLabelTraffic(state.incomingByLabel, edge.target, edgeKind);
    }
    if (edgeKind === 'call') {
      state.calledLabels.add(edge.target);
      const sourceNode = state.nodeMap.get(edge.source);
      if (sourceNode?.type === 'MENU') {
        state.calledFromMenuOptionTargets.add(edge.target);
      }
    }
  }

  state.graph = new MultiDirectedGraph<FlowNode, FlowEdge>();
  state.pendingGraphEdgeIds = new Set();
  for (const node of normalizedNodes) {
    state.graph.addNode(node.id, node);
  }
  for (const edge of normalizedEdges) {
    if (state.graph.hasNode(edge.source) && state.graph.hasNode(edge.target)) {
      state.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
      continue;
    }
    state.pendingGraphEdgeIds.add(edge.id);
  }
}
