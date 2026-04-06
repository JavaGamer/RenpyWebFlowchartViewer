import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { FlowNode, FlowEdge } from './domain';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT_LABEL = 90;
export const NODE_HEIGHT_MENU = 80;

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

export function applyDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: direction === 'TB' ? 80 : 110,
    nodesep: 50,
    marginx: 20,
    marginy: 20,
  });

  rawNodes.forEach((n) => {
    g.setNode(n.id, {
      width: NODE_WIDTH,
      height: n.type === 'LABEL' ? NODE_HEIGHT_LABEL : NODE_HEIGHT_MENU,
    });
  });

  rawEdges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  const nodes: CanvasNode[] = rawNodes.map((n) => {
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

  const edges: CanvasEdge[] = rawEdges
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
  minDialogue: number;
  collapsedChapters: Record<string, boolean>;
  collapsedLabelChildren: Set<string>;
  theme: 'violet' | 'highContrast' | 'colorblind';
}): CanvasNode[] {
  const { nodes, search, minDialogue, collapsedChapters, collapsedLabelChildren, theme } = params;
  const query = search.trim().toLowerCase();
  return nodes.map((n) => {
    const nodeData = n.data as NodeData;
    const chapterCollapsed = nodeData.chapter ? collapsedChapters[nodeData.chapter] : false;
    const labelCollapsed = collapsedLabelChildren.has(n.id);
    const matchesSearch =
      query.length === 0 ||
      nodeData.label.toLowerCase().includes(query) ||
      (nodeData.dialogueLines ?? []).some((line) => line.toLowerCase().includes(query)) ||
      String(nodeData.dialogueCount).includes(query);
    const matchesDialogue = nodeData.dialogueCount >= minDialogue;
    return {
      ...n,
      data: { ...nodeData, theme },
      hidden: Boolean(chapterCollapsed || labelCollapsed || !matchesSearch || !matchesDialogue),
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
}): CanvasEdge[] {
  const { edges, showCallReturns, visibleEdgeKinds, visibleNodeIds, edgeColor, largeGraphMode } =
    params;
  const visible: CanvasEdge[] = [];
  for (const edge of edges) {
    const edgeData = (edge.data as EdgeData | undefined) ?? { label: '' };
    const kind = (edgeData.kind ?? 'sequence') as EdgeKindFilter;
    if (!visibleEdgeKinds[kind]) continue;
    if (!showCallReturns && kind === 'call_return') continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
    const edgeLabel = largeGraphMode && kind === 'sequence' ? '' : (edgeData.label ?? '');
    visible.push({
      ...edge,
      data: { ...edgeData, label: edgeLabel, kind },
      style: { ...(edge.style || {}), stroke: edgeColor, strokeWidth: 1.5 },
    });
  }
  return visible;
}
