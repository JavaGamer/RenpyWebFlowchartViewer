import dagre from "@dagrejs/dagre";
import {
  type CanvasNode,
  CHAPTER_CONTAINER_PADDING,
  CHAPTER_SUMMARY_HEIGHT,
  CHAPTER_SUMMARY_WIDTH,
  collapseParentLabelSubgraphs,
  computeChapterAggregates,
  computeClusterBoundingBox,
  extractChapterName,
  type FlowEdge,
  type FlowNode,
  getChapterId,
  getNodeHeight,
  groupNodesByChapter,
  type LayoutDensity,
  NODE_WIDTH,
  normalizeChildPosition,
  normalizeForkRejoinGeometry,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  redirectEdgesForCollapsedChapters,
  resolveGraphIntegrity,
  type ThemeName,
} from "../../domain/index.ts";
import {
  computeSpatialItemsAndBounds,
  createSpatialIndexFromItems,
} from "../spatialIndex.ts";
import {
  type LayoutResult,
  PROGRESSIVE_FALLBACK_MAX_COLUMNS,
} from "./types.ts";
import {
  computeChapterTopologySignature,
  dagreMicroLayoutCache,
  getBoundedCacheEntry,
  setBoundedCacheEntry,
} from "./layoutCache.ts";
import {
  applyLeafTranslationAlignment,
  buildCanvasNodeData,
  mapDomainNodeTypeToCanvasType,
} from "./nodeFormatting.ts";
import { buildCanvasEdges } from "./edgeBuilder.ts";
function selectPrimaryNodesBfs(
  normalizedNodes: FlowNode[],
  normalizedEdges: FlowEdge[],
  limit: number,
): { primaryNodes: FlowNode[]; overflowNodes: FlowNode[] } {
  if (normalizedNodes.length <= limit) {
    return { primaryNodes: normalizedNodes, overflowNodes: [] };
  }

  const nodeById = new Map(normalizedNodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const edge of normalizedEdges) {
    if (
      edge.source === edge.target ||
      !nodeById.has(edge.source) ||
      !nodeById.has(edge.target)
    ) {
      continue;
    }
    let list = outgoing.get(edge.source);
    if (!list) {
      list = [];
      outgoing.set(edge.source, list);
    }
    list.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const visited = new Set<string>();
  const primaryNodes: FlowNode[] = [];

  const runBfsFromSeed = (seedId: string) => {
    if (
      visited.has(seedId) ||
      !nodeById.has(seedId) ||
      primaryNodes.length >= limit
    ) {
      return;
    }
    visited.add(seedId);
    const queue: string[] = [seedId];
    let head = 0;
    while (head < queue.length && primaryNodes.length < limit) {
      const currId = queue[head++]!;
      const node = nodeById.get(currId);
      if (!node) continue;
      primaryNodes.push(node);
      if (primaryNodes.length >= limit) break;

      const neighbors = outgoing.get(currId);
      if (neighbors) {
        for (const targetId of neighbors) {
          if (!visited.has(targetId) && nodeById.has(targetId)) {
            visited.add(targetId);
            queue.push(targetId);
          }
        }
      }
    }
  };

  // 1. Traverse breadth-first from start node(s)
  for (const n of normalizedNodes) {
    if (n.id === "start" || n.label.toLowerCase() === "start") {
      runBfsFromSeed(n.id);
    }
  }

  // 2. Traverse breadth-first from zero-in-degree roots in script order
  for (const n of normalizedNodes) {
    if (primaryNodes.length >= limit) break;
    if ((inDegree.get(n.id) ?? 0) === 0) {
      runBfsFromSeed(n.id);
    }
  }

  // 3. Fallback: traverse any remaining unvisited nodes in script order
  for (const n of normalizedNodes) {
    if (primaryNodes.length >= limit) break;
    runBfsFromSeed(n.id);
  }

  const primarySet = new Set(primaryNodes.map((n) => n.id));
  const overflowNodes = normalizedNodes.filter((n) => !primarySet.has(n.id));
  return { primaryNodes, overflowNodes };
}

/**
 * Fallback grid placement used when a graph is too large for comfortable standard layout.
 */
function applyProgressiveDagreLayout(
  normalizedNodes: FlowNode[],
  normalizedEdges: FlowEdge[],
  direction: "TB" | "LR",
  options?: {
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
    previousPositions?: Map<string, { x: number; y: number }>;
  },
): LayoutResult {
  const isDark = options?.theme === "dark";
  const edgeColor = isDark ? "#475569" : "#cbd5e1";

  const prevMap = options?.previousPositions;

  // Lays out the primary N nodes via BFS from start, then places the rest in a grid
  const { primaryNodes, overflowNodes } = selectPrimaryNodesBfs(
    normalizedNodes,
    normalizedEdges,
    PROGRESSIVE_LAYOUT_NODE_LIMIT,
  );

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
      type: mapDomainNodeTypeToCanvasType(n.type),
      position: { x, y },
      width: NODE_WIDTH,
      height: h,
      data: buildCanvasNodeData(n),
      draggable: true,
      measured: { width: NODE_WIDTH, height: h },
    };
  });

  const { items: spatialItems, bounds: spatialBounds } =
    computeSpatialItemsAndBounds(nodes);
  const quadtree = createSpatialIndexFromItems(spatialItems, spatialBounds);
  const edges = buildCanvasEdges(
    normalizedEdges,
    nodes,
    direction,
    edgeColor,
    undefined,
    quadtree,
    spatialBounds,
  );

  return { nodes, edges, spatialItems, spatialBounds };
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
    collapsedParentLabels?: Record<string, boolean>;
  },
): LayoutResult {
  const { nodes: integrityNodes, edges: integrityEdges } =
    resolveGraphIntegrity(rawNodes, rawEdges);
  const { nodes: normalizedNodes, edges: normalizedEdges } =
    collapseParentLabelSubgraphs(
      integrityNodes,
      integrityEdges,
      options?.collapsedParentLabels,
    );
  const shouldUseProgressive = options?.progressive === true &&
    normalizedNodes.length > PROGRESSIVE_LAYOUT_NODE_LIMIT;

  if (shouldUseProgressive) {
    return applyProgressiveDagreLayout(
      normalizedNodes,
      normalizedEdges,
      direction,
      options,
    );
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

  if (isCompound) {
    return applyTwoTierDagreLayout(
      normalizedNodes,
      effectiveEdges,
      direction,
      {
        theme: options?.theme,
        layoutDensity: options?.layoutDensity,
        collapsedChapters,
        previousPositions: prevMap,
      },
    );
  }

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
      type: mapDomainNodeTypeToCanvasType(n.type),
      position: { x, y },
      width: NODE_WIDTH,
      height: h,
      data: buildCanvasNodeData(n),
      draggable: true,
      measured: { width: NODE_WIDTH, height: h },
    });
  });

  normalizeForkRejoinGeometry(nodes, effectiveEdges, direction);
  applyLeafTranslationAlignment(nodes, prevMap);

  const { items: spatialItems, bounds: spatialBounds } =
    computeSpatialItemsAndBounds(nodes);
  const quadtree = createSpatialIndexFromItems(spatialItems, spatialBounds);
  const edges = buildCanvasEdges(
    effectiveEdges,
    nodes,
    direction,
    edgeColor,
    undefined,
    quadtree,
    spatialBounds,
  );

  return { nodes, edges, spatialItems, spatialBounds };
}

/**
 * Applies a Two-Tier Hierarchical Dagre layout:
 * - Tier 1: Independent micro Dagre layout for each expanded chapter's internal nodes (cached).
 * - Exact tight bounding box calculation (with header clearance and padding).
 * - Tier 2: Macro Dagre layout for chapter containers using deduplicated cross-chapter edges.
 * - Coordinate stitching, leaf centroid alignment, and edge generation.
 */
export function applyTwoTierDagreLayout(
  normalizedNodes: FlowNode[],
  effectiveEdges: FlowEdge[],
  direction: "TB" | "LR",
  options?: {
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
    collapsedChapters?: Record<string, boolean>;
    previousPositions?: Map<string, { x: number; y: number }>;
  },
): LayoutResult {
  const isDark = options?.theme === "dark";
  const edgeColor = isDark ? "#475569" : "#cbd5e1";
  const density = options?.layoutDensity ?? "normal";
  const collapsedChapters = options?.collapsedChapters ?? {};
  const chapterGroups = groupNodesByChapter(normalizedNodes);
  const chapterStats = computeChapterAggregates(
    normalizedNodes,
    chapterGroups,
  );

  // Micro spacing
  let microRanksep = direction === "TB" ? 80 : 110;
  let microNodesep = 50;
  if (density === "compact") {
    microRanksep = direction === "TB" ? 50 : 70;
    microNodesep = 30;
  } else if (density === "spacious") {
    microRanksep = direction === "TB" ? 120 : 160;
    microNodesep = 80;
  }

  // Macro spacing
  let macroRanksep = direction === "TB" ? 140 : 180;
  let macroNodesep = 90;
  if (density === "compact") {
    macroRanksep = direction === "TB" ? 100 : 130;
    macroNodesep = 60;
  } else if (density === "spacious") {
    macroRanksep = direction === "TB" ? 200 : 250;
    macroNodesep = 130;
  }

  // Map nodeId -> chapterName
  const chapterByNodeId = new Map<string, string>();
  for (const [chapterName, cNodes] of chapterGroups.entries()) {
    for (const n of cNodes) {
      chapterByNodeId.set(n.id, chapterName);
    }
  }

  // Partition edges into intra-chapter and cross-chapter
  const intraChapterEdges = new Map<string, FlowEdge[]>();
  const crossChapterEdges: FlowEdge[] = [];

  for (const edge of effectiveEdges) {
    const sChap = chapterByNodeId.get(edge.source) ??
      (edge.source.startsWith("chapter:")
        ? extractChapterName(edge.source)
        : undefined);
    const tChap = chapterByNodeId.get(edge.target) ??
      (edge.target.startsWith("chapter:")
        ? extractChapterName(edge.target)
        : undefined);

    if (sChap && tChap && sChap === tChap) {
      const list = intraChapterEdges.get(sChap) ?? [];
      list.push(edge);
      intraChapterEdges.set(sChap, list);
    } else {
      crossChapterEdges.push(edge);
    }
  }

  // 1. Tier 1: Micro layout for each chapter (with per-chapter caching)
  interface ChapterPlacement {
    chapterName: string;
    chapterId: string;
    isCollapsed: boolean;
    width: number;
    height: number;
    childRelativePositions: Map<
      string,
      { x: number; y: number; height: number }
    >;
  }

  const placements: ChapterPlacement[] = [];

  for (const [chapterName, cNodes] of chapterGroups.entries()) {
    if (cNodes.length === 0) continue;
    const isCollapsed = Boolean(collapsedChapters[chapterName]);
    const chapterId = getChapterId(chapterName);

    if (isCollapsed) {
      placements.push({
        chapterName,
        chapterId,
        isCollapsed: true,
        width: CHAPTER_SUMMARY_WIDTH,
        height: CHAPTER_SUMMARY_HEIGHT,
        childRelativePositions: new Map(),
      });
      continue;
    }

    const cEdges = intraChapterEdges.get(chapterName) ?? [];
    const cacheKey = `dagre__${chapterName}__${direction}__${density}__${
      computeChapterTopologySignature(cNodes, cEdges)
    }`;
    const cachedMicro = getBoundedCacheEntry(dagreMicroLayoutCache, cacheKey);

    if (cachedMicro) {
      placements.push({
        chapterName,
        chapterId,
        isCollapsed: false,
        width: cachedMicro.width,
        height: cachedMicro.height,
        childRelativePositions: cachedMicro.childRelativePositions,
      });
      continue;
    }

    const microG = new dagre.graphlib.Graph();
    microG.setGraph({
      rankdir: direction,
      ranksep: microRanksep,
      nodesep: microNodesep,
      marginx: 0,
      marginy: 0,
    });
    microG.setDefaultEdgeLabel(() => ({}));

    cNodes.forEach((node) => {
      microG.setNode(node.id, {
        width: NODE_WIDTH,
        height: getNodeHeight(node),
      });
    });

    cEdges.forEach((edge) => {
      if (
        edge.source !== edge.target &&
        microG.hasNode(edge.source) &&
        microG.hasNode(edge.target)
      ) {
        microG.setEdge(edge.source, edge.target);
      }
    });

    dagre.layout(microG);

    const placedNodes: Array<
      { x: number; y: number; width: number; height: number }
    > = [];
    cNodes.forEach((node) => {
      const dNode = microG.node(node.id);
      const h = getNodeHeight(node);
      if (dNode) {
        placedNodes.push({
          x: dNode.x,
          y: dNode.y,
          width: NODE_WIDTH,
          height: h,
        });
      }
    });

    const bbox = computeClusterBoundingBox(
      placedNodes,
      CHAPTER_CONTAINER_PADDING,
    );

    const childRelativePositions = new Map<
      string,
      { x: number; y: number; height: number }
    >();
    cNodes.forEach((node) => {
      const dNode = microG.node(node.id);
      const h = getNodeHeight(node);
      if (dNode) {
        const rel = normalizeChildPosition(
          dNode,
          NODE_WIDTH,
          h,
          bbox.minX,
          bbox.minY,
          CHAPTER_CONTAINER_PADDING,
        );
        childRelativePositions.set(node.id, { x: rel.x, y: rel.y, height: h });
      } else {
        childRelativePositions.set(node.id, {
          x: CHAPTER_CONTAINER_PADDING.left,
          y: CHAPTER_CONTAINER_PADDING.top,
          height: h,
        });
      }
    });

    setBoundedCacheEntry(dagreMicroLayoutCache, cacheKey, {
      width: bbox.width,
      height: bbox.height,
      childRelativePositions,
    });

    placements.push({
      chapterName,
      chapterId,
      isCollapsed: false,
      width: bbox.width,
      height: bbox.height,
      childRelativePositions,
    });
  }

  // 2. Tier 2: Macro layout for chapter containers
  const macroG = new dagre.graphlib.Graph();
  macroG.setGraph({
    rankdir: direction,
    ranksep: macroRanksep,
    nodesep: macroNodesep,
    marginx: 40,
    marginy: 40,
  });
  macroG.setDefaultEdgeLabel(() => ({}));

  placements.forEach((p) => {
    macroG.setNode(p.chapterId, {
      width: p.width,
      height: p.height,
    });
  });

  crossChapterEdges.forEach((edge) => {
    const sChap = chapterByNodeId.get(edge.source) ??
      (edge.source.startsWith("chapter:")
        ? extractChapterName(edge.source)
        : undefined);
    const tChap = chapterByNodeId.get(edge.target) ??
      (edge.target.startsWith("chapter:")
        ? extractChapterName(edge.target)
        : undefined);

    if (sChap && tChap && sChap !== tChap) {
      const sId = getChapterId(sChap);
      const tId = getChapterId(tChap);
      if (macroG.hasNode(sId) && macroG.hasNode(tId)) {
        macroG.setEdge(sId, tId);
      }
    }
  });

  dagre.layout(macroG);

  // 3. Assemble canvas nodes (Strict parent-before-child ordering)
  const nodes: CanvasNode[] = [];

  placements.forEach((p) => {
    const dChapter = macroG.node(p.chapterId);
    const parentTopLeftX = dChapter ? dChapter.x - p.width / 2 : 0;
    const parentTopLeftY = dChapter ? dChapter.y - p.height / 2 : 0;
    const stats = chapterStats.get(p.chapterName);

    // 1. Add parent ChapterNode first
    nodes.push({
      id: p.chapterId,
      type: "chapterNode",
      position: { x: parentTopLeftX, y: parentTopLeftY },
      width: p.width,
      height: p.height,
      style: {
        width: p.width,
        height: p.height,
      },
      data: {
        label: p.chapterName,
        chapter: p.chapterName,
        nodeType: "LABEL",
        dialogueCount: stats?.dialogueCount ?? 0,
        wordCount: stats?.wordCount ?? 0,
        pauseDuration: stats?.pauseDuration ?? 0,
        isChapterContainer: true,
        isCollapsed: p.isCollapsed,
        chapterNodeCount: stats?.nodeCount ?? 0,
        chapterTotalDialogueCount: stats?.dialogueCount ?? 0,
        chapterTotalWordCount: stats?.wordCount ?? 0,
        chapterTotalPauseDuration: stats?.pauseDuration ?? 0,
      },
      draggable: true,
      measured: {
        width: p.width,
        height: p.height,
      },
    });

    // 2. If expanded, add child nodes with relative position
    if (!p.isCollapsed) {
      const cNodes = chapterGroups.get(p.chapterName) ?? [];
      cNodes.forEach((n) => {
        const placed = p.childRelativePositions.get(n.id);
        const relX = placed?.x ?? CHAPTER_CONTAINER_PADDING.left;
        const relY = placed?.y ?? CHAPTER_CONTAINER_PADDING.top;
        const h = placed?.height ?? getNodeHeight(n);

        nodes.push({
          id: n.id,
          type: mapDomainNodeTypeToCanvasType(n.type),
          parentId: p.chapterId,
          extent: "parent",
          position: { x: relX, y: relY },
          width: NODE_WIDTH,
          height: h,
          data: buildCanvasNodeData(n),
          draggable: true,
          measured: { width: NODE_WIDTH, height: h },
        });
      });
    }
  });

  normalizeForkRejoinGeometry(nodes, effectiveEdges, direction);
  applyLeafTranslationAlignment(nodes, options?.previousPositions);

  const { items: spatialItems, bounds: spatialBounds } =
    computeSpatialItemsAndBounds(nodes);
  const quadtree = createSpatialIndexFromItems(spatialItems, spatialBounds);
  const edges = buildCanvasEdges(
    effectiveEdges,
    nodes,
    direction,
    edgeColor,
    undefined,
    quadtree,
    spatialBounds,
  );

  return { nodes, edges, spatialItems, spatialBounds };
}
