import dagre from "@dagrejs/dagre";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import {
  type CanvasEdge,
  type CanvasNode,
  type FlowEdge,
  type FlowNode,
  getNodeHeight,
  type LayoutDensity,
  NODE_WIDTH,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  resolveGraphIntegrity,
  type ThemeName,
} from "../domain/index.ts";

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
const PROGRESSIVE_FALLBACK_MAX_COLUMNS = 16;

/**
 * Fallback grid placement used when a graph is too large for comfortable standard layout.
 */
function applyProgressiveDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: "TB" | "LR",
  options?: {
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
    previousPositions?: Map<string, { x: number; y: number }>;
  },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const isDark = options?.theme === "dark";
  const edgeColor = isDark ? "#475569" : "#cbd5e1";

  const { nodes: normalizedNodes, edges: normalizedEdges } =
    resolveGraphIntegrity(rawNodes, rawEdges);

  const prevMap = options?.previousPositions;

  // Lays out the primary N nodes, then places the rest in a grid
  const primaryNodes = normalizedNodes.slice(0, PROGRESSIVE_LAYOUT_NODE_LIMIT);
  const overflowNodes = normalizedNodes.slice(PROGRESSIVE_LAYOUT_NODE_LIMIT);

  const primaryNodeIds = new Set(primaryNodes.map((n) => n.id));
  const primaryEdges = normalizedEdges.filter(
    (e) => primaryNodeIds.has(e.source) && primaryNodeIds.has(e.target),
  );

  const g = new dagre.graphlib.Graph();
  const density = options?.layoutDensity ?? "normal";
  let ranksep = direction === "TB" ? 80 : 110;
  let nodesep = 50;
  if (density === "compact") {
    ranksep = direction === "TB" ? 50 : 70;
    nodesep = 30;
  } else if (density === "spacious") {
    ranksep = direction === "TB" ? 120 : 160;
    nodesep = 80;
  }

  g.setGraph({
    rankdir: direction,
    ranksep,
    nodesep,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  primaryNodes.forEach((node) => {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: getNodeHeight(node),
    });
  });

  primaryEdges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  let maxY = 0;
  primaryNodes.forEach((node) => {
    const dNode = g.node(node.id);
    if (dNode) {
      const bottom = dNode.y + getNodeHeight(node) / 2;
      if (bottom > maxY) maxY = bottom;
    }
  });
  const fallbackStartY = Math.max(800, maxY + 200);

  // Position nodes
  const overflowIndexMap = new Map(
    overflowNodes.map((node, idx) => [node.id, idx]),
  );

  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    let x = 0;
    let y = 0;

    if (primaryNodeIds.has(n.id)) {
      const dagreNode = g.node(n.id);
      if (dagreNode) {
        x = dagreNode.x - NODE_WIDTH / 2;
        y = dagreNode.y - getNodeHeight(n) / 2;
      }
    } else {
      const prevPos = prevMap?.get(n.id);
      if (prevPos) {
        x = prevPos.x;
        y = prevPos.y;
      } else {
        const overflowIndex = overflowIndexMap.get(n.id) ?? 0;
        const row = Math.floor(
          overflowIndex / PROGRESSIVE_FALLBACK_MAX_COLUMNS,
        );
        const col = overflowIndex % PROGRESSIVE_FALLBACK_MAX_COLUMNS;
        x = col * (NODE_WIDTH + 40) + 40;
        y = row * (150 + 40) + fallbackStartY;
      }
    }

    const h = getNodeHeight(n);
    return {
      id: n.id,
      type: n.type === "LABEL"
        ? "labelNode"
        : n.type === "MENU"
        ? "menuNode"
        : "decisionNode",
      position: { x, y },
      width: NODE_WIDTH,
      height: h,
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        wordCount: n.wordCount,
        pauseDuration: n.pauseDuration,
        dialogueLines: n.dialogueLines,
        dialogueLineNums: n.dialogueLineNums,
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
      },
      draggable: true,
      measured: { width: NODE_WIDTH, height: h },
    };
  });

  const positionById = new Map(nodes.map((n) => [n.id, n.position]));

  const edges: CanvasEdge[] = normalizedEdges
    .filter((e) => positionById.has(e.source) && positionById.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "labeled",
      data: {
        label: e.label ?? "",
        kind: e.kind,
        condition: e.condition,
        timeout: e.timeout,
      },
      markerEnd: { type: "arrowclosed" as const },
      style: { stroke: edgeColor, strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

/**
 * Applies a Dagre hierarchical layout to the raw parser output and returns
 * React Flow-compatible `CanvasNode` and `CanvasEdge` arrays.
 *
 * Automatically delegates to `applyProgressiveDagreLayout` when the graph
 * exceeds `PROGRESSIVE_LAYOUT_NODE_LIMIT` nodes and the `progressive` option
 * is enabled.
 */
export function applyDagreLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: "TB" | "LR",
  options?: {
    progressive?: boolean;
    previousPositions?: Map<string, { x: number; y: number }>;
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
  },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const { nodes: normalizedNodes, edges: normalizedEdges } =
    resolveGraphIntegrity(rawNodes, rawEdges);
  const shouldUseProgressive = options?.progressive === true &&
    normalizedNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;

  if (shouldUseProgressive) {
    return applyProgressiveDagreLayout(rawNodes, rawEdges, direction, options);
  }

  const isDark = options?.theme === "dark";
  const edgeColor = isDark ? "#475569" : "#cbd5e1";

  const prevMap = options?.previousPositions;

  const g = new dagre.graphlib.Graph();
  const density = options?.layoutDensity ?? "normal";
  let ranksep = direction === "TB" ? 80 : 110;
  let nodesep = 50;
  if (density === "compact") {
    ranksep = direction === "TB" ? 50 : 70;
    nodesep = 30;
  } else if (density === "spacious") {
    ranksep = direction === "TB" ? 120 : 160;
    nodesep = 80;
  }

  g.setGraph({
    rankdir: direction,
    ranksep,
    nodesep,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  normalizedNodes.forEach((node) => {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: getNodeHeight(node),
    });
  });

  normalizedEdges.forEach((edge) => {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  // Position nodes
  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    const dagreNode = g.node(n.id);
    let x = 0;
    let y = 0;
    if (dagreNode) {
      x = dagreNode.x - NODE_WIDTH / 2;
      y = dagreNode.y - getNodeHeight(n) / 2;
    }

    // Preserve node positions from previous render if available to minimize movement
    if (prevMap) {
      const prevPos = prevMap.get(n.id);
      if (prevPos) {
        x = prevPos.x;
        y = prevPos.y;
      }
    }

    const h = getNodeHeight(n);
    return {
      id: n.id,
      type: n.type === "LABEL"
        ? "labelNode"
        : n.type === "MENU"
        ? "menuNode"
        : "decisionNode",
      position: { x, y },
      width: NODE_WIDTH,
      height: h,
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        wordCount: n.wordCount,
        pauseDuration: n.pauseDuration,
        dialogueLines: n.dialogueLines,
        dialogueLineNums: n.dialogueLineNums,
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
      },
      draggable: true,
      measured: { width: NODE_WIDTH, height: h },
    };
  });

  const positionById = new Map(nodes.map((n) => [n.id, n.position]));

  const edges: CanvasEdge[] = normalizedEdges
    .filter((e) => positionById.has(e.source) && positionById.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "labeled",
      data: {
        label: e.label ?? "",
        kind: e.kind,
        condition: e.condition,
        timeout: e.timeout,
      },
      markerEnd: { type: "arrowclosed" as const },
      style: { stroke: edgeColor, strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}

export async function preWarmElk(): Promise<void> {
  if (!elkInstance) {
    const ELKModule = await import("elkjs/lib/elk-api.js");
    const ELK = ELKModule.default || ELKModule;
    elkInstance = new ELK({
      workerUrl: elkWorkerUrl,
    }) as unknown as ElkInstance;
  }
}

export async function applyElkLayout(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: "TB" | "LR",
  options?: {
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
    previousPositions?:
      | Map<string, { x: number; y: number }>
      | Array<[string, { x: number; y: number }]>;
  },
): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }> {
  await preWarmElk();
  const instance = elkInstance!;
  const { nodes: normalizedNodes, edges: normalizedEdges } =
    resolveGraphIntegrity(rawNodes, rawEdges);

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

  const density = options?.layoutDensity ?? "normal";
  let ranksep = direction === "TB" ? 80 : 110;
  let nodesep = 50;
  if (density === "compact") {
    ranksep = direction === "TB" ? 50 : 70;
    nodesep = 30;
  } else if (density === "spacious") {
    ranksep = direction === "TB" ? 120 : 160;
    nodesep = 80;
  }

  const layoutOptions: Record<string, string> = {
    "elk.algorithm": "layered",
    "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.nodeNode": String(nodesep),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(ranksep),
    "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    "org.eclipse.elk.nodePlacement.strategy": "SIMPLE",
  };

  const graph = {
    id: "root",
    layoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };

  const laidOutGraph = await instance.layout(graph);

  // Translation alignment to minimize visual jumping
  const previousPositionsMap = options?.previousPositions
    ? (options.previousPositions instanceof Map
      ? options.previousPositions
      : new Map(options.previousPositions))
    : null;

  if (previousPositionsMap && previousPositionsMap.size > 0) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    laidOutGraph.children?.forEach((child: ElkNode) => {
      if (child.id && child.x !== undefined && child.y !== undefined) {
        const prev = previousPositionsMap.get(child.id);
        if (prev) {
          sumX += prev.x - child.x;
          sumY += prev.y - child.y;
          count += 1;
        }
      }
    });
    if (count > 0) {
      const deltaX = sumX / count;
      const deltaY = sumY / count;
      laidOutGraph.children?.forEach((child: ElkNode) => {
        if (child.x !== undefined && child.y !== undefined) {
          child.x += deltaX;
          child.y += deltaY;
        }
      });
    }
  }

  const positionById = new Map<string, { x: number; y: number }>();
  laidOutGraph.children?.forEach((child: ElkNode) => {
    if (child.id && child.x !== undefined && child.y !== undefined) {
      positionById.set(child.id, { x: child.x, y: child.y });
    }
  });

  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    const pos = positionById.get(n.id) ?? { x: 0, y: 0 };
    const h = getNodeHeight(n);
    return {
      id: n.id,
      type: n.type === "LABEL"
        ? "labelNode"
        : n.type === "MENU"
        ? "menuNode"
        : "decisionNode",
      position: { x: pos.x, y: pos.y },
      width: NODE_WIDTH,
      height: h,
      data: {
        label: n.label,
        dialogueCount: n.dialogueCount,
        wordCount: n.wordCount,
        pauseDuration: n.pauseDuration,
        dialogueLines: n.dialogueLines,
        dialogueLineNums: n.dialogueLineNums,
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
      type: "labeled",
      data: {
        label: e.label ?? "",
        kind: e.kind,
        condition: e.condition,
        timeout: e.timeout,
      },
      markerEnd: { type: "arrowclosed" as const },
      style: { stroke: "#6b7280", strokeWidth: 1.5 },
    }));

  return { nodes, edges };
}
