import dagre from '@dagrejs/dagre';
import type { FlowNode, FlowEdge, CanvasNode, CanvasEdge, NodeData, ThemeName, LayoutDensity } from '../index';
import { resolveGraphIntegrity } from './integrity';

interface ElkNode {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

interface ElkInstance {
  layout(graph: ElkGraph): Promise<ElkGraph>;
}

let elkInstance: ElkInstance | null = null;

/** Standard node width in pixels used across all node types in the layout. */
export const NODE_WIDTH = 220;
/** Base height for a standard LABEL node. */
export const NODE_HEIGHT_LABEL = 90;
/** Additional height for terminal story outcome LABEL nodes. */
export const NODE_HEIGHT_LABEL_TERMINAL = 104;
/** Increased height for shadowed (duplicate) LABEL nodes to accommodate the shadow indicator. */
export const NODE_HEIGHT_LABEL_SHADOWED = 122;
/** Height for MENU choice nodes. */
export const NODE_HEIGHT_MENU = 80;
// Keep this aligned with the rendered decision node height (diamond + vertical padding).
/** Height for DECISION branching nodes (diamond shape plus vertical padding). */
export const NODE_HEIGHT_DECISION = 176;
/**
 * Nodes below this count use the full Dagre layout.
 * Above it, `applyDagreLayout` switches to `applyProgressiveDagreLayout`
 * to avoid long stalls on very large graphs.
 */
export const PROGRESSIVE_LAYOUT_NODE_LIMIT = 220;
/** Maximum column count for the fallback grid used when placing overflow nodes. */
const PROGRESSIVE_FALLBACK_MAX_COLUMNS = 16;

/** Locale-independent string comparison for deterministic node ordering. */
function compareIdsLocaleIndependent(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Computes the correct pixel height for a LABEL node based on its visual variant
 * (shadowed, terminal outcome, or standard).
 */
export function getLabelHeight(params: { isShadowed?: boolean; isTerminalOutcome?: boolean }): number {
  if (params.isShadowed) return NODE_HEIGHT_LABEL_SHADOWED;
  if (params.isTerminalOutcome) return NODE_HEIGHT_LABEL_TERMINAL;
  return NODE_HEIGHT_LABEL;
}

/**
 * Returns the pixel height for any node type: dispatches to
 * the appropriate constant or `getLabelHeight` and adds extra
 * padding if audio/asset cues are present.
 */
export function getNodeHeight(node: Pick<FlowNode, 'type' | 'isShadowed' | 'isTerminalOutcome' | 'audioAssetCues'>): number {
  if (node.type === 'MENU') return NODE_HEIGHT_MENU;
  if (node.type === 'DECISION') return NODE_HEIGHT_DECISION;
  const baseHeight = getLabelHeight(node);
  if (node.audioAssetCues && node.audioAssetCues.length > 0) {
    return baseHeight + 24;
  }
  return baseHeight;
}

/**
 * Applies a Dagre hierarchical layout to the raw parser output and returns
 * React Flow-compatible `CanvasNode` and `CanvasEdge` arrays.
 *
 * Automatically delegates to `applyProgressiveDagreLayout` when the graph
 * exceeds `PROGRESSIVE_LAYOUT_NODE_LIMIT` nodes and the `progressive` option
 * is enabled.
 *
 * @param rawNodes Parser FlowNode array.
 * @param rawEdges Parser FlowEdge array.
 * @param direction Layout direction: 'TB' (top-to-bottom) or 'LR' (left-to-right).
 * @param options.progressive Enable progressive layout for large graphs.
 * @param options.previousPositions Stable node positions from the previous render to preserve.
 * @param options.theme Active theme name for node data hydration.
 */
export function applyDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
  options?: {
    progressive?: boolean;
    previousPositions?: Map<string, { x: number; y: number }>;
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
  },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { nodes: normalizedNodes, edges: normalizedEdges } = resolveGraphIntegrity(rawNodes, rawEdges);
  const shouldUseProgressive =
    options?.progressive === true && normalizedNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;
  if (shouldUseProgressive) {
    return applyProgressiveDagreLayout(normalizedNodes, normalizedEdges, direction, options?.previousPositions, options?.theme, options?.layoutDensity);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  const density = options?.layoutDensity ?? 'normal';
  let ranksep = direction === 'TB' ? 80 : 110;
  let nodesep = 50;
  if (density === 'compact') {
    ranksep = direction === 'TB' ? 50 : 70;
    nodesep = 30;
  } else if (density === 'spacious') {
    ranksep = direction === 'TB' ? 120 : 160;
    nodesep = 80;
  }

  g.setGraph({
    rankdir: direction,
    ranksep,
    nodesep,
    marginx: 20,
    marginy: 20,
  });

  normalizedNodes.forEach((n) => {
    g.setNode(n.id, {
      width: NODE_WIDTH,
      height: getNodeHeight(n),
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
    const h = getNodeHeight(n);
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
        audioAssetCues: n.audioAssetCues,
        nodeType: n.type,
        chapter: n.chapter,
        parentLabelId: n.parentLabelId,
        role: n.role,
        isShadowed: n.isShadowed,
        shadowOfId: n.shadowOfId,
        isTerminalOutcome: n.isTerminalOutcome,
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
      data: { label: e.label ?? '', kind: e.kind, condition: e.condition, timeout: e.timeout },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

/**
 * Handles large graphs that exceed `PROGRESSIVE_LAYOUT_NODE_LIMIT` by:
 * 1. Running a full Dagre layout on the first `PROGRESSIVE_LAYOUT_NODE_LIMIT` nodes.
 * 2. Placing remaining overflow nodes in a deterministic grid after the laid-out region.
 * 3. Preferring previously known positions for already-placed overflow nodes when
 *    `previousPositions` is supplied, keeping the view stable across re-layouts.
 *
 * @param rawNodes All FlowNodes (may exceed the progressive limit).
 * @param rawEdges All FlowEdges.
 * @param direction Layout direction 'TB' or 'LR'.
 * @param previousPositions Map of node ID to last known pixel position.
 * @param theme Active theme name.
 */
export function applyProgressiveDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
  previousPositions?: Map<string, { x: number; y: number }>,
  theme?: ThemeName,
  layoutDensity?: LayoutDensity,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const orderedNodes = previousPositions
    ? rawNodes
    : [...rawNodes].sort((a, b) => compareIdsLocaleIndependent(a.id, b.id));
  const subset = orderedNodes.slice(0, PROGRESSIVE_LAYOUT_NODE_LIMIT);
  const subsetIds = new Set(subset.map((n) => n.id));
  const subsetEdges = rawEdges.filter((e) => subsetIds.has(e.source) && subsetIds.has(e.target));
  const base = applyDagreLayout(subset, subsetEdges, direction, { theme, layoutDensity });
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
  const fallbackStrideY = NODE_HEIGHT_LABEL_SHADOWED + 24;
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
    const h = getNodeHeight(n);
    const pos = positionById.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: n.type === 'LABEL' ? 'labelNode' : n.type === 'MENU' ? 'menuNode' : 'decisionNode',
      position: { x: pos.x, y: pos.y },
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        dialogueLines: n.dialogueLines,
        audioAssetCues: n.audioAssetCues,
        nodeType: n.type,
        chapter: n.chapter,
        parentLabelId: n.parentLabelId,
        role: n.role,
        isShadowed: n.isShadowed,
        shadowOfId: n.shadowOfId,
        isTerminalOutcome: n.isTerminalOutcome,
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
      data: { label: e.label ?? '', kind: e.kind, condition: e.condition, timeout: e.timeout },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

/**
 * Computes the center pixel coordinate of a node using its position and measured
 * (or estimated) height. Used for viewport centering when focusing a node.
 */
export function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  const nodeData = node.data as NodeData;
  const nodeHeight =
    node.measured?.height ??
    (node.type === 'labelNode'
      ? getLabelHeight({
          isShadowed: nodeData.isShadowed,
          isTerminalOutcome: nodeData.isTerminalOutcome,
        })
      : node.type === 'menuNode'
        ? NODE_HEIGHT_MENU
        : NODE_HEIGHT_DECISION);
  return {
    x: node.position.x + NODE_WIDTH / 2,
    y: node.position.y + nodeHeight / 2,
  };
}

export async function applyElkLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
  options?: {
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
  },
): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }> {
  if (!elkInstance) {
    const ELKModule = await import('elkjs/lib/elk.bundled.js');
    const ELK = ELKModule.default || ELKModule;
    elkInstance = new ELK() as unknown as ElkInstance;
  }
  const instance = elkInstance;
  const { nodes: normalizedNodes, edges: normalizedEdges } = resolveGraphIntegrity(rawNodes, rawEdges);

  const elkNodes = normalizedNodes.map((n) => ({
    id: n.id,
    width: NODE_WIDTH,
    height: getNodeHeight(n),
  }));

  const elkEdges = normalizedEdges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const density = options?.layoutDensity ?? 'normal';
  let ranksep = direction === 'TB' ? 80 : 110;
  let nodesep = 50;
  if (density === 'compact') {
    ranksep = direction === 'TB' ? 50 : 70;
    nodesep = 30;
  } else if (density === 'spacious') {
    ranksep = direction === 'TB' ? 120 : 160;
    nodesep = 80;
  }

  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': direction === 'TB' ? 'DOWN' : 'RIGHT',
    'elk.spacing.nodeNode': String(nodesep),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(ranksep),
    'elk.padding': '[top=20,left=20,bottom=20,right=20]',
    'org.eclipse.elk.nodePlacement.strategy': 'SIMPLE',
  };

  const graph = {
    id: 'root',
    layoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };

  const laidOutGraph = await instance.layout(graph);
  const positionById = new Map<string, { x: number; y: number }>();
  laidOutGraph.children?.forEach((child: ElkNode) => {
    if (child.id && child.x !== undefined && child.y !== undefined) {
      positionById.set(child.id, { x: child.x, y: child.y });
    }
  });

  const resolvedTheme: ThemeName = options?.theme ?? 'violet';
  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    const pos = positionById.get(n.id) ?? { x: 0, y: 0 };
    const h = getNodeHeight(n);
    return {
      id: n.id,
      type: n.type === 'LABEL' ? 'labelNode' : n.type === 'MENU' ? 'menuNode' : 'decisionNode',
      position: { x: pos.x, y: pos.y },
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        dialogueLines: n.dialogueLines,
        audioAssetCues: n.audioAssetCues,
        nodeType: n.type,
        chapter: n.chapter,
        parentLabelId: n.parentLabelId,
        role: n.role,
        isShadowed: n.isShadowed,
        shadowOfId: n.shadowOfId,
        isTerminalOutcome: n.isTerminalOutcome,
        conditionExpression: n.condition?.expression,
        conditionReferences: n.condition?.references,
        theme: resolvedTheme,
      },
      draggable: true,
      measured: { width: NODE_WIDTH, height: h },
    };
  });

  const edges: CanvasEdge[] = normalizedEdges
    .filter((e) => positionById.has(e.source) && positionById.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'labeled',
      data: { label: e.label ?? '', kind: e.kind, condition: e.condition, timeout: e.timeout },
      markerEnd: { type: 'arrowclosed' as const },
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}
