import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { FlowNode, FlowEdge } from './domain';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT_LABEL = 90;
export const NODE_HEIGHT_MENU = 80;
export const PROGRESSIVE_LAYOUT_NODE_LIMIT = 220;
const PROGRESSIVE_FALLBACK_MAX_COLUMNS = 16;

const EDGE_KIND_FILTERS: ReadonlyArray<EdgeKindFilter> = ['sequence', 'jump', 'call', 'call_return'];

export interface NodeData extends Record<string, unknown> {
  label: string;
  dialogueCount: number;
  dialogueLines?: string[];
  nodeType: 'LABEL' | 'MENU';
  chapter?: string;
  parentLabelId?: string;
  theme: 'violet' | 'highContrast' | 'colorblind';
}

export interface EdgeData extends Record<string, unknown> {
  label: string;
  kind?: 'sequence' | 'jump' | 'call' | 'call_return';
}

export type LabelNodeType = Node<NodeData, 'labelNode'>;
export type MenuNodeType = Node<NodeData, 'menuNode'>;
export type CanvasNode = LabelNodeType | MenuNodeType;

export type LabeledEdgeType = Edge<EdgeData, 'labeled'>;
export type CanvasEdge = LabeledEdgeType;

export type EdgeKindFilter = 'sequence' | 'jump' | 'call' | 'call_return';

function normalizeEdgeKind(kind: string | undefined): EdgeKindFilter {
  if (kind && EDGE_KIND_FILTERS.includes(kind as EdgeKindFilter)) {
    return kind as EdgeKindFilter;
  }
  return 'sequence';
}

function compareStableIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function resolveGraphIntegrity(rawNodes: FlowNode[], rawEdges: FlowEdge[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodeMap = new Map<string, FlowNode>();
  const nodes: FlowNode[] = [];
  for (const node of rawNodes) {
    if (nodeMap.has(node.id)) continue;
    nodeMap.set(node.id, node);
    nodes.push(node);
  }

  const edges: FlowEdge[] = [];
  const seenEdgeKeys = new Set<string>();
  for (const edge of rawEdges) {
    if (!edge.source || !edge.target) continue;
    if (!nodeMap.has(edge.source)) {
      const sourcePlaceholder: FlowNode = {
        id: edge.source,
        type: 'LABEL',
        label: `(unresolved) ${edge.source}`,
        dialogueCount: 0,
        chapter: '__unresolved__',
      };
      nodeMap.set(edge.source, sourcePlaceholder);
      nodes.push(sourcePlaceholder);
    }
    if (!nodeMap.has(edge.target)) {
      const targetPlaceholder: FlowNode = {
        id: edge.target,
        type: 'LABEL',
        label: `(unresolved) ${edge.target}`,
        dialogueCount: 0,
        chapter: '__unresolved__',
      };
      nodeMap.set(edge.target, targetPlaceholder);
      nodes.push(targetPlaceholder);
    }
    const normalizedKind = normalizeEdgeKind(edge.kind);
    const semanticKey = `${normalizedKind}|${edge.source}|${edge.target}|${edge.label ?? ''}`;
    if (seenEdgeKeys.has(semanticKey)) continue;
    seenEdgeKeys.add(semanticKey);
    edges.push({
      ...edge,
      id: edge.id || `${normalizedKind}_${edge.source}__${edge.target}`,
      kind: normalizedKind,
    });
  }

  return { nodes, edges };
}

export function applyDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
  options?: {
    progressive?: boolean;
    previousPositions?: Map<string, { x: number; y: number }>;
  },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { nodes: normalizedNodes, edges: normalizedEdges } = resolveGraphIntegrity(rawNodes, rawEdges);
  const shouldUseProgressive =
    options?.progressive === true && normalizedNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;
  if (shouldUseProgressive) {
    return applyProgressiveDagreLayout(normalizedNodes, normalizedEdges, direction, options?.previousPositions);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: direction === 'TB' ? 80 : 110,
    nodesep: 50,
    marginx: 20,
    marginy: 20,
  });

  normalizedNodes.forEach((n) => {
    g.setNode(n.id, {
      width: NODE_WIDTH,
      height: n.type === 'LABEL' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU,
    });
  });

  normalizedEdges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    const pos = g.node(n.id);
    const h = n.type === 'LABEL' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU;
    return {
      id: n.id,
      type: n.type === 'LABEL' ? 'labelNode' : 'menuNode',
      position: {
        x: pos ? pos.x - NODE_WIDTH / 2 : 0,
        y: pos ? pos.y - h / 2 : 0,
      },
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        dialogueLines: n.dialogueLines,
        nodeType: n.type,
        chapter: n.chapter,
        parentLabelId: n.parentLabelId,
        theme: 'violet',
      },
      draggable: true,
    };
  });

  const edges: CanvasEdge[] = normalizedEdges
    .filter((e) => g.hasNode(e.source) && g.hasNode(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'labeled',
      data: { label: e.label ?? '', kind: e.kind },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

function applyProgressiveDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
  previousPositions?: Map<string, { x: number; y: number }>,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const orderedNodes = previousPositions ? rawNodes : [...rawNodes].sort((a, b) => compareStableIds(a.id, b.id));
  const subset = orderedNodes.slice(0, PROGRESSIVE_LAYOUT_NODE_LIMIT);
  const subsetIds = new Set(subset.map((n) => n.id));
  const subsetEdges = rawEdges.filter((e) => subsetIds.has(e.source) && subsetIds.has(e.target));
  const base = applyDagreLayout(subset, subsetEdges, direction);
  const positionById = new Map<string, { x: number; y: number }>(
    base.nodes.map((n) => [n.id, n.position]),
  );
  let maxX = 0;
  let maxY = 0;
  for (const node of base.nodes) {
    if (node.position.x > maxX) maxX = node.position.x;
    if (node.position.y > maxY) maxY = node.position.y;
  }

  const fallbackStartX = maxX + 80;
  const fallbackStartY = maxY + 80;
  const fallbackStrideX = NODE_WIDTH + 24;
  const fallbackStrideY = NODE_HEIGHT_LABEL + 24;
  let fallbackIndex = 0;
  const fallbackColumns = Math.max(
    4,
    Math.min(PROGRESSIVE_FALLBACK_MAX_COLUMNS, Math.ceil(Math.sqrt(Math.max(orderedNodes.length, 1)))),
  );
  for (const node of orderedNodes) {
    if (positionById.has(node.id)) continue;
    const previous = previousPositions?.get(node.id);
    if (previous) {
      positionById.set(node.id, previous);
      continue;
    }
    const col = fallbackIndex % fallbackColumns;
    const row = Math.floor(fallbackIndex / fallbackColumns);
    positionById.set(node.id, {
      x: fallbackStartX + col * fallbackStrideX,
      y: fallbackStartY + row * fallbackStrideY,
    });
    fallbackIndex += 1;
  }

  const nodes: CanvasNode[] = orderedNodes.map((n) => {
    const h = n.type === 'LABEL' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU;
    const pos = positionById.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: n.type === 'LABEL' ? 'labelNode' : 'menuNode',
      position: { x: pos.x, y: pos.y },
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        dialogueLines: n.dialogueLines,
        nodeType: n.type,
        chapter: n.chapter,
        parentLabelId: n.parentLabelId,
        theme: 'violet',
      },
      draggable: true,
      measured: { width: NODE_WIDTH, height: h },
    };
  });

  const edges: CanvasEdge[] = rawEdges
    .filter((e) => positionById.has(e.source) && positionById.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'labeled',
      data: { label: e.label ?? '', kind: e.kind },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

export function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  const nodeHeight = node.type === 'labelNode' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU;
  return {
    x: node.position.x + NODE_WIDTH / 2,
    y: node.position.y + nodeHeight / 2,
  };
}

export function buildVisibleNodes(params: {
  nodes: CanvasNode[];
  search: string;
  searchMatchNodeIds?: Set<string> | null;
  includeDialogueLineSearch?: boolean;
  dialogueMatchNodeIds?: Set<string> | null;
  minDialogue: number;
  collapsedChapters: Record<string, boolean>;
  collapsedLabelChildren: Set<string>;
  theme: 'violet' | 'highContrast' | 'colorblind';
  previousById?: Map<string, CanvasNode>;
}): CanvasNode[] {
  const {
    nodes,
    search,
    searchMatchNodeIds = null,
    includeDialogueLineSearch = true,
    dialogueMatchNodeIds = null,
    minDialogue,
    collapsedChapters,
    collapsedLabelChildren,
    theme,
    previousById,
  } = params;
  const query = search.trim().toLowerCase();
  return nodes.map((n) => {
    const nodeData = n.data as NodeData;
    const dialogueCountMatch = String(nodeData.dialogueCount).includes(query);
    const chapterCollapsed = nodeData.chapter ? collapsedChapters[nodeData.chapter] : false;
    const labelCollapsed = collapsedLabelChildren.has(n.id);
    const matchesSearch =
      query.length === 0 ||
      dialogueCountMatch ||
      (searchMatchNodeIds
        ? searchMatchNodeIds.has(n.id)
        : nodeData.label.toLowerCase().includes(query)) ||
      (dialogueMatchNodeIds ? dialogueMatchNodeIds.has(n.id) : false) ||
      (includeDialogueLineSearch &&
        (nodeData.dialogueLines ?? []).some((line) => line.toLowerCase().includes(query)));
    const matchesDialogue = nodeData.dialogueCount >= minDialogue;
    const hidden = Boolean(chapterCollapsed || labelCollapsed || !matchesSearch || !matchesDialogue);
    const previous = previousById?.get(n.id);
    if (previous) {
      const prevData = previous.data as NodeData;
      if (
        previous.hidden === hidden &&
        previous.position.x === n.position.x &&
        previous.position.y === n.position.y &&
        previous.measured?.width === n.measured?.width &&
        previous.measured?.height === n.measured?.height &&
        prevData.theme === theme &&
        prevData.label === nodeData.label &&
        prevData.dialogueCount === nodeData.dialogueCount &&
        prevData.dialogueLines === nodeData.dialogueLines &&
        prevData.nodeType === nodeData.nodeType &&
        prevData.chapter === nodeData.chapter &&
        prevData.parentLabelId === nodeData.parentLabelId
      ) {
        return previous;
      }
    }
    return {
      ...n,
      data: { ...nodeData, theme },
      hidden,
    };
  });
}

export function buildVisibleEdges(params: {
  edges: CanvasEdge[];
  showCallReturns: boolean;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
  visibleNodeIds: Set<string>;
  edgeColor: string;
  largeGraphMode: boolean;
  previousById?: Map<string, CanvasEdge>;
}): CanvasEdge[] {
  const {
    edges,
    showCallReturns,
    visibleEdgeKinds,
    visibleNodeIds,
    edgeColor,
    largeGraphMode,
    previousById,
  } =
    params;
  const visible: CanvasEdge[] = [];
  for (const edge of edges) {
    const edgeData = (edge.data as EdgeData | undefined) ?? { label: '' };
    const kind = normalizeEdgeKind(edgeData.kind);
    if (!visibleEdgeKinds[kind]) continue;
    if (!showCallReturns && kind === 'call_return') continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
    const edgeLabel = largeGraphMode && kind === 'sequence' ? '' : (edgeData.label ?? '');
    const previous = previousById?.get(edge.id);
    const previousData = previous?.data as EdgeData | undefined;
    if (
      previous &&
      previousData?.label === edgeLabel &&
      previousData?.kind === kind &&
      previous.source === edge.source &&
      previous.target === edge.target &&
      previous.style?.stroke === edgeColor
    ) {
      visible.push(previous);
      continue;
    }
    visible.push({
      ...edge,
      data: { ...edgeData, label: edgeLabel, kind },
      style: { ...(edge.style || {}), stroke: edgeColor, strokeWidth: 1.5 },
    });
  }
  return visible;
}
