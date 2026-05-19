import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { FlowNode, FlowEdge, EdgeKind } from './domain';
import type { ThemeName } from './ui';
import { evaluateConditionExpression, type MockFlagValue } from './conditionLogic';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT_LABEL = 90;
export const NODE_HEIGHT_MENU = 80;
// Keep this aligned with the rendered decision node height (diamond + vertical padding).
export const NODE_HEIGHT_DECISION = 176;
export const PROGRESSIVE_LAYOUT_NODE_LIMIT = 220;
const PROGRESSIVE_FALLBACK_MAX_COLUMNS = 16;

const EDGE_KIND_FILTERS: ReadonlyArray<EdgeKindFilter> = ['sequence', 'jump', 'call', 'call_return'];

export interface NodeData extends Record<string, unknown> {
  label: string;
  dialogueCount: number;
  dialogueLines?: string[];
  nodeType: 'LABEL' | 'MENU' | 'DECISION';
  chapter?: string;
  parentLabelId?: string;
  conditionExpression?: string;
  conditionReferences?: string[];
  theme: 'violet' | 'highContrast' | 'colorblind';
}

export interface EdgeData extends Record<string, unknown> {
  label: string;
  kind?: 'sequence' | 'jump' | 'call' | 'call_return';
  condition?: FlowEdge['condition'];
  conditionState?: ConditionReachability;
}

export type LabelNodeType = Node<NodeData, 'labelNode'>;
export type MenuNodeType = Node<NodeData, 'menuNode'>;
export type DecisionNodeType = Node<NodeData, 'decisionNode'>;
export type CanvasNode = LabelNodeType | MenuNodeType | DecisionNodeType;

export type LabeledEdgeType = Edge<EdgeData, 'labeled'>;
export type CanvasEdge = LabeledEdgeType;

export type EdgeKindFilter = EdgeKind;
export type ConditionReachability = 'reachable' | 'unreachable' | 'unknown';
export type ConditionVisibilityMode = 'fade' | 'hide';

function normalizeEdgeKind(kind: string | undefined): EdgeKindFilter {
  if (kind && EDGE_KIND_FILTERS.includes(kind as EdgeKindFilter)) {
    return kind as EdgeKindFilter;
  }
  return 'sequence';
}

function compareIdsLocaleIndependent(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function getNodeHeight(nodeType: FlowNode['type']): number {
  if (nodeType === 'MENU') return NODE_HEIGHT_MENU;
  if (nodeType === 'DECISION') return NODE_HEIGHT_DECISION;
  return NODE_HEIGHT_LABEL;
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
    theme?: ThemeName;
  },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { nodes: normalizedNodes, edges: normalizedEdges } = resolveGraphIntegrity(rawNodes, rawEdges);
  const shouldUseProgressive =
    options?.progressive === true && normalizedNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;
  if (shouldUseProgressive) {
    return applyProgressiveDagreLayout(normalizedNodes, normalizedEdges, direction, options?.previousPositions, options?.theme);
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
      height: getNodeHeight(n.type),
    });
  });

  normalizedEdges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  const resolvedTheme: ThemeName = options?.theme ?? 'violet';
  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    const pos = g.node(n.id);
    const h = getNodeHeight(n.type);
    return {
      id: n.id,
      type: n.type === 'LABEL' ? 'labelNode' : n.type === 'MENU' ? 'menuNode' : 'decisionNode',
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
        conditionExpression: n.condition?.expression,
        conditionReferences: n.condition?.references,
        theme: resolvedTheme,
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
      data: { label: e.label ?? '', kind: e.kind, condition: e.condition },
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
  theme?: ThemeName,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const orderedNodes = previousPositions
    ? rawNodes
    : [...rawNodes].sort((a, b) => compareIdsLocaleIndependent(a.id, b.id));
  const subset = orderedNodes.slice(0, PROGRESSIVE_LAYOUT_NODE_LIMIT);
  const subsetIds = new Set(subset.map((n) => n.id));
  const subsetEdges = rawEdges.filter((e) => subsetIds.has(e.source) && subsetIds.has(e.target));
  const base = applyDagreLayout(subset, subsetEdges, direction, { theme });
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

  const resolvedTheme: ThemeName = theme ?? 'violet';
  const nodes: CanvasNode[] = orderedNodes.map((n) => {
    const h = getNodeHeight(n.type);
    const pos = positionById.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: n.type === 'LABEL' ? 'labelNode' : n.type === 'MENU' ? 'menuNode' : 'decisionNode',
      position: { x: pos.x, y: pos.y },
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        dialogueLines: n.dialogueLines,
        nodeType: n.type,
        chapter: n.chapter,
        parentLabelId: n.parentLabelId,
        conditionExpression: n.condition?.expression,
        conditionReferences: n.condition?.references,
        theme: resolvedTheme,
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
      data: { label: e.label ?? '', kind: e.kind, condition: e.condition },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

export function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  const nodeHeight =
    node.type === 'labelNode' ? NODE_HEIGHT_LABEL : node.type === 'menuNode' ? NODE_HEIGHT_MENU : NODE_HEIGHT_DECISION;
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
  conditionHiddenNodeIds?: Set<string>;
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
    conditionHiddenNodeIds,
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
    const hidden = Boolean(
      chapterCollapsed ||
      labelCollapsed ||
      (conditionHiddenNodeIds?.has(n.id) ?? false) ||
      !matchesSearch ||
      !matchesDialogue,
    );
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
  conditionVisibilityMode?: ConditionVisibilityMode;
  edgeConditionStateById?: Map<string, ConditionReachability>;
  previousById?: Map<string, CanvasEdge>;
}): CanvasEdge[] {
  const {
    edges,
    showCallReturns,
    visibleEdgeKinds,
    visibleNodeIds,
    edgeColor,
    largeGraphMode,
    conditionVisibilityMode = 'fade',
    edgeConditionStateById,
    previousById,
  } =
    params;
  const visible: CanvasEdge[] = [];
  for (const edge of edges) {
    const edgeData = (edge.data as EdgeData | undefined) ?? { label: '' };
    const kind = normalizeEdgeKind(edgeData.kind);
    if (!visibleEdgeKinds[kind]) continue;
    if (!showCallReturns && kind === 'call_return') continue;
    const conditionState = edgeConditionStateById?.get(edge.id);
    if (conditionVisibilityMode === 'hide' && conditionState === 'unreachable') continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
    const edgeLabel = largeGraphMode && kind === 'sequence' ? '' : (edgeData.label ?? '');
    const previous = previousById?.get(edge.id);
    const previousData = previous?.data as EdgeData | undefined;
    if (
      previous &&
      previousData?.label === edgeLabel &&
      previousData?.kind === kind &&
      previousData?.conditionState === conditionState &&
      previous.source === edge.source &&
      previous.target === edge.target &&
      previous.style?.stroke === edgeColor
    ) {
      visible.push(previous);
      continue;
    }
    const unreachableStyle =
      conditionVisibilityMode === 'fade' && conditionState === 'unreachable'
        ? { opacity: 0.28, strokeDasharray: '5 4' }
        : {};
    visible.push({
      ...edge,
      data: { ...edgeData, label: edgeLabel, kind, conditionState },
      style: { ...(edge.style || {}), ...unreachableStyle, stroke: edgeColor, strokeWidth: 1.5 },
    });
  }
  return visible;
}

export function buildConditionalVisibility(params: {
  edges: CanvasEdge[];
  mockFlags: Record<string, MockFlagValue>;
}): {
  edgeConditionStateById: Map<string, ConditionReachability>;
  hiddenNodeIds: Set<string>;
  discoveredFlags: string[];
} {
  const edgeConditionStateById = new Map<string, ConditionReachability>();
  const discoveredFlagSet = new Set<string>();
  const nodeIds = new Set<string>();
  const incomingCounts = new Map<string, number>();
  const outgoing = new Map<string, CanvasEdge[]>();

  for (const edge of params.edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    const sourceOutgoing = outgoing.get(edge.source) ?? [];
    sourceOutgoing.push(edge);
    outgoing.set(edge.source, sourceOutgoing);

    const edgeData = (edge.data as EdgeData | undefined) ?? { label: '' };
    const condition = edgeData.condition;
    if (!condition) continue;
    for (const ref of condition.references ?? []) {
      discoveredFlagSet.add(ref);
    }
    const evaluated = evaluateConditionExpression(condition.expression, params.mockFlags);
    const conditionState: ConditionReachability =
      evaluated === 'true' ? 'reachable' : evaluated === 'false' ? 'unreachable' : 'unknown';
    edgeConditionStateById.set(edge.id, conditionState);
  }

  const roots = Array.from(nodeIds).filter((nodeId) => (incomingCounts.get(nodeId) ?? 0) === 0);
  const traversalStarts = roots.length > 0 ? roots : Array.from(nodeIds);
  const reachableNodeIds = new Set<string>();
  const stack = [...traversalStarts];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId) continue;
    if (reachableNodeIds.has(nodeId)) continue;
    reachableNodeIds.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const edgeState = edgeConditionStateById.get(edge.id);
      if (edgeState === 'unreachable') continue;
      stack.push(edge.target);
    }
  }

  const hiddenNodeIds = new Set<string>();
  for (const nodeId of nodeIds) {
    if (!reachableNodeIds.has(nodeId)) {
      hiddenNodeIds.add(nodeId);
    }
  }

  return {
    edgeConditionStateById,
    hiddenNodeIds,
    discoveredFlags: Array.from(discoveredFlagSet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}
