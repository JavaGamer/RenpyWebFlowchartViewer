import {
  buildFilletedOrthogonalPath,
  calculateBackEdgeSpline,
  calculateObstructedForwardSpline,
  calculateParallelForwardSpline,
  calculateSelfLoopArc,
  type CanvasEdge,
  type CanvasNode,
  detectBackEdge,
  type FlowEdge,
  NODE_WIDTH,
  type ObstacleRect,
  type SplineResult,
} from "../../domain/index.ts";
import type { AABB, SpatialQuadtree } from "../spatialIndex.ts";
import type { ElkEdge, ElkEdgeSection } from "./types.ts";
import { pointToRectBoundaryDist } from "./nodeFormatting.ts";

export function buildCanvasEdges(
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

  const effectiveSpatialBounds = spatialBounds ?? (() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const pos = absolutePositions.get(node.id) ?? node.position;
      const w = node.width ?? NODE_WIDTH;
      const h = node.height ?? 80;
      if (pos.x < minX) minX = pos.x;
      if (pos.x + w > maxX) maxX = pos.x + w;
      if (pos.y < minY) minY = pos.y;
      if (pos.y + h > maxY) maxY = pos.y + h;
    }
    return {
      minX: Number.isFinite(minX) ? minX : 0,
      maxX: Number.isFinite(maxX) ? maxX : 800,
      minY: Number.isFinite(minY) ? minY : 0,
      maxY: Number.isFinite(maxY) ? maxY : 800,
    };
  })();

  const chapterBoundsByParentId = new Map<string, AABB>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.parentId) {
      const pos = absolutePositions.get(node.id) ?? node.position;
      const w = node.width ?? NODE_WIDTH;
      const h = node.height ?? 80;
      const current = chapterBoundsByParentId.get(node.parentId);
      if (!current) {
        chapterBoundsByParentId.set(node.parentId, {
          minX: pos.x,
          maxX: pos.x + w,
          minY: pos.y,
          maxY: pos.y + h,
        });
      } else {
        if (pos.x < current.minX) current.minX = pos.x;
        if (pos.x + w > current.maxX) current.maxX = pos.x + w;
        if (pos.y < current.minY) current.minY = pos.y;
        if (pos.y + h > current.maxY) current.maxY = pos.y + h;
      }
    }
  }

  // Identify long forward skips that jump multiple tiers without Elk bend points or obstacle bypasses
  const longSkipCorridorCounts = new Map<string, number>();
  const longSkipByEdgeId = new Map<string, { laneIndex: number }>();
  for (let i = 0; i < validEdges.length; i++) {
    const e = validEdges[i]!;
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
    if (coords.existingPts && coords.existingPts.length > 2) continue;

    const isLongDistance = direction === "TB"
      ? (targetPos.y - sourcePos.y > 380)
      : (targetPos.x - sourcePos.x > 400);

    if (isLongDistance) {
      const lane = longSkipCorridorCounts.get(e.target) ?? 0;
      longSkipCorridorCounts.set(e.target, lane + 1);
      longSkipByEdgeId.set(e.id, { laneIndex: lane });
    }
  }

  // Pre-pass: Detect and compute Orthogonal Bus Reconvergence for multi-inflow target nodes
  const forwardEdgesByTarget = new Map<string, FlowEdge[]>();
  for (let i = 0; i < validEdges.length; i++) {
    const e = validEdges[i]!;
    const sourceNode = nodeById.get(e.source);
    const targetNode = nodeById.get(e.target);
    // Bus manifold must stay strictly within the same chapter container
    if (sourceNode?.parentId !== targetNode?.parentId) continue;

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
    if (bypassByEdgeId.has(e.id) || longSkipByEdgeId.has(e.id)) continue;
    const coords = getForwardCoords(e);
    if (coords.existingPts && coords.existingPts.length > 2) continue;

    // Ensure forward gap is at least 56px so Y_bus or X_bus is at least 28px in front of the source exit
    const forwardClearance = direction === "TB"
      ? coords.forwardTY - coords.forwardSY
      : coords.forwardTX - coords.forwardSX;
    if (forwardClearance < 56) continue;

    const list = forwardEdgesByTarget.get(e.target);
    if (list) {
      list.push(e);
    } else {
      forwardEdgesByTarget.set(e.target, [e]);
    }
  }

  interface BusRouteData {
    path: string;
    labelPosition: { x: number; y: number };
    bendPoints: Array<{ x: number; y: number }>;
  }
  const busRouteByEdgeId = new Map<string, BusRouteData>();

  for (const edgesToTarget of forwardEdgesByTarget.values()) {
    if (edgesToTarget.length < 2) continue;

    // Sort edges by source coordinate to ensure orderly slot distribution
    const sortedEdges = [...edgesToTarget].sort((a, b) => {
      const aPos = absolutePositions.get(a.source) ?? { x: 0, y: 0 };
      const bPos = absolutePositions.get(b.source) ?? { x: 0, y: 0 };
      return direction === "TB" ? aPos.x - bPos.x : aPos.y - bPos.y;
    });

    const targetNode = nodeById.get(edgesToTarget[0]!.target);
    const targetIsDecision = targetNode?.data?.type === "DECISION";
    const targetWidth = targetNode?.width ?? NODE_WIDTH;
    const targetHeight = targetNode?.height ?? 80;
    const maxAllowedOffset = direction === "TB"
      ? (targetIsDecision ? 0 : Math.max(0, targetWidth / 2 - 20))
      : (targetIsDecision ? 0 : Math.max(0, targetHeight / 2 - 16));

    const busCount = sortedEdges.length;
    for (let busIndex = 0; busIndex < busCount; busIndex++) {
      const edge = sortedEdges[busIndex]!;
      const coords = getForwardCoords(edge);
      const rawOffset = (busIndex - (busCount - 1) / 2) * 12;
      const slotOffset = Math.max(
        -maxAllowedOffset,
        Math.min(maxAllowedOffset, rawOffset),
      );

      let pts: Array<{ x: number; y: number }>;
      let yBus: number | undefined;
      let xBus: number | undefined;

      if (direction === "TB") {
        yBus = coords.forwardTY - 28;
        const tXSlot = coords.forwardTX + slotOffset;
        if (Math.abs(coords.forwardSX - tXSlot) < 2) {
          pts = [
            { x: coords.forwardSX, y: coords.forwardSY },
            { x: tXSlot, y: coords.forwardTY },
          ];
        } else {
          pts = [
            { x: coords.forwardSX, y: coords.forwardSY },
            { x: coords.forwardSX, y: yBus },
            { x: tXSlot, y: yBus },
            { x: tXSlot, y: coords.forwardTY },
          ];
        }
      } else {
        xBus = coords.forwardTX - 28;
        const tYSlot = coords.forwardTY + slotOffset;
        if (Math.abs(coords.forwardSY - tYSlot) < 2) {
          pts = [
            { x: coords.forwardSX, y: coords.forwardSY },
            { x: coords.forwardTX, y: tYSlot },
          ];
        } else {
          pts = [
            { x: coords.forwardSX, y: coords.forwardSY },
            { x: xBus, y: coords.forwardSY },
            { x: xBus, y: tYSlot },
            { x: coords.forwardTX, y: tYSlot },
          ];
        }
      }

      const filleted = buildFilletedOrthogonalPath(pts, 10);
      const labelStagger = (busIndex - (busCount - 1) / 2) * 22;
      let labelX = filleted.labelX;
      let labelY = filleted.labelY;

      if (direction === "TB") {
        if (yBus !== undefined && Math.abs(labelY - yBus) < 14) {
          labelX += labelStagger;
        } else {
          labelY += labelStagger;
        }
      } else {
        if (xBus !== undefined && Math.abs(labelX - xBus) < 14) {
          labelY += labelStagger;
        } else {
          labelX += labelStagger;
        }
      }

      busRouteByEdgeId.set(edge.id, {
        path: filleted.path,
        labelPosition: { x: labelX, y: labelY },
        bendPoints: pts,
      });
    }
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
    const longSkipMeta = longSkipByEdgeId.get(e.id);
    const isLongSkip = Boolean(longSkipMeta);

    let laneIndex = 0;
    if (isSelfLoop || isBackEdge) {
      const corridorKey = `${direction}_${e.target}`;
      laneIndex = corridorCounts.get(corridorKey) ?? 0;
      corridorCounts.set(corridorKey, laneIndex + 1);
    } else if (isLongSkip) {
      laneIndex = longSkipMeta!.laneIndex;
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

    // Determine handle IDs and lateral gutter clearance channels
    let sourceHandle: string | undefined;
    let targetHandle: string | undefined;
    let isLeft: boolean | undefined;
    let outerGutterCoord: number | undefined;

    const isIntraChapter = Boolean(
      sourceNode?.parentId && sourceNode.parentId === targetNode?.parentId,
    );
    const localBounds = isIntraChapter
      ? (chapterBoundsByParentId.get(sourceNode!.parentId!) ??
        effectiveSpatialBounds)
      : effectiveSpatialBounds;

    if (isSelfLoop) {
      sourceHandle = direction === "TB" ? "source-right" : "source-bottom";
      targetHandle = direction === "TB" ? "target-top" : "target-left";
    } else if (isBackEdge) {
      if (direction === "TB") {
        sourceHandle = "source-left";
        targetHandle = "target-left";
        isLeft = true;
        outerGutterCoord = localBounds.minX - 50;
      } else {
        sourceHandle = "source-top";
        targetHandle = "target-top";
        isLeft = true;
        outerGutterCoord = localBounds.minY - 50;
      }
    } else if (isLongSkip) {
      if (direction === "TB") {
        sourceHandle = "source-right";
        targetHandle = "target-right";
        isLeft = false;
        outerGutterCoord = localBounds.maxX + 50;
      } else {
        sourceHandle = "source-bottom";
        targetHandle = "target-bottom";
        isLeft = false;
        outerGutterCoord = localBounds.maxY + 50;
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
    const busRoute = busRouteByEdgeId.get(e.id);
    const coords = !isSelfLoop && !isBackEdge ? getForwardCoords(e) : undefined;

    if (isLongSkip) {
      detourSide = isLeft ? "left" : "right";
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

      const skipRes = calculateBackEdgeSpline({
        sourceX: sX,
        sourceY: sY,
        targetX: tX,
        targetY: tY,
        direction,
        laneIndex,
        isLeft: false,
        outerGutterCoord,
      });
      svgPath = skipRes.path;
      labelPosition = { x: skipRes.labelX, y: skipRes.labelY };
      const laneOffset = laneIndex * 18;
      if (direction === "TB") {
        const clearanceX = (outerGutterCoord ?? sX) + laneOffset;
        bendPoints = [
          { x: sX, y: sY },
          { x: clearanceX, y: sY },
          { x: clearanceX, y: tY },
          { x: tX, y: tY },
        ];
      } else {
        const clearanceY = (outerGutterCoord ?? sY) + laneOffset;
        bendPoints = [
          { x: sX, y: sY },
          { x: sX, y: clearanceY },
          { x: tX, y: clearanceY },
          { x: tX, y: tY },
        ];
      }
    } else if (precomputedBypass) {
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
    } else if (busRoute) {
      svgPath = busRoute.path;
      labelPosition = busRoute.labelPosition;
      bendPoints = busRoute.bendPoints;
      sections = coords?.sections;
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
        ? sourcePos.x + (sourceIsDecision ? 30 : 0)
        : sourcePos.x + sourceWidth / 2;
      const sY = direction === "TB"
        ? sourcePos.y + sourceHeight / 2
        : sourcePos.y + (sourceIsDecision ? 8 : 0);
      const tX = direction === "TB"
        ? targetPos.x + (targetIsDecision ? 30 : 0)
        : targetPos.x + targetWidth / 2;
      const tY = direction === "TB"
        ? targetPos.y + targetHeight / 2
        : targetPos.y + (targetIsDecision ? 8 : 0);

      const splineRes = calculateBackEdgeSpline({
        sourceX: sX,
        sourceY: sY,
        targetX: tX,
        targetY: tY,
        direction,
        laneIndex,
        isLeft: true,
        outerGutterCoord,
      });
      svgPath = splineRes.path;
      labelPosition = { x: splineRes.labelX, y: splineRes.labelY };
      if (!bendPoints) {
        const laneOffset = laneIndex * 18;
        if (direction === "TB") {
          const clearanceX = (outerGutterCoord ?? sX) - laneOffset;
          bendPoints = [
            { x: sX, y: sY },
            { x: clearanceX, y: sY },
            { x: clearanceX, y: tY },
            { x: tX, y: tY },
          ];
        } else {
          const clearanceY = (outerGutterCoord ?? sY) - laneOffset;
          bendPoints = [
            { x: sX, y: sY },
            { x: sX, y: clearanceY },
            { x: tX, y: clearanceY },
            { x: tX, y: tY },
          ];
        }
      }
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
        isLongSkip,
        isFallthrough: e.isFallthrough ?? (e.kind === "fallthrough"),
        isLeft,
        outerGutterCoord,
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
