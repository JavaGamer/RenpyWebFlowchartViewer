import type { FlowEdge, FlowNode } from '../domain';
import type { ParseGraphState, EdgeKind } from './pipelineTypes';
import { addParseWarning } from './warnings';

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

export function normalizeGraphState(state: ParseGraphState): void {
  const normalizedNodes: FlowNode[] = [];
  const nodeMap = new Map<string, FlowNode>();

  for (const node of state.nodes) {
    if (!node.id) {
      addParseWarning(
        state,
        {
          code: 'normalization',
          category: 'invalid_node',
          message: 'Dropped node with empty ID during parser normalization.',
          detail: node.label,
        },
        `normalization|invalid_node|${node.label}`,
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
      addParseWarning(
        state,
        {
          code: 'normalization',
          category: 'missing_edge_source',
          message: `Dropped edge "${edge.id}" because source is empty.`,
          edgeId: edge.id,
          targetId: edge.target,
        },
        `normalization|missing_edge_source|${edge.id}`,
      );
      continue;
    }
    if (!edge.target) {
      addParseWarning(
        state,
        {
          code: 'normalization',
          category: 'missing_edge_target',
          message: `Dropped edge "${edge.id}" because target is empty.`,
          edgeId: edge.id,
          sourceId: edge.source,
        },
        `normalization|missing_edge_target|${edge.id}`,
      );
      continue;
    }

    if (!nodeIds.has(edge.source)) {
      addParseWarning(
        state,
        {
          code: 'normalization',
          category: 'missing_edge_source',
          message: `Dropped edge "${edge.id}" because source node "${edge.source}" does not exist.`,
          edgeId: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
        },
        `normalization|missing_edge_source_node|${edge.id}|${edge.source}`,
      );
      continue;
    }

    const normalizedKind = normalizeEdgeKind(edge);
    if (edge.kind !== normalizedKind) {
      addParseWarning(
        state,
        {
          code: 'normalization',
          category: 'invalid_edge_kind',
          message: `Normalized edge kind for "${edge.id}" to "${normalizedKind}".`,
          edgeId: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
          detail: String(edge.kind ?? 'undefined'),
        },
        `normalization|invalid_edge_kind|${edge.id}|${normalizedKind}|${edge.kind ?? 'undefined'}`,
      );
    }

    if (!nodeIds.has(edge.target)) {
      addParseWarning(
        state,
        {
          code: 'unresolved_target',
          message: `Edge "${edge.id}" targets unresolved label "${edge.target}".`,
          edgeId: edge.id,
          sourceId: edge.source,
          targetId: edge.target,
        },
        `unresolved_target|${edge.id}|${edge.source}|${edge.target}`,
      );
    }

    const normalizedEdge: FlowEdge = {
      ...edge,
      kind: normalizedKind,
      id: edge.id || `${normalizedKind}_${edge.source}__${edge.target}`,
    };
    const semanticKey = stableSemanticEdgeId(normalizedEdge, normalizedKind);
    if (semanticEdgeKeys.has(semanticKey)) {
      addParseWarning(
        state,
        {
          code: 'normalization',
          category: 'duplicate_semantic_edge',
          message: `Dropped duplicate semantic edge "${normalizedEdge.id}".`,
          edgeId: normalizedEdge.id,
          sourceId: normalizedEdge.source,
          targetId: normalizedEdge.target,
          detail: semanticKey,
        },
        `normalization|duplicate_semantic_edge|${semanticKey}`,
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
}
