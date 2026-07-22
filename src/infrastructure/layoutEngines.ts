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

  // Position nodes
  const overflowIndexMap = new Map(overflowNodes.map((node, i) => [node.id, i]));
  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    let x = 0;
    let y = 0;

    const isPrimary = primaryNodeIds.has(n.id);
    if (isPrimary) {
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
        y = row * (150 + 40) + 800; // Place it well below the primary layout
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
 * Fast layout strategy that partitions large graphs by chapter and runs localized
 * sub-graph layouts in parallel, then arranges chapter sub-graphs into a top-level grid.
 */
export function applyChapterClusteredLayout(
  normalizedNodes: FlowNode[],
  normalizedEdges: FlowEdge[],
  direction: "TB" | "LR",
  options?: {
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
    previousPositions?: Map<string, { x: number; y: number }>;
  },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const chapterNodesMap = new Map<string, FlowNode[]>();
  for (const node of normalizedNodes) {
    const ch = node.chapter ?? "default";
    let list = chapterNodesMap.get(ch);
    if (!list) {
      list = [];
      chapterNodesMap.set(ch, list);
    }
    list.push(node);
  }

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

  const chapterLayouts: Array<{
    chapter: string;
    positions: Map<string, { x: number; y: number }>;
    width: number;
    height: number;
  }> = [];

  for (const [ch, cNodes] of chapterNodesMap.entries()) {
    const cNodeIds = new Set(cNodes.map((n) => n.id));
    const cEdges = normalizedEdges.filter(
      (e) => cNodeIds.has(e.source) && cNodeIds.has(e.target),
    );

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: direction,
      ranksep,
      nodesep,
      marginx: 20,
      marginy: 20,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of cNodes) {
      g.setNode(node.id, {
        width: NODE_WIDTH,
        height: getNodeHeight(node),
      });
    }
    for (const edge of cEdges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const rawPositions = new Map<string, { x: number; y: number }>();
    for (const n of cNodes) {
      const dagreNode = g.node(n.id);
      const h = getNodeHeight(n);
      const nx = (dagreNode?.x ?? 0) - NODE_WIDTH / 2;
      const ny = (dagreNode?.y ?? 0) - h / 2;
      rawPositions.set(n.id, { x: nx, y: ny });

      if (nx < minX) minX = nx;
      if (nx + NODE_WIDTH > maxX) maxX = nx + NODE_WIDTH;
      if (ny < minY) minY = ny;
      if (ny + h > maxY) maxY = ny + h;
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const [nid, pos] of rawPositions.entries()) {
      positions.set(nid, { x: pos.x - minX, y: pos.y - minY });
    }

    const width = Number.isFinite(maxX - minX) && maxX > minX ? maxX - minX : NODE_WIDTH;
    const height = Number.isFinite(maxY - minY) && maxY > minY ? maxY - minY : 100;

    chapterLayouts.push({
      chapter: ch,
      positions,
      width,
      height,
    });
  }

  const CHAPTER_GAP = 120;
  const cols = Math.max(1, Math.ceil(Math.sqrt(chapterLayouts.length)));

  const finalNodePositions = new Map<string, { x: number; y: number }>();
  let currentX = 0;
  let currentY = 0;
  let maxRowHeight = 0;

  for (let i = 0; i < chapterLayouts.length; i += 1) {
    const item = chapterLayouts[i];
    const col = i % cols;
    if (col === 0 && i > 0) {
      currentX = 0;
      currentY += maxRowHeight + CHAPTER_GAP;
      maxRowHeight = 0;
    }

    const offsetX = currentX;
    const offsetY = currentY;

    for (const [nid, pos] of item.positions.entries()) {
      finalNodePositions.set(nid, {
        x: pos.x + offsetX,
        y: pos.y + offsetY,
      });
    }

    currentX += item.width + CHAPTER_GAP;
    if (item.height > maxRowHeight) {
      maxRowHeight = item.height;
    }
  }

  const isDark = options?.theme === "dark";
  const edgeColor = isDark ? "#475569" : "#cbd5e1";

  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    const pos = finalNodePositions.get(n.id) ?? { x: 0, y: 0 };
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

  const chapterCount = new Set(normalizedNodes.map((n) => n.chapter ?? "default")).size;
  if (normalizedNodes.length > 200 && chapterCount > 1) {
    return applyChapterClusteredLayout(
      normalizedNodes,
      normalizedEdges,
      direction,
      options,
    );
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

let elkInitPromise: Promise<void> | null = null;

export async function preWarmElk(): Promise<void> {
  if (elkInstance) return;
  if (!elkInitPromise) {
    elkInitPromise = (async () => {
      const ELKModule = await import("elkjs/lib/elk-api.js");
      const ELK = ELKModule.default || ELKModule;
      elkInstance = new ELK({
        workerUrl: elkWorkerUrl,
      }) as unknown as ElkInstance;
    })();
  }
  return elkInitPromise;
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

  const isDark = options?.theme === "dark";
  const edgeColor = isDark ? "#475569" : "#cbd5e1";

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

  const spacing = options?.layoutDensity === "compact"
    ? 25
    : options?.layoutDensity === "spacious"
    ? 70
    : 40;

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
      "elk.spacing.nodeNode": String(spacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(spacing + 20),
    },
    children: elkNodes,
    edges: elkEdges,
  };

  const layoutedGraph = await instance.layout(graph);

  const nodePosMap = new Map<string, { x: number; y: number }>();
  if (layoutedGraph.children) {
    for (const child of layoutedGraph.children) {
      nodePosMap.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
      });
    }
  }

  const nodes: CanvasNode[] = normalizedNodes.map((n) => {
    const pos = nodePosMap.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: n.type === "LABEL"
        ? "labelNode"
        : n.type === "MENU"
        ? "menuNode"
        : "decisionNode",
      position: pos,
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
        role: n.role,
        isShadowed: n.isShadowed,
        shadowOfId: n.shadowOfId,
        isTerminalOutcome: n.isTerminalOutcome,
        collapsedLabels: n.collapsedLabels,
        characterDialogue: n.characterDialogue,
        isSubLabel: n.isSubLabel,
        parentLabelScope: n.parentLabelScope,
      },
    };
  });

  const edges: CanvasEdge[] = normalizedEdges
    .filter((e) => nodePosMap.has(e.source) && nodePosMap.has(e.target))
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
