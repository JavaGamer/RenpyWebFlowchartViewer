import dagre from "@dagrejs/dagre";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import {
  buildFilletedOrthogonalPath,
  calculateBackEdgeSpline,
  calculateSelfLoopArc,
  type CanvasEdge,
  type CanvasNode,
  CHAPTER_CONTAINER_PADDING,
  CHAPTER_SUMMARY_HEIGHT,
  CHAPTER_SUMMARY_WIDTH,
  computeChapterAggregates,
  detectBackEdge,
  extractChapterName,
  type FlowEdge,
  type FlowNode,
  getChapterId,
  getNodeHeight,
  groupNodesByChapter,
  isChapterId,
  type LayoutDensity,
  NODE_WIDTH,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  redirectEdgesForCollapsedChapters,
  resolveGraphIntegrity,
  type ThemeName,
} from "../domain/index.ts";

interface ElkPoint {
  x: number;
  y: number;
}

interface ElkEdgeSection {
  id?: string;
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
  incomingShape?: string;
  outgoingShape?: string;
}

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: ElkEdgeSection[];
  junctionPoints?: ElkPoint[];
  layoutOptions?: Record<string, string>;
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
 * Generates CanvasEdges with smart loop, back-edge, and orthogonal spline routing.
 */
function buildCanvasEdges(
  normalizedEdges: FlowEdge[],
  nodes: CanvasNode[],
  direction: "TB" | "LR",
  edgeColor: string,
  elkEdgeMap?: Map<string, ElkEdge>,
): CanvasEdge[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  function getAbsolutePosition(
    id: string,
  ): { x: number; y: number } | undefined {
    const node = nodeById.get(id);
    if (!node) return undefined;
    if (node.parentId) {
      const parent = nodeById.get(node.parentId);
      if (parent) {
        return {
          x: parent.position.x + node.position.x,
          y: parent.position.y + node.position.y,
        };
      }
    }
    return node.position;
  }

  // Track parallel back-edges to assign laneIndex
  const corridorCounts = new Map<string, number>();

  return normalizedEdges
    .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
    .map((e) => {
      const sourcePos = getAbsolutePosition(e.source)!;
      const targetPos = getAbsolutePosition(e.target)!;
      const isSelfLoop = e.source === e.target;
      const isBackEdge = detectBackEdge(
        sourcePos,
        targetPos,
        direction,
        isSelfLoop,
      );

      const corridorKey = `${direction}_${e.target}`;
      const laneIndex = corridorCounts.get(corridorKey) ?? 0;
      corridorCounts.set(corridorKey, laneIndex + 1);

      const sourceNode = nodeById.get(e.source);
      const targetNode = nodeById.get(e.target);

      const sourceIsDecision = sourceNode?.data?.nodeType === "DECISION";
      const targetIsDecision = targetNode?.data?.nodeType === "DECISION";

      const sourceHeight = sourceNode?.height ?? 80;
      const targetHeight = targetNode?.height ?? 80;

      // Determine handle IDs
      let sourceHandle: string | undefined;
      let targetHandle: string | undefined;

      if (isSelfLoop) {
        sourceHandle = direction === "TB" ? "source-right" : "source-bottom";
        targetHandle = direction === "TB" ? "target-top" : "target-left";
      } else if (isBackEdge) {
        if (direction === "TB") {
          sourceHandle = "source-right";
          targetHandle = "target-right";
        } else {
          sourceHandle = "source-bottom";
          targetHandle = "target-bottom";
        }
      } else {
        sourceHandle = direction === "TB" ? "source-bottom" : "source-right";
        targetHandle = direction === "TB" ? "target-top" : "target-left";
      }

      let svgPath: string | undefined;
      let labelPosition: { x: number; y: number } | undefined;
      let bendPoints: Array<{ x: number; y: number }> | undefined;
      let sections: ElkEdgeSection[] | undefined;

      const elkEdge = elkEdgeMap?.get(e.id);
      if (elkEdge?.sections && elkEdge.sections.length > 0) {
        sections = elkEdge.sections;
        const section = elkEdge.sections[0]!;
        const pts = [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ];
        bendPoints = pts;
        const filleted = buildFilletedOrthogonalPath(pts);
        svgPath = filleted.path;
        labelPosition = { x: filleted.labelX, y: filleted.labelY };
      } else if (isSelfLoop) {
        const sX = direction === "TB"
          ? sourcePos.x + (sourceIsDecision ? 190 : NODE_WIDTH)
          : sourcePos.x + NODE_WIDTH / 2;
        const sY = direction === "TB"
          ? sourcePos.y + sourceHeight / 2
          : sourcePos.y + (sourceIsDecision ? sourceHeight - 8 : sourceHeight);
        const tX = direction === "TB"
          ? targetPos.x + NODE_WIDTH / 2
          : targetPos.x + (targetIsDecision ? 30 : 0);
        const tY = direction === "TB"
          ? targetPos.y + (targetIsDecision ? 8 : 0)
          : targetPos.y + targetHeight / 2;

        const loopRes = calculateSelfLoopArc({
          sourceX: sX,
          sourceY: sY,
          targetX: tX,
          targetY: tY,
          direction,
          laneIndex,
        });
        svgPath = loopRes.path;
        labelPosition = { x: loopRes.labelX, y: loopRes.labelY };
      } else if (isBackEdge) {
        const sX = direction === "TB"
          ? sourcePos.x + (sourceIsDecision ? 190 : NODE_WIDTH)
          : sourcePos.x + NODE_WIDTH / 2;
        const sY = direction === "TB"
          ? sourcePos.y + sourceHeight / 2
          : sourcePos.y + (sourceIsDecision ? sourceHeight - 8 : sourceHeight);
        const tX = direction === "TB"
          ? targetPos.x + (targetIsDecision ? 190 : NODE_WIDTH)
          : targetPos.x + NODE_WIDTH / 2;
        const tY = direction === "TB"
          ? targetPos.y + targetHeight / 2
          : targetPos.y + (targetIsDecision ? targetHeight - 8 : targetHeight);

        const splineRes = calculateBackEdgeSpline({
          sourceX: sX,
          sourceY: sY,
          targetX: tX,
          targetY: tY,
          direction,
          laneIndex,
        });
        svgPath = splineRes.path;
        labelPosition = { x: splineRes.labelX, y: splineRes.labelY };
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "labeled",
        sourceHandle,
        targetHandle,
        data: {
          label: e.label ?? "",
          conditionState: "reachable",
          kind: e.kind,
          condition: e.condition,
          timeout: e.timeout,
          callContext: e.callContext,
          isBackEdge,
          isSelfLoop,
          laneIndex,
          svgPath,
          labelPosition,
          bendPoints,
          sections,
        },
        markerEnd: { type: "arrowclosed" as const },
        style: { stroke: edgeColor, strokeWidth: 1.5 },
      };
    });
}

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
    if (edge.source !== edge.target) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  let maxY = 0;
  let maxX = 0;
  primaryNodes.forEach((node) => {
    const dNode = g.node(node.id);
    if (dNode) {
      const bottom = dNode.y + getNodeHeight(node) / 2;
      if (bottom > maxY) maxY = bottom;
      const right = dNode.x + NODE_WIDTH / 2;
      if (right > maxX) maxX = right;
    }
  });
  const isLR = direction === "LR";
  const fallbackStartY = Math.max(800, maxY + 200);
  const fallbackStartX = Math.max(800, maxX + 200);

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
        if (isLR) {
          const col = Math.floor(
            overflowIndex / PROGRESSIVE_FALLBACK_MAX_COLUMNS,
          );
          const row = overflowIndex % PROGRESSIVE_FALLBACK_MAX_COLUMNS;
          x = col * (NODE_WIDTH + 40) + fallbackStartX;
          y = row * (150 + 40) + 40;
        } else {
          const row = Math.floor(
            overflowIndex / PROGRESSIVE_FALLBACK_MAX_COLUMNS,
          );
          const col = overflowIndex % PROGRESSIVE_FALLBACK_MAX_COLUMNS;
          x = col * (NODE_WIDTH + 40) + 40;
          y = row * (150 + 40) + fallbackStartY;
        }
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

  const edges = buildCanvasEdges(normalizedEdges, nodes, direction, edgeColor);

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
    enableCompoundContainers?: boolean;
    collapsedChapters?: Record<string, boolean>;
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
  const enableCompound = options?.enableCompoundContainers === true;
  const collapsedChapters = options?.collapsedChapters ?? {};
  const chapterGroups = groupNodesByChapter(normalizedNodes);
  const hasMultipleChapters = chapterGroups.size > 1 ||
    (chapterGroups.size === 1 && !chapterGroups.has("Uncategorized"));
  const isCompound = enableCompound && hasMultipleChapters;

  const effectiveEdges = isCompound
    ? redirectEdgesForCollapsedChapters(
      normalizedEdges,
      normalizedNodes,
      collapsedChapters,
    )
    : normalizedEdges;

  const g = new dagre.graphlib.Graph({ compound: isCompound });
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

  if (!isCompound) {
    normalizedNodes.forEach((node) => {
      g.setNode(node.id, {
        width: NODE_WIDTH,
        height: getNodeHeight(node),
      });
    });
  } else {
    for (const [chapterName, chapterNodes] of chapterGroups.entries()) {
      const isCollapsed = Boolean(collapsedChapters[chapterName]);
      const chapterId = getChapterId(chapterName);
      if (isCollapsed) {
        g.setNode(chapterId, {
          width: CHAPTER_SUMMARY_WIDTH,
          height: CHAPTER_SUMMARY_HEIGHT,
        });
      } else {
        g.setNode(chapterId, {
          label: chapterName,
          clusterNodeClass: "chapter",
        });
        chapterNodes.forEach((node) => {
          g.setNode(node.id, {
            width: NODE_WIDTH,
            height: getNodeHeight(node),
          });
          g.setParent(node.id, chapterId);
        });
      }
    }
  }

  effectiveEdges.forEach((edge) => {
    if (
      edge.source !== edge.target &&
      g.hasNode(edge.source) &&
      g.hasNode(edge.target)
    ) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  // Position nodes
  const nodes: CanvasNode[] = [];
  const chapterStats = computeChapterAggregates(normalizedNodes);

  if (!isCompound) {
    normalizedNodes.forEach((n) => {
      const dagreNode = g.node(n.id);
      let x = 0;
      let y = 0;
      if (dagreNode) {
        x = dagreNode.x - NODE_WIDTH / 2;
        y = dagreNode.y - getNodeHeight(n) / 2;
      } else if (prevMap) {
        const prevPos = prevMap.get(n.id);
        if (prevPos) {
          x = prevPos.x;
          y = prevPos.y;
        }
      }

      const h = getNodeHeight(n);
      nodes.push({
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
      });
    });
  } else {
    for (const [chapterName, chapterNodes] of chapterGroups.entries()) {
      const isCollapsed = Boolean(collapsedChapters[chapterName]);
      const chapterId = getChapterId(chapterName);
      const dChapter = g.node(chapterId);
      const stats = chapterStats.get(chapterName);

      const baseWidth = dChapter?.width ??
        (isCollapsed ? CHAPTER_SUMMARY_WIDTH : 300);
      const baseHeight = dChapter?.height ??
        (isCollapsed ? CHAPTER_SUMMARY_HEIGHT : 200);

      const chapterWidth = isCollapsed
        ? baseWidth
        : baseWidth + CHAPTER_CONTAINER_PADDING.left +
          CHAPTER_CONTAINER_PADDING.right;
      const chapterHeight = isCollapsed
        ? baseHeight
        : baseHeight + CHAPTER_CONTAINER_PADDING.top +
          CHAPTER_CONTAINER_PADDING.bottom;

      const parentTopLeftX = dChapter ? dChapter.x - chapterWidth / 2 : 0;
      const parentTopLeftY = dChapter ? dChapter.y - chapterHeight / 2 : 0;

      // 1. Add parent ChapterNode first
      nodes.push({
        id: chapterId,
        type: "chapterNode",
        position: { x: parentTopLeftX, y: parentTopLeftY },
        width: chapterWidth,
        height: chapterHeight,
        style: {
          width: chapterWidth,
          height: chapterHeight,
        },
        data: {
          label: chapterName,
          chapter: chapterName,
          nodeType: "LABEL",
          dialogueCount: stats?.dialogueCount ?? 0,
          wordCount: stats?.wordCount ?? 0,
          pauseDuration: stats?.pauseDuration ?? 0,
          isChapterContainer: true,
          isCollapsed,
          chapterNodeCount: stats?.nodeCount ?? 0,
          chapterTotalDialogueCount: stats?.dialogueCount ?? 0,
          chapterTotalWordCount: stats?.wordCount ?? 0,
          chapterTotalPauseDuration: stats?.pauseDuration ?? 0,
        },
        draggable: true,
        measured: {
          width: chapterWidth,
          height: chapterHeight,
        },
      });

      // 2. If expanded, add child nodes with relative position
      if (!isCollapsed) {
        const clusterBaseLeft = dChapter ? dChapter.x - baseWidth / 2 : 0;
        const clusterBaseTop = dChapter ? dChapter.y - baseHeight / 2 : 0;

        chapterNodes.forEach((n) => {
          const dNode = g.node(n.id);
          const h = getNodeHeight(n);
          let relX = CHAPTER_CONTAINER_PADDING.left;
          let relY = CHAPTER_CONTAINER_PADDING.top;
          if (dNode) {
            const childAbsX = dNode.x - NODE_WIDTH / 2;
            const childAbsY = dNode.y - h / 2;
            relX = (childAbsX - clusterBaseLeft) +
              CHAPTER_CONTAINER_PADDING.left;
            relY = (childAbsY - clusterBaseTop) + CHAPTER_CONTAINER_PADDING.top;
          }
          nodes.push({
            id: n.id,
            type: n.type === "LABEL"
              ? "labelNode"
              : n.type === "MENU"
              ? "menuNode"
              : "decisionNode",
            parentId: chapterId,
            extent: "parent",
            position: { x: relX, y: relY },
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
          });
        });
      }
    }
  }

  const edges = buildCanvasEdges(effectiveEdges, nodes, direction, edgeColor);

  return { nodes, edges };
}

export function setElkInstance(instance: ElkInstance | null): void {
  elkInstance = instance;
}

export async function preWarmElk(customInstance?: ElkInstance): Promise<void> {
  if (customInstance) {
    elkInstance = customInstance;
    return;
  }
  if (!elkInstance) {
    const ELKModule = await import("elkjs/lib/elk-api.js");
    const ELK = ELKModule.default || ELKModule;
    try {
      elkInstance = new ELK({
        workerUrl: elkWorkerUrl,
      }) as unknown as ElkInstance;
    } catch {
      elkInstance = new ELK() as unknown as ElkInstance;
    }
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
    enableCompoundContainers?: boolean;
    collapsedChapters?: Record<string, boolean>;
  },
): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }> {
  await preWarmElk();
  const instance = elkInstance!;
  const { nodes: normalizedNodes, edges: normalizedEdges } =
    resolveGraphIntegrity(rawNodes, rawEdges);

  const enableCompound = options?.enableCompoundContainers === true;
  const chapterGroups = groupNodesByChapter(normalizedNodes);
  const hasMultipleChapters = chapterGroups.size > 1 ||
    (chapterGroups.size === 1 && !chapterGroups.has("Uncategorized"));
  const isCompound = enableCompound && hasMultipleChapters;
  const collapsedChapters = options?.collapsedChapters ?? {};

  const effectiveEdges = isCompound
    ? redirectEdgesForCollapsedChapters(
      normalizedEdges,
      normalizedNodes,
      collapsedChapters,
    )
    : normalizedEdges;

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

  const loopNodeIds = new Set(
    normalizedNodes
      .filter((n) =>
        n.role === "while_loop" || n.role === "for_loop" ||
        n.condition?.branchKind === "while" || n.condition?.branchKind === "for"
      )
      .map((n) => n.id),
  );

  const elkEdges: ElkEdge[] = effectiveEdges.map((e) => {
    const isLoopTarget = loopNodeIds.has(e.target);
    const edgeLayoutOptions: Record<string, string> = isLoopTarget
      ? {
        "org.eclipse.elk.layered.priority.direction": "0",
        "org.eclipse.elk.layered.priority.shortness": "5",
      }
      : {
        "org.eclipse.elk.layered.priority.direction": "10",
      };
    return {
      id: e.id,
      sources: [e.source],
      targets: [e.target],
      layoutOptions: edgeLayoutOptions,
    };
  });

  const layoutOptions: Record<string, string> = {
    "elk.algorithm": "layered",
    "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.nodeNode": String(nodesep),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(ranksep),
    "elk.padding": "[top=30,left=30,bottom=30,right=30]",
    "org.eclipse.elk.nodePlacement.strategy": "BRANDES_KOEPF",
    "org.eclipse.elk.layered.nodePlacement.favorStraightEdges": "true",
    "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
    "org.eclipse.elk.layered.feedbackEdges": "true",
    "org.eclipse.elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "org.eclipse.elk.spacing.edgeEdge": "15",
    "org.eclipse.elk.spacing.edgeNode": "25",
    "org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers": "25",
    "org.eclipse.elk.layered.unnecessaryBendpoints": "false",
    ...(isCompound ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}),
  };

  const chapterStats = computeChapterAggregates(normalizedNodes);
  let elkNodes: ElkNode[] = [];

  if (!isCompound) {
    elkNodes = normalizedNodes.map((n) => {
      const isLoop = n.role === "while_loop" || n.role === "for_loop" ||
        n.condition?.branchKind === "while" ||
        n.condition?.branchKind === "for";
      return {
        id: n.id,
        width: NODE_WIDTH,
        height: getNodeHeight(n),
        layoutOptions: isLoop
          ? {
            "org.eclipse.elk.portConstraints": "FIXED_SIDE",
            "org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment":
              "BALANCED",
          }
          : undefined,
      };
    });
  } else {
    for (const [chapterName, chapterNodes] of chapterGroups.entries()) {
      const isCollapsed = Boolean(collapsedChapters[chapterName]);
      const chapterId = getChapterId(chapterName);
      if (isCollapsed) {
        elkNodes.push({
          id: chapterId,
          width: CHAPTER_SUMMARY_WIDTH,
          height: CHAPTER_SUMMARY_HEIGHT,
        });
      } else {
        const childElkNodes: ElkNode[] = chapterNodes.map((n) => {
          const isLoop = n.role === "while_loop" || n.role === "for_loop" ||
            n.condition?.branchKind === "while" ||
            n.condition?.branchKind === "for";
          return {
            id: n.id,
            width: NODE_WIDTH,
            height: getNodeHeight(n),
            layoutOptions: isLoop
              ? {
                "org.eclipse.elk.portConstraints": "FIXED_SIDE",
                "org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment":
                  "BALANCED",
              }
              : undefined,
          };
        });
        elkNodes.push({
          id: chapterId,
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
            "elk.padding":
              `[top=${CHAPTER_CONTAINER_PADDING.top},left=${CHAPTER_CONTAINER_PADDING.left},bottom=${CHAPTER_CONTAINER_PADDING.bottom},right=${CHAPTER_CONTAINER_PADDING.right}]`,
            "elk.spacing.nodeNode": String(nodesep),
            "elk.layered.spacing.nodeNodeBetweenLayers": String(ranksep),
          },
          children: childElkNodes,
        });
      }
    }
  }

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
    const processChildForPrev = (child: ElkNode) => {
      if (child.id && child.x !== undefined && child.y !== undefined) {
        const prev = previousPositionsMap.get(child.id);
        if (prev) {
          sumX += prev.x - child.x;
          sumY += prev.y - child.y;
          count += 1;
        }
      }
      child.children?.forEach(processChildForPrev);
    };
    laidOutGraph.children?.forEach(processChildForPrev);

    if (count > 0) {
      const deltaX = sumX / count;
      const deltaY = sumY / count;
      laidOutGraph.children?.forEach((child: ElkNode) => {
        if (child.x !== undefined && child.y !== undefined) {
          child.x += deltaX;
          child.y += deltaY;
        }
      });
      laidOutGraph.edges?.forEach((edge: ElkEdge) => {
        edge.sections?.forEach((section) => {
          if (section.startPoint) {
            section.startPoint.x += deltaX;
            section.startPoint.y += deltaY;
          }
          if (section.endPoint) {
            section.endPoint.x += deltaX;
            section.endPoint.y += deltaY;
          }
          section.bendPoints?.forEach((bp) => {
            bp.x += deltaX;
            bp.y += deltaY;
          });
        });
        edge.junctionPoints?.forEach((jp) => {
          jp.x += deltaX;
          jp.y += deltaY;
        });
      });
    }
  }

  const nodes: CanvasNode[] = [];
  const normalizedNodeMap = new Map(normalizedNodes.map((n) => [n.id, n]));

  if (!isCompound) {
    laidOutGraph.children?.forEach((child: ElkNode) => {
      const n = normalizedNodeMap.get(child.id);
      if (!n) return;
      const h = getNodeHeight(n);
      nodes.push({
        id: n.id,
        type: n.type === "LABEL"
          ? "labelNode"
          : n.type === "MENU"
          ? "menuNode"
          : "decisionNode",
        position: { x: child.x ?? 0, y: child.y ?? 0 },
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
      });
    });
  } else {
    // 1. Add parent chapter container / summary nodes
    laidOutGraph.children?.forEach((topLevelNode: ElkNode) => {
      if (isChapterId(topLevelNode.id)) {
        const chapterName = extractChapterName(topLevelNode.id);
        const isCollapsed = Boolean(collapsedChapters[chapterName]);
        const stats = chapterStats.get(chapterName);
        const chapterWidth = topLevelNode.width ??
          (isCollapsed ? CHAPTER_SUMMARY_WIDTH : 300);
        const chapterHeight = topLevelNode.height ??
          (isCollapsed ? CHAPTER_SUMMARY_HEIGHT : 200);

        nodes.push({
          id: topLevelNode.id,
          type: "chapterNode",
          position: { x: topLevelNode.x ?? 0, y: topLevelNode.y ?? 0 },
          width: chapterWidth,
          height: chapterHeight,
          style: {
            width: chapterWidth,
            height: chapterHeight,
          },
          data: {
            label: chapterName,
            chapter: chapterName,
            nodeType: "LABEL",
            dialogueCount: stats?.dialogueCount ?? 0,
            wordCount: stats?.wordCount ?? 0,
            pauseDuration: stats?.pauseDuration ?? 0,
            isChapterContainer: true,
            isCollapsed,
            chapterNodeCount: stats?.nodeCount ?? 0,
            chapterTotalDialogueCount: stats?.dialogueCount ?? 0,
            chapterTotalWordCount: stats?.wordCount ?? 0,
            chapterTotalPauseDuration: stats?.pauseDuration ?? 0,
          },
          draggable: true,
          measured: {
            width: chapterWidth,
            height: chapterHeight,
          },
        });

        // 2. Add child nodes with relative position
        if (!isCollapsed && topLevelNode.children) {
          topLevelNode.children.forEach((childElkNode: ElkNode) => {
            const n = normalizedNodeMap.get(childElkNode.id);
            if (!n) return;
            const h = getNodeHeight(n);
            nodes.push({
              id: n.id,
              type: n.type === "LABEL"
                ? "labelNode"
                : n.type === "MENU"
                ? "menuNode"
                : "decisionNode",
              parentId: topLevelNode.id,
              extent: "parent",
              position: { x: childElkNode.x ?? 0, y: childElkNode.y ?? 0 },
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
            });
          });
        }
      } else {
        const n = normalizedNodeMap.get(topLevelNode.id);
        if (n) {
          const h = getNodeHeight(n);
          nodes.push({
            id: n.id,
            type: n.type === "LABEL"
              ? "labelNode"
              : n.type === "MENU"
              ? "menuNode"
              : "decisionNode",
            position: { x: topLevelNode.x ?? 0, y: topLevelNode.y ?? 0 },
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
          });
        }
      }
    });
  }

  const edgeColor = options?.theme === "dark"
    ? "#475569"
    : options?.theme === "highContrast"
    ? "#000000"
    : "#cbd5e1";

  const elkEdgeMap = new Map<string, ElkEdge>();
  laidOutGraph.edges?.forEach((e) => {
    elkEdgeMap.set(e.id, e);
  });

  const edges = buildCanvasEdges(
    effectiveEdges,
    nodes,
    direction,
    edgeColor,
    elkEdgeMap,
  );

  return { nodes, edges };
}
