import dagre from "@dagrejs/dagre";
import {
  buildFilletedOrthogonalPath,
  calculateBackEdgeSpline,
  calculateObstructedForwardSpline,
  calculateParallelForwardSpline,
  calculateSelfLoopArc,
  type CanvasEdge,
  type CanvasNode,
  CHAPTER_CONTAINER_PADDING,
  CHAPTER_SUMMARY_HEIGHT,
  CHAPTER_SUMMARY_WIDTH,
  collapseParentLabelSubgraphs,
  computeChapterAggregates,
  computeClusterBoundingBox,
  detectBackEdge,
  extractChapterName,
  type FlowEdge,
  type FlowNode,
  getChapterId,
  getNodeHeight,
  groupNodesByChapter,
  type LayoutDensity,
  NODE_WIDTH,
  type NodeData,
  normalizeChildPosition,
  type ObstacleRect,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  redirectEdgesForCollapsedChapters,
  resolveGraphIntegrity,
  type SplineResult,
  type ThemeName,
} from "../domain/index.ts";
import {
  type AABB,
  computeSpatialItemsAndBounds,
  createSpatialIndexFromItems,
  type SpatialItem,
  type SpatialQuadtree,
} from "./spatialIndex.ts";

export interface LayoutResult {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  spatialItems?: SpatialItem[];
  spatialBounds?: AABB;
}

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
const MAX_CHAPTER_CACHE_ENTRIES = 128;

interface CachedChapterMicroPlacement {
  width: number;
  height: number;
  childRelativePositions: Map<
    string,
    { x: number; y: number; height: number }
  >;
  relativeEdgeSections?: Map<
    string,
    { sections?: ElkEdgeSection[]; junctionPoints?: ElkPoint[] }
  >;
}

const dagreMicroLayoutCache = new Map<string, CachedChapterMicroPlacement>();
const elkMicroLayoutCache = new Map<string, CachedChapterMicroPlacement>();

function setBoundedCacheEntry(
  cache: Map<string, CachedChapterMicroPlacement>,
  key: string,
  value: CachedChapterMicroPlacement,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_CHAPTER_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

function getBoundedCacheEntry(
  cache: Map<string, CachedChapterMicroPlacement>,
  key: string,
): CachedChapterMicroPlacement | undefined {
  const existing = cache.get(key);
  if (existing) {
    // Refresh LRU order
    cache.delete(key);
    cache.set(key, existing);
  }
  return existing;
}

/**
 * Clears all internal per-chapter micro-layout caches (for Dagre and ELK).
 */
export function clearLayoutCaches(): void {
  dagreMicroLayoutCache.clear();
  elkMicroLayoutCache.clear();
}

function computeChapterTopologySignature(
  cNodes: FlowNode[],
  cEdges: FlowEdge[],
): string {
  const nodeParts = cNodes.map((n) =>
    `${n.id}:${n.type}:${NODE_WIDTH}x${getNodeHeight(n)}:${n.role ?? ""}:${
      n.condition?.branchKind ?? ""
    }:${
      (n.id === "start" || n.label?.toLowerCase() === "start") ? "start" : ""
    }`
  );
  const edgeParts = cEdges.map((e) =>
    `${e.id}:${e.source}->${e.target}:${e.kind ?? ""}`
  );
  return `${nodeParts.join(",")}|${edgeParts.join(",")}`;
}

function buildCanvasNodeData(n: FlowNode): NodeData {
  return {
    label: n.label,
    dialogueCount: n.dialogueCount,
    wordCount: n.wordCount,
    pauseDuration: n.pauseDuration,
    dialogueLines: n.dialogueLines,
    dialogueLineNums: n.dialogueLineNums,
    audioAssetCues: n.audioAssetCues,
    mutations: n.mutations,
    nodeType: n.type,
    chapter: n.chapter,
    parentLabelId: n.parentLabelId,
    role: n.role,
    isShadowed: n.isShadowed,
    shadowOfId: n.shadowOfId,
    isTerminalOutcome: n.isTerminalOutcome,
    isOrphan: n.isOrphan,
    collapsedLabels: n.collapsedLabels,
    collapsedNodeIds: n.collapsedNodeIds,
    characterDialogue: n.characterDialogue,
    conditionExpression: n.condition?.expression,
    conditionReferences: n.condition?.references,
  };
}

/**
 * Maps a domain FlowNode type to its corresponding React Flow CanvasNode type.
 */
export function mapDomainNodeTypeToCanvasType(
  type: FlowNode["type"],
): "labelNode" | "menuNode" | "decisionNode" {
  if (type === "MENU") return "menuNode";
  if (type === "DECISION") return "decisionNode";
  return "labelNode";
}

function pointToRectBoundaryDist(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number {
  const dxOut = px < rx ? rx - px : px > rx + rw ? px - (rx + rw) : 0;
  const dyOut = py < ry ? ry - py : py > ry + rh ? py - (ry + rh) : 0;
  if (dxOut > 0 || dyOut > 0) {
    return Math.hypot(dxOut, dyOut);
  }
  return Math.min(px - rx, rx + rw - px, py - ry, ry + rh - py);
}

/**
 * Applies translation delta alignment using absolute leaf node coordinates
 * (falling back to container IDs when all chapters are collapsed) so toggling
 * layout settings or compound mode keeps the graph visually anchored.
 */
function applyLeafTranslationAlignment(
  nodes: CanvasNode[],
  previousPositions?:
    | Map<string, { x: number; y: number }>
    | Array<[string, { x: number; y: number }]>,
  elkEdgeMap?: Map<string, ElkEdge>,
): void {
  if (!previousPositions) return;
  const prevMap = previousPositions instanceof Map
    ? previousPositions
    : new Map(previousPositions);
  if (prevMap.size === 0) return;

  const nodeById = new Map<string, CanvasNode>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    nodeById.set(n.id, n);
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.type === "chapterNode") continue;
    const prev = prevMap.get(n.id);
    if (!prev) continue;

    let absX = n.position.x;
    let absY = n.position.y;
    if (n.parentId) {
      const parent = nodeById.get(n.parentId);
      if (parent) {
        absX += parent.position.x;
        absY += parent.position.y;
      }
    }
    sumX += prev.x - absX;
    sumY += prev.y - absY;
    count += 1;
  }

  if (count === 0) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const prev = prevMap.get(n.id);
      if (prev) {
        sumX += prev.x - n.position.x;
        sumY += prev.y - n.position.y;
        count += 1;
      }
    }
  }

  if (count === 0) return;

  const deltaX = sumX / count;
  const deltaY = sumY / count;
  if (Math.abs(deltaX) < 1e-6 && Math.abs(deltaY) < 1e-6) return;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (!n.parentId) {
      n.position = {
        x: n.position.x + deltaX,
        y: n.position.y + deltaY,
      };
    }
  }

  if (elkEdgeMap) {
    for (const edge of elkEdgeMap.values()) {
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
    }
  }
}

/**
 * Generates CanvasEdges with smart loop, back-edge, and two-phase SpatialQuadtree obstacle spline routing.
 */
function buildCanvasEdges(
  normalizedEdges: FlowEdge[],
  nodes: CanvasNode[],
  direction: "TB" | "LR",
  edgeColor: string,
  elkEdgeMap?: Map<string, ElkEdge>,
  quadtree?: SpatialQuadtree,
  spatialBounds?: AABB,
): CanvasEdge[] {
  const nodeById = new Map<string, CanvasNode>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    nodeById.set(node.id, node);
  }

  const absolutePositions = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.parentId) {
      const parent = nodeById.get(node.parentId);
      if (parent) {
        absolutePositions.set(node.id, {
          x: parent.position.x + node.position.x,
          y: parent.position.y + node.position.y,
        });
        continue;
      }
    }
    absolutePositions.set(node.id, node.position);
  }

  // Track parallel back-edges to assign laneIndex
  const corridorCounts = new Map<string, number>();

  const validEdges = normalizedEdges.filter(
    (e) => nodeById.has(e.source) && nodeById.has(e.target),
  );

  // Group forward edges to compute parallelCount and parallelIndex
  const forwardEdgeGroups = new Map<string, FlowEdge[]>();
  for (const e of validEdges) {
    const sourcePos = absolutePositions.get(e.source) ?? { x: 0, y: 0 };
    const targetPos = absolutePositions.get(e.target) ?? { x: 0, y: 0 };
    const isSelfLoop = e.source === e.target;
    const isBackEdge = detectBackEdge(
      sourcePos,
      targetPos,
      direction,
      isSelfLoop,
    );
    if (!isSelfLoop && !isBackEdge) {
      const key = `${e.source}__${e.target}`;
      const group = forwardEdgeGroups.get(key);
      if (group) {
        group.push(e);
      } else {
        forwardEdgeGroups.set(key, [e]);
      }
    }
  }

  const parallelMetaByEdgeId = new Map<
    string,
    { parallelIndex: number; parallelCount: number }
  >();
  for (const group of forwardEdgeGroups.values()) {
    if (group.length > 1) {
      group.forEach((edge, idx) => {
        parallelMetaByEdgeId.set(edge.id, {
          parallelIndex: idx,
          parallelCount: group.length,
        });
      });
    }
  }

  const nodeObstacles: ObstacleRect[] = [];
  const obstacleById = new Map<string, { obs: ObstacleRect; order: number }>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (
      (node.type === "chapterNode" || node.data?.isChapterContainer) &&
      !node.data?.isCollapsed
    ) {
      continue;
    }
    const pos = absolutePositions.get(node.id) ?? node.position;
    const obs: ObstacleRect = {
      id: node.id,
      x: pos.x,
      y: pos.y,
      width: node.width ?? NODE_WIDTH,
      height: node.height ?? 80,
    };
    const order = nodeObstacles.length;
    nodeObstacles.push(obs);
    obstacleById.set(node.id, { obs, order });
  }

  interface ForwardCoords {
    forwardSX: number;
    forwardSY: number;
    forwardTX: number;
    forwardTY: number;
    existingPts?: Array<{ x: number; y: number }>;
    sections?: ElkEdgeSection[];
    filleted?: SplineResult;
    initialLabel: { labelX: number; labelY: number };
  }

  interface PrecomputedForwardBypass {
    detourSide: "left" | "right" | "top" | "bottom";
    hitObstacles: ObstacleRect[];
    obstacles: ObstacleRect[];
    detourLaneIndex: number;
    detourLaneCount: number;
    path: string;
    labelPosition: { x: number; y: number };
    bendPoints: Array<{ x: number; y: number }>;
    sections?: ElkEdgeSection[];
  }

  const forwardCoordsByEdgeId = new Map<string, ForwardCoords>();

  const getForwardCoords = (e: FlowEdge): ForwardCoords => {
    const cached = forwardCoordsByEdgeId.get(e.id);
    if (cached) return cached;

    const sourcePos = absolutePositions.get(e.source) ?? { x: 0, y: 0 };
    const targetPos = absolutePositions.get(e.target) ?? { x: 0, y: 0 };
    const sourceNode = nodeById.get(e.source);
    const targetNode = nodeById.get(e.target);
    const sourceIsDecision = sourceNode?.data?.nodeType === "DECISION";
    const targetIsDecision = targetNode?.data?.nodeType === "DECISION";
    const sourceWidth = sourceNode?.width ?? NODE_WIDTH;
    const targetWidth = targetNode?.width ?? NODE_WIDTH;
    const sourceHeight = sourceNode?.height ?? 80;
    const targetHeight = targetNode?.height ?? 80;

    const forwardSX = direction === "TB"
      ? sourcePos.x + sourceWidth / 2
      : sourcePos.x + (sourceIsDecision ? 190 : sourceWidth);
    const forwardSY = direction === "TB"
      ? sourcePos.y + (sourceIsDecision ? sourceHeight - 8 : sourceHeight)
      : sourcePos.y + sourceHeight / 2;
    const forwardTX = direction === "TB"
      ? targetPos.x + targetWidth / 2
      : targetPos.x + (targetIsDecision ? 30 : 0);
    const forwardTY = direction === "TB"
      ? targetPos.y + (targetIsDecision ? 8 : 0)
      : targetPos.y + targetHeight / 2;

    let existingPts: Array<{ x: number; y: number }> | undefined;
    let sections: ElkEdgeSection[] | undefined;
    const elkEdge = elkEdgeMap?.get(e.id);
    if (elkEdge?.sections && elkEdge.sections.length > 0) {
      sections = elkEdge.sections;
      const section = elkEdge.sections[0]!;
      let offsetX = 0;
      let offsetY = 0;
      if (
        sourceNode?.parentId &&
        sourceNode.parentId === targetNode?.parentId
      ) {
        const parentNode = nodeById.get(sourceNode.parentId);
        if (
          parentNode &&
          (parentNode.position.x !== 0 || parentNode.position.y !== 0)
        ) {
          const lastSection = elkEdge.sections[elkEdge.sections.length - 1] ??
            section;
          const endPoint = lastSection.endPoint ?? section.endPoint;
          const distToAbs = pointToRectBoundaryDist(
            section.startPoint.x,
            section.startPoint.y,
            sourcePos.x,
            sourcePos.y,
            sourceWidth,
            sourceHeight,
          ) +
            (targetNode
              ? pointToRectBoundaryDist(
                endPoint.x,
                endPoint.y,
                targetPos.x,
                targetPos.y,
                targetWidth,
                targetHeight,
              )
              : 0);
          const distToRel = pointToRectBoundaryDist(
            section.startPoint.x,
            section.startPoint.y,
            sourceNode.position.x,
            sourceNode.position.y,
            sourceWidth,
            sourceHeight,
          ) +
            (targetNode
              ? pointToRectBoundaryDist(
                endPoint.x,
                endPoint.y,
                targetNode.position.x,
                targetNode.position.y,
                targetWidth,
                targetHeight,
              )
              : 0);
          if (distToRel + 1 < distToAbs) {
            offsetX = parentNode.position.x;
            offsetY = parentNode.position.y;
          }
        }
      }
      const rawPts = [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ];
      if (offsetX !== 0 || offsetY !== 0) {
        existingPts = rawPts.map((p) => ({
          x: p.x + offsetX,
          y: p.y + offsetY,
        }));
        sections = elkEdge.sections.map((s) => ({
          ...s,
          startPoint: {
            x: s.startPoint.x + offsetX,
            y: s.startPoint.y + offsetY,
          },
          endPoint: {
            x: s.endPoint.x + offsetX,
            y: s.endPoint.y + offsetY,
          },
          bendPoints: s.bendPoints?.map((p) => ({
            x: p.x + offsetX,
            y: p.y + offsetY,
          })),
        }));
      } else {
        existingPts = rawPts;
      }
    }

    let filleted: SplineResult | undefined;
    let initialLabel: { labelX: number; labelY: number };
    if (existingPts && existingPts.length >= 2) {
      filleted = buildFilletedOrthogonalPath(existingPts);
      initialLabel = { labelX: filleted.labelX, labelY: filleted.labelY };
    } else {
      initialLabel = {
        labelX: (forwardSX + forwardTX) / 2,
        labelY: (forwardSY + forwardTY) / 2,
      };
    }

    const result: ForwardCoords = {
      forwardSX,
      forwardSY,
      forwardTX,
      forwardTY,
      existingPts,
      sections,
      filleted,
      initialLabel,
    };
    forwardCoordsByEdgeId.set(e.id, result);
    return result;
  };

  // Pre-pass: detect obstructed forward edges and group them by shared detour corridor
  const bypassCorridorGroups = new Map<
    string,
    Array<{
      edge: FlowEdge;
      coords: ForwardCoords;
      candidateObstacles: ObstacleRect[];
      initialBypass: NonNullable<
        ReturnType<typeof calculateObstructedForwardSpline>
      >;
    }>
  >();

  for (const e of validEdges) {
    const sourcePos = absolutePositions.get(e.source) ?? { x: 0, y: 0 };
    const targetPos = absolutePositions.get(e.target) ?? { x: 0, y: 0 };
    const isSelfLoop = e.source === e.target;
    const isBackEdge = detectBackEdge(
      sourcePos,
      targetPos,
      direction,
      isSelfLoop,
    );
    if (isSelfLoop || isBackEdge) continue;

    const coords = getForwardCoords(e);
    if (direction === "TB") {
      if (coords.forwardTY <= coords.forwardSY + 16) continue;
    } else {
      if (coords.forwardTX <= coords.forwardSX + 16) continue;
    }

    let candidateObstacles: ObstacleRect[];
    if (quadtree && spatialBounds) {
      // Phase 1: Narrow path + label AABB query (O(log V))
      const pts = coords.existingPts && coords.existingPts.length >= 2
        ? coords.existingPts
        : [
          { x: coords.forwardSX, y: coords.forwardSY },
          { x: coords.forwardTX, y: coords.forwardTY },
        ];
      let minPtX = coords.initialLabel.labelX;
      let maxPtX = coords.initialLabel.labelX;
      let minPtY = coords.initialLabel.labelY;
      let maxPtY = coords.initialLabel.labelY;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        if (p.x < minPtX) minPtX = p.x;
        if (p.x > maxPtX) maxPtX = p.x;
        if (p.y < minPtY) minPtY = p.y;
        if (p.y > maxPtY) maxPtY = p.y;
      }

      const padX = direction === "TB" ? 50 : 20;
      const padY = direction === "TB" ? 20 : 36;
      const narrowIds = quadtree.queryRange({
        minX: minPtX - padX,
        maxX: maxPtX + padX,
        minY: minPtY - padY,
        maxY: maxPtY + padY,
      });

      let hasInitialCandidate = false;
      for (const id of narrowIds) {
        if (id === e.source || id === e.target) continue;
        const entry = obstacleById.get(id);
        if (!entry) continue;
        const obs = entry.obs;
        if (direction === "TB") {
          if (
            obs.y >= coords.forwardSY - 4 &&
            obs.y + obs.height <= coords.forwardTY + 4
          ) {
            hasInitialCandidate = true;
            break;
          }
        } else {
          if (
            obs.x >= coords.forwardSX - 4 &&
            obs.x + obs.width <= coords.forwardTX + 4
          ) {
            hasInitialCandidate = true;
            break;
          }
        }
      }

      if (!hasInitialCandidate) {
        continue;
      }

      // Phase 2: Full span band query (only when Phase 1 hits a candidate)
      const bandBounds: AABB = direction === "TB"
        ? {
          minX: spatialBounds.minX - 10,
          maxX: spatialBounds.maxX + 10,
          minY: Math.min(coords.forwardSY, coords.forwardTY) - 4,
          maxY: Math.max(coords.forwardSY, coords.forwardTY) + 4,
        }
        : {
          minX: Math.min(coords.forwardSX, coords.forwardTX) - 4,
          maxX: Math.max(coords.forwardSX, coords.forwardTX) + 4,
          minY: spatialBounds.minY - 10,
          maxY: spatialBounds.maxY + 10,
        };
      const bandIds = quadtree.queryRange(bandBounds);
      const matchedEntries: Array<{ obs: ObstacleRect; order: number }> = [];
      for (const id of bandIds) {
        if (id === e.source || id === e.target) continue;
        const entry = obstacleById.get(id);
        if (entry) matchedEntries.push(entry);
      }
      matchedEntries.sort((a, b) => a.order - b.order);
      candidateObstacles = matchedEntries.map((m) => m.obs);
    } else {
      candidateObstacles = nodeObstacles.filter(
        (obs) => obs.id !== e.source && obs.id !== e.target,
      );
    }

    const initialBypass = calculateObstructedForwardSpline({
      sourceX: coords.forwardSX,
      sourceY: coords.forwardSY,
      targetX: coords.forwardTX,
      targetY: coords.forwardTY,
      direction,
      obstacles: candidateObstacles,
      existingPts: coords.existingPts,
      precomputedFilleted: coords.initialLabel,
    });
    if (initialBypass) {
      const obstacleKey = initialBypass.hitObstacles
        .map((o) => o.id)
        .sort()
        .join(",");
      const corridorKey =
        `${direction}_${initialBypass.detourSide}_${obstacleKey}`;
      const group = bypassCorridorGroups.get(corridorKey);
      const item = { edge: e, coords, candidateObstacles, initialBypass };
      if (group) {
        group.push(item);
      } else {
        bypassCorridorGroups.set(corridorKey, [item]);
      }
    }
  }

  const bypassByEdgeId = new Map<string, PrecomputedForwardBypass>();
  for (const group of bypassCorridorGroups.values()) {
    const detourLaneCount = group.length;
    group.forEach((item, detourLaneIndex) => {
      const finalBypass = detourLaneCount > 1
        ? (calculateObstructedForwardSpline({
          sourceX: item.coords.forwardSX,
          sourceY: item.coords.forwardSY,
          targetX: item.coords.forwardTX,
          targetY: item.coords.forwardTY,
          direction,
          obstacles: item.candidateObstacles,
          existingPts: item.coords.existingPts,
          precomputedFilleted: item.coords.initialLabel,
          laneIndex: detourLaneIndex,
          laneCount: detourLaneCount,
          preferredSide: item.initialBypass.detourSide,
        }) ?? item.initialBypass)
        : item.initialBypass;

      const hitIds = new Set(finalBypass.hitObstacles.map((o) => o.id));
      const spanObstacles = item.candidateObstacles.filter((obs) => {
        if (hitIds.has(obs.id)) return true;
        if (direction === "TB") {
          const minY = Math.min(item.coords.forwardSY, item.coords.forwardTY);
          const maxY = Math.max(item.coords.forwardSY, item.coords.forwardTY);
          return obs.y + obs.height >= minY && obs.y <= maxY;
        }
        const minX = Math.min(item.coords.forwardSX, item.coords.forwardTX);
        const maxX = Math.max(item.coords.forwardSX, item.coords.forwardTX);
        return obs.x + obs.width >= minX && obs.x <= maxX;
      });

      bypassByEdgeId.set(item.edge.id, {
        detourSide: finalBypass.detourSide,
        hitObstacles: finalBypass.hitObstacles,
        obstacles: spanObstacles,
        detourLaneIndex,
        detourLaneCount,
        path: finalBypass.path,
        labelPosition: { x: finalBypass.labelX, y: finalBypass.labelY },
        bendPoints: finalBypass.bendPoints,
        sections: item.coords.sections,
      });
    });
  }

  return validEdges.map((e) => {
    const sourcePos = absolutePositions.get(e.source) ?? { x: 0, y: 0 };
    const targetPos = absolutePositions.get(e.target) ?? { x: 0, y: 0 };
    const isSelfLoop = e.source === e.target;
    const isBackEdge = detectBackEdge(
      sourcePos,
      targetPos,
      direction,
      isSelfLoop,
    );

    let laneIndex = 0;
    if (isSelfLoop || isBackEdge) {
      const corridorKey = `${direction}_${e.target}`;
      laneIndex = corridorCounts.get(corridorKey) ?? 0;
      corridorCounts.set(corridorKey, laneIndex + 1);
    }

    const parallelMeta = parallelMetaByEdgeId.get(e.id);
    const parallelIndex = parallelMeta?.parallelIndex;
    const parallelCount = parallelMeta?.parallelCount;

    const sourceNode = nodeById.get(e.source);
    const targetNode = nodeById.get(e.target);

    const sourceIsDecision = sourceNode?.data?.nodeType === "DECISION";
    const targetIsDecision = targetNode?.data?.nodeType === "DECISION";

    const sourceWidth = sourceNode?.width ?? NODE_WIDTH;
    const targetWidth = targetNode?.width ?? NODE_WIDTH;
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
    let detourSide: "left" | "right" | "top" | "bottom" | undefined;
    let detourLaneIndex: number | undefined;
    let detourLaneCount: number | undefined;
    let obstacles: ObstacleRect[] | undefined;

    const precomputedBypass = bypassByEdgeId.get(e.id);
    const coords = !isSelfLoop && !isBackEdge ? getForwardCoords(e) : undefined;

    if (precomputedBypass) {
      svgPath = precomputedBypass.path;
      labelPosition = precomputedBypass.labelPosition;
      bendPoints = precomputedBypass.bendPoints;
      sections = precomputedBypass.sections;
      detourSide = precomputedBypass.detourSide;
      detourLaneIndex = precomputedBypass.detourLaneIndex;
      detourLaneCount = precomputedBypass.detourLaneCount;
      obstacles = precomputedBypass.obstacles;
    } else if (
      coords &&
      parallelCount !== undefined &&
      parallelCount > 1 &&
      parallelIndex !== undefined
    ) {
      const { forwardSX, forwardSY, forwardTX, forwardTY } = coords;

      const forwardRes = calculateParallelForwardSpline({
        sourceX: forwardSX,
        sourceY: forwardSY,
        targetX: forwardTX,
        targetY: forwardTY,
        direction,
        parallelIndex,
        parallelCount,
      });
      svgPath = forwardRes.path;
      labelPosition = { x: forwardRes.labelX, y: forwardRes.labelY };
      bendPoints = [
        { x: forwardSX, y: forwardSY },
        { x: forwardTX, y: forwardTY },
      ];
      sections = coords.sections;
    } else if (coords?.existingPts) {
      sections = coords.sections;
      bendPoints = coords.existingPts;
      const filleted = coords.filleted ??
        buildFilletedOrthogonalPath(coords.existingPts);
      svgPath = filleted.path;
      labelPosition = { x: filleted.labelX, y: filleted.labelY };
    } else if (isSelfLoop) {
      const sX = direction === "TB"
        ? sourcePos.x + (sourceIsDecision ? 190 : sourceWidth)
        : sourcePos.x + sourceWidth / 2;
      const sY = direction === "TB"
        ? sourcePos.y + sourceHeight / 2
        : sourcePos.y + (sourceIsDecision ? sourceHeight - 8 : sourceHeight);
      const tX = direction === "TB"
        ? targetPos.x + targetWidth / 2
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
      const elkEdge = elkEdgeMap?.get(e.id);
      if (elkEdge?.sections && elkEdge.sections.length > 0) {
        const s = elkEdge.sections[0]!;
        bendPoints = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
        sections = elkEdge.sections;
      }
      const sX = direction === "TB"
        ? sourcePos.x + (sourceIsDecision ? 190 : sourceWidth)
        : sourcePos.x + sourceWidth / 2;
      const sY = direction === "TB"
        ? sourcePos.y + sourceHeight / 2
        : sourcePos.y + (sourceIsDecision ? sourceHeight - 8 : sourceHeight);
      const tX = direction === "TB"
        ? targetPos.x + (targetIsDecision ? 190 : targetWidth)
        : targetPos.x + targetWidth / 2;
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
        parallelIndex,
        parallelCount,
        detourSide,
        detourLaneIndex,
        detourLaneCount,
        obstacles,
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
        layoutOptions: loopNodeIds.has(e.target)
          ? {
            "org.eclipse.elk.layered.priority.direction": "0",
            "org.eclipse.elk.layered.priority.shortness": "5",
          }
          : {
            "org.eclipse.elk.layered.priority.direction": "10",
          },
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
