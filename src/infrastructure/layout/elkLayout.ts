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
  normalizeForkRejoinGeometry,
  redirectEdgesForCollapsedChapters,
  resolveGraphIntegrity,
  type ThemeName,
} from "../../domain/index.ts";
import {
  computeSpatialItemsAndBounds,
  createSpatialIndexFromItems,
} from "../spatialIndex.ts";
import type {
  CachedChapterMicroPlacement,
  ElkEdge,
  ElkEdgeSection,
  ElkGraph,
  ElkInstance,
  ElkNode,
  ElkPoint,
  LayoutResult,
} from "./types.ts";
import {
  clearLayoutCaches,
  computeChapterTopologySignature,
  elkMicroLayoutCache,
  getBoundedCacheEntry,
  setBoundedCacheEntry,
} from "./layoutCache.ts";
import {
  applyLeafTranslationAlignment,
  buildCanvasNodeData,
  mapDomainNodeTypeToCanvasType,
} from "./nodeFormatting.ts";
import { buildCanvasEdges } from "./edgeBuilder.ts";

let elkInstance: ElkInstance | null = null;
export function setElkInstance(instance: ElkInstance | null): void {
  elkInstance = instance;
  clearLayoutCaches();
}

export async function preWarmElk(customInstance?: ElkInstance): Promise<void> {
  if (customInstance) {
    elkInstance = customInstance;
    return;
  }
  if (!elkInstance) {
    const BundledELKModule = await import("elkjs/lib/elk.bundled.js");
    const BundledELK = (BundledELKModule.default ||
      BundledELKModule) as unknown as new () => ElkInstance;
    elkInstance = new BundledELK();
  }
}

function buildElkNodeLayoutOptions(
  n: FlowNode,
): Record<string, string> | undefined {
  const isLoop = n.role === "while_loop" || n.role === "for_loop" ||
    n.condition?.branchKind === "while" ||
    n.condition?.branchKind === "for";
  const isStart = n.id === "start" || n.label.toLowerCase() === "start";
  if (!isLoop && !isStart) return undefined;

  const opts: Record<string, string> = {};
  if (isLoop) {
    opts["org.eclipse.elk.portConstraints"] = "FIXED_SIDE";
    opts["org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment"] =
      "BALANCED";
  }
  if (isStart) {
    opts["org.eclipse.elk.layered.layering.layerConstraint"] = "FIRST";
  }
  return opts;
}

function buildElkLayeredOptions(
  direction: "TB" | "LR",
  nodesep: number,
  ranksep: number,
  padding = "[top=30,left=30,bottom=30,right=30]",
): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": direction === "TB" ? "DOWN" : "RIGHT",
    "elk.separateConnectedComponents": "true",
    "elk.spacing.nodeNode": String(nodesep),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(ranksep),
    "elk.padding": padding,
    "org.eclipse.elk.nodePlacement.strategy": "BRANDES_KOEPF",
    "org.eclipse.elk.layered.nodePlacement.favorStraightEdges": "true",
    "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
    "org.eclipse.elk.layered.feedbackEdges": "true",
    "org.eclipse.elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    "org.eclipse.elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "org.eclipse.elk.spacing.edgeEdge": "15",
    "org.eclipse.elk.spacing.edgeNode": "25",
    "org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers": "25",
    "org.eclipse.elk.layered.unnecessaryBendpoints": "false",
  };
}

/**
 * Applies a Two-Tier Hierarchical ELK layout:
 * - Tier 1: Independent micro ELK layout per expanded chapter (cached via `elkMicroLayoutCache`).
 * - Tight bounding box calculation (`computeClusterBoundingBox`) and container-relative normalization.
 * - Tier 2: Macro ELK layout for chapter containers using deduplicated cross-chapter edges.
 * - Coordinate stitching, leaf-level centroid translation alignment, and obstacle-aware edge routing.
 */
export async function applyTwoTierElkLayout(
  normalizedNodes: FlowNode[],
  effectiveEdges: FlowEdge[],
  direction: "TB" | "LR",
  options?: {
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
    collapsedChapters?: Record<string, boolean>;
    previousPositions?:
      | Map<string, { x: number; y: number }>
      | Array<[string, { x: number; y: number }]>;
  },
): Promise<LayoutResult> {
  await preWarmElk();
  const instance = elkInstance!;

  const edgeColor = options?.theme === "dark"
    ? "#475569"
    : options?.theme === "highContrast"
    ? "#000000"
    : "#cbd5e1";
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

  const loopNodeIds = new Set(
    normalizedNodes
      .filter((n) =>
        n.role === "while_loop" || n.role === "for_loop" ||
        n.condition?.branchKind === "while" || n.condition?.branchKind === "for"
      )
      .map((n) => n.id),
  );

  const chapterByNodeId = new Map<string, string>();
  for (const [chapterName, cNodes] of chapterGroups.entries()) {
    for (const n of cNodes) {
      chapterByNodeId.set(n.id, chapterName);
    }
  }

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

  interface ElkChapterPlacement extends CachedChapterMicroPlacement {
    chapterName: string;
    chapterId: string;
    isCollapsed: boolean;
  }

  const placements: ElkChapterPlacement[] = [];

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
    const cacheKey = `elk__${chapterName}__${direction}__${density}__${
      computeChapterTopologySignature(cNodes, cEdges)
    }`;
    const cachedMicro = getBoundedCacheEntry(elkMicroLayoutCache, cacheKey);

    if (cachedMicro) {
      placements.push({
        chapterName,
        chapterId,
        isCollapsed: false,
        width: cachedMicro.width,
        height: cachedMicro.height,
        childRelativePositions: cachedMicro.childRelativePositions,
        relativeEdgeSections: cachedMicro.relativeEdgeSections,
      });
      continue;
    }

    const microChildren: ElkNode[] = cNodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: getNodeHeight(n),
      layoutOptions: buildElkNodeLayoutOptions(n),
    }));

    const microNodeIds = new Set(cNodes.map((n) => n.id));
    const microEdges: ElkEdge[] = cEdges
      .filter((e) => microNodeIds.has(e.source) && microNodeIds.has(e.target))
      .map((e) => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
        layoutOptions: (loopNodeIds.has(e.target)
          ? {
            "org.eclipse.elk.layered.priority.direction": "0",
            "org.eclipse.elk.layered.priority.shortness": "5",
          }
          : {
            "org.eclipse.elk.layered.priority.direction": "10",
          }) as Record<string, string>,
      }));

    const microGraph: ElkGraph = {
      id: chapterId,
      layoutOptions: buildElkLayeredOptions(
        direction,
        microNodesep,
        microRanksep,
        "[top=0,left=0,bottom=0,right=0]",
      ),
      children: microChildren,
      edges: microEdges,
    };

    const laidOutMicro = await instance.layout(microGraph);
    const elkChildById = new Map<string, ElkNode>();
    laidOutMicro.children?.forEach((c) => {
      elkChildById.set(c.id, c);
    });

    const placedCenterNodes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    cNodes.forEach((n) => {
      const elkChild = elkChildById.get(n.id);
      const h = getNodeHeight(n);
      if (elkChild) {
        const topLeftX = elkChild.x ?? 0;
        const topLeftY = elkChild.y ?? 0;
        placedCenterNodes.push({
          x: topLeftX + NODE_WIDTH / 2,
          y: topLeftY + h / 2,
          width: NODE_WIDTH,
          height: h,
        });
      }
    });

    const bbox = computeClusterBoundingBox(
      placedCenterNodes,
      CHAPTER_CONTAINER_PADDING,
    );
    const shiftX = -bbox.minX + CHAPTER_CONTAINER_PADDING.left;
    const shiftY = -bbox.minY + CHAPTER_CONTAINER_PADDING.top;

    const childRelativePositions = new Map<
      string,
      { x: number; y: number; height: number }
    >();
    cNodes.forEach((n) => {
      const elkChild = elkChildById.get(n.id);
      const h = getNodeHeight(n);
      if (elkChild) {
        childRelativePositions.set(n.id, {
          x: (elkChild.x ?? 0) + shiftX,
          y: (elkChild.y ?? 0) + shiftY,
          height: h,
        });
      } else {
        childRelativePositions.set(n.id, {
          x: CHAPTER_CONTAINER_PADDING.left,
          y: CHAPTER_CONTAINER_PADDING.top,
          height: h,
        });
      }
    });

    const relativeEdgeSections = new Map<
      string,
      { sections?: ElkEdgeSection[]; junctionPoints?: ElkPoint[] }
    >();
    laidOutMicro.edges?.forEach((edge) => {
      relativeEdgeSections.set(edge.id, {
        sections: edge.sections?.map((s) => ({
          ...s,
          startPoint: {
            x: s.startPoint.x + shiftX,
            y: s.startPoint.y + shiftY,
          },
          endPoint: {
            x: s.endPoint.x + shiftX,
            y: s.endPoint.y + shiftY,
          },
          bendPoints: s.bendPoints?.map((bp) => ({
            x: bp.x + shiftX,
            y: bp.y + shiftY,
          })),
        })),
        junctionPoints: edge.junctionPoints?.map((jp) => ({
          x: jp.x + shiftX,
          y: jp.y + shiftY,
        })),
      });
    });

    const cacheEntry: CachedChapterMicroPlacement = {
      width: bbox.width,
      height: bbox.height,
      childRelativePositions,
      relativeEdgeSections,
    };
    setBoundedCacheEntry(elkMicroLayoutCache, cacheKey, cacheEntry);

    placements.push({
      chapterName,
      chapterId,
      isCollapsed: false,
      ...cacheEntry,
    });
  }

  // 2. Tier 2: Macro ELK layout for chapter containers
  const macroChildren: ElkNode[] = placements.map((p) => ({
    id: p.chapterId,
    width: p.width,
    height: p.height,
  }));

  const macroNodeIds = new Set(placements.map((p) => p.chapterId));
  const seenMacroEdges = new Set<string>();
  const macroEdges: ElkEdge[] = [];

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
      if (macroNodeIds.has(sId) && macroNodeIds.has(tId)) {
        const pairKey = `${sId}__${tId}`;
        if (!seenMacroEdges.has(pairKey)) {
          seenMacroEdges.add(pairKey);
          macroEdges.push({
            id: `macro_${pairKey}`,
            sources: [sId],
            targets: [tId],
          });
        }
      }
    }
  });

  const macroGraph: ElkGraph = {
    id: "root",
    layoutOptions: buildElkLayeredOptions(
      direction,
      macroNodesep,
      macroRanksep,
      "[top=40,left=40,bottom=40,right=40]",
    ),
    children: macroChildren,
    edges: macroEdges,
  };

  const laidOutMacro = await instance.layout(macroGraph);
  const macroChapterById = new Map<string, ElkNode>();
  laidOutMacro.children?.forEach((c) => {
    macroChapterById.set(c.id, c);
  });

  // 3. Assemble canvas nodes and offset intra-chapter edge sections to root space
  const nodes: CanvasNode[] = [];
  const elkEdgeMap = new Map<string, ElkEdge>();

  placements.forEach((p) => {
    const macroChapter = macroChapterById.get(p.chapterId);
    const parentTopLeftX = macroChapter?.x ?? 0;
    const parentTopLeftY = macroChapter?.y ?? 0;
    const stats = chapterStats.get(p.chapterName);

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

      const cEdges = intraChapterEdges.get(p.chapterName) ?? [];
      cEdges.forEach((e) => {
        const relEdge = p.relativeEdgeSections?.get(e.id);
        if (relEdge) {
          elkEdgeMap.set(e.id, {
            id: e.id,
            sources: [e.source],
            targets: [e.target],
            sections: relEdge.sections?.map((s) => ({
              ...s,
              startPoint: {
                x: s.startPoint.x + parentTopLeftX,
                y: s.startPoint.y + parentTopLeftY,
              },
              endPoint: {
                x: s.endPoint.x + parentTopLeftX,
                y: s.endPoint.y + parentTopLeftY,
              },
              bendPoints: s.bendPoints?.map((bp) => ({
                x: bp.x + parentTopLeftX,
                y: bp.y + parentTopLeftY,
              })),
            })),
            junctionPoints: relEdge.junctionPoints?.map((jp) => ({
              x: jp.x + parentTopLeftX,
              y: jp.y + parentTopLeftY,
            })),
          });
        }
      });
    }
  });

  normalizeForkRejoinGeometry(nodes, effectiveEdges, direction);
  applyLeafTranslationAlignment(
    nodes,
    options?.previousPositions,
    elkEdgeMap,
  );

  const { items: spatialItems, bounds: spatialBounds } =
    computeSpatialItemsAndBounds(nodes);
  const quadtree = createSpatialIndexFromItems(spatialItems, spatialBounds);
  const edges = buildCanvasEdges(
    effectiveEdges,
    nodes,
    direction,
    edgeColor,
    elkEdgeMap,
    quadtree,
    spatialBounds,
  );

  return { nodes, edges, spatialItems, spatialBounds };
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
    collapsedParentLabels?: Record<string, boolean>;
  },
): Promise<LayoutResult> {
  await preWarmElk();
  const instance = elkInstance!;
  const { nodes: integrityNodes, edges: integrityEdges } =
    resolveGraphIntegrity(rawNodes, rawEdges);
  const { nodes: normalizedNodes, edges: normalizedEdges } =
    collapseParentLabelSubgraphs(
      integrityNodes,
      integrityEdges,
      options?.collapsedParentLabels,
    );

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

  if (isCompound) {
    return await applyTwoTierElkLayout(
      normalizedNodes,
      effectiveEdges,
      direction,
      {
        theme: options?.theme,
        layoutDensity: options?.layoutDensity,
        collapsedChapters,
        previousPositions: options?.previousPositions,
      },
    );
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

  const layoutOptions = buildElkLayeredOptions(direction, nodesep, ranksep);

  const elkNodes: ElkNode[] = normalizedNodes.map((n) => ({
    id: n.id,
    width: NODE_WIDTH,
    height: getNodeHeight(n),
    layoutOptions: buildElkNodeLayoutOptions(n),
  }));

  const graph: ElkGraph = {
    id: "root",
    layoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };

  const laidOutGraph = await instance.layout(graph);

  const nodes: CanvasNode[] = [];
  const normalizedNodeMap = new Map(normalizedNodes.map((n) => [n.id, n]));

  laidOutGraph.children?.forEach((child: ElkNode) => {
    const n = normalizedNodeMap.get(child.id);
    if (!n) return;
    const h = getNodeHeight(n);
    nodes.push({
      id: n.id,
      type: mapDomainNodeTypeToCanvasType(n.type),
      position: { x: child.x ?? 0, y: child.y ?? 0 },
      width: NODE_WIDTH,
      height: h,
      data: buildCanvasNodeData(n),
      draggable: true,
      measured: { width: NODE_WIDTH, height: h },
    });
  });

  const elkEdgeMap = new Map<string, ElkEdge>();
  laidOutGraph.edges?.forEach((e) => {
    elkEdgeMap.set(e.id, e);
  });

  normalizeForkRejoinGeometry(nodes, effectiveEdges, direction);
  applyLeafTranslationAlignment(
    nodes,
    options?.previousPositions,
    elkEdgeMap,
  );

  const edgeColor = options?.theme === "dark"
    ? "#475569"
    : options?.theme === "highContrast"
    ? "#000000"
    : "#cbd5e1";

  const { items: spatialItems, bounds: spatialBounds } =
    computeSpatialItemsAndBounds(nodes);
  const quadtree = createSpatialIndexFromItems(spatialItems, spatialBounds);

  const edges = buildCanvasEdges(
    effectiveEdges,
    nodes,
    direction,
    edgeColor,
    elkEdgeMap,
    quadtree,
    spatialBounds,
  );

  return { nodes, edges, spatialItems, spatialBounds };
}
