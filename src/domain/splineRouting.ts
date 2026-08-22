import type { LayoutDirection } from "./canvas.ts";
import { Position } from "@xyflow/react";

export interface BackEdgeSplineParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: Position;
  targetPosition?: Position;
  direction?: LayoutDirection;
  laneIndex?: number;
  isLeft?: boolean;
}

export interface SelfLoopArcParams {
  sourceX: number;
  sourceY: number;
  targetX?: number;
  targetY?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  direction?: LayoutDirection;
  laneIndex?: number;
}

export interface SplineResult {
  path: string;
  labelX: number;
  labelY: number;
}

/**
 * Direction-aware geometric reverse flow detection.
 * In TB layout: target is above source (or to the left on the same horizontal rank).
 * In LR layout: target is to the left of source (or above on the same vertical column).
 */
export function detectBackEdge(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number },
  direction: LayoutDirection = "TB",
  isSelfLoop?: boolean,
): boolean {
  if (isSelfLoop) return true;
  const TOLERANCE = 15;
  if (direction === "TB") {
    if (targetPos.y < sourcePos.y - TOLERANCE) return true;
    if (Math.abs(targetPos.y - sourcePos.y) <= TOLERANCE) {
      return targetPos.x < sourcePos.x;
    }
    return false;
  } else {
    if (targetPos.x < sourcePos.x - TOLERANCE) return true;
    if (Math.abs(targetPos.x - sourcePos.x) <= TOLERANCE) {
      return targetPos.y < sourcePos.y;
    }
    return false;
  }
}

/**
 * Calculates a smooth C-curve cubic bezier spline for cyclic jump statements
 * and back-edges, routing them along the lateral clearance channels with lane offsets.
 */
export function calculateBackEdgeSpline(
  params: BackEdgeSplineParams,
): SplineResult {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition = Position.Right,
    targetPosition = Position.Right,
    direction = "TB",
    laneIndex = 0,
    isLeft = false,
  } = params;

  const k = Math.max(0, laneIndex);

  if (direction === "TB") {
    const deltaY = Math.abs(sourceY - targetY);
    const baseOffset = Math.max(
      60,
      Math.min(240, deltaY * 0.35 + 50 + k * 18),
    );

    // Determine lateral routing side (left vs right channel)
    const routeLeft = isLeft ||
      sourcePosition === Position.Left ||
      targetPosition === Position.Left;
    const channelX = routeLeft
      ? Math.min(sourceX, targetX) - baseOffset
      : Math.max(sourceX, targetX) + baseOffset;

    const cp1X = channelX;
    const cp1Y = sourceY;
    const cp2X = channelX;
    const cp2Y = targetY;

    const path =
      `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;

    // Adaptive label positioning along cubic bezier B(t)
    // For long back-edges, place label near source for instant contextual readability
    const t = deltaY > 250 ? 0.22 : 0.5;
    const mt = 1 - t;
    const labelX = mt * mt * mt * sourceX +
      3 * mt * mt * t * cp1X +
      3 * mt * t * t * cp2X +
      t * t * t * targetX;
    const labelY = mt * mt * mt * sourceY +
      3 * mt * mt * t * cp1Y +
      3 * mt * t * t * cp2Y +
      t * t * t * targetY;

    return { path, labelX, labelY };
  } else {
    // LR direction: routing via top or bottom clearance gutters
    const deltaX = Math.abs(sourceX - targetX);
    const baseOffset = Math.max(
      60,
      Math.min(240, deltaX * 0.35 + 50 + k * 18),
    );

    const routeTop = isLeft ||
      sourcePosition === Position.Top ||
      targetPosition === Position.Top;
    const channelY = routeTop
      ? Math.min(sourceY, targetY) - baseOffset
      : Math.max(sourceY, targetY) + baseOffset;

    const cp1X = sourceX;
    const cp1Y = channelY;
    const cp2X = targetX;
    const cp2Y = channelY;

    const path =
      `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;

    const t = deltaX > 250 ? 0.22 : 0.5;
    const mt = 1 - t;
    const labelX = mt * mt * mt * sourceX +
      3 * mt * mt * t * cp1X +
      3 * mt * t * t * cp2X +
      t * t * t * targetX;
    const labelY = mt * mt * mt * sourceY +
      3 * mt * mt * t * cp1Y +
      3 * mt * t * t * cp2Y +
      t * t * t * targetY;

    return { path, labelX, labelY };
  }
}

/**
 * Calculates a clean horseshoe arc spline for self-loop edges (source === target).
 */
export function calculateSelfLoopArc(params: SelfLoopArcParams): SplineResult {
  const {
    sourceX,
    sourceY,
    targetX = sourceX,
    targetY = sourceY,
    direction = "TB",
    laneIndex = 0,
  } = params;

  const k = Math.max(0, laneIndex);
  const loopRadius = 45 + k * 16;

  if (direction === "TB") {
    const cp1X = sourceX + loopRadius;
    const cp1Y = sourceY + 30;
    const cp2X = targetX + loopRadius;
    const cp2Y = targetY - 40;

    const path =
      `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;
    const labelX = sourceX + loopRadius + 12;
    const labelY = (sourceY + targetY) / 2;

    return { path, labelX, labelY };
  } else {
    const cp1X = sourceX + 30;
    const cp1Y = sourceY + loopRadius;
    const cp2X = targetX - 40;
    const cp2Y = targetY + loopRadius;

    const path =
      `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;
    const labelX = (sourceX + targetX) / 2;
    const labelY = sourceY + loopRadius + 12;

    return { path, labelX, labelY };
  }
}

/**
 * Builds an SVG path with smooth quadratic rounded fillets at each 90-degree corner
 * from an ordered sequence of orthogonal waypoints (e.g. from ELK or Dagre).
 */
export function buildFilletedOrthogonalPath(
  points: Array<{ x: number; y: number }>,
  cornerRadius = 10,
): SplineResult {
  if (!points || points.length === 0) {
    return { path: "", labelX: 0, labelY: 0 };
  }
  if (points.length === 1) {
    const p = points[0]!;
    return { path: `M ${p.x} ${p.y}`, labelX: p.x, labelY: p.y };
  }
  if (points.length === 2) {
    const p0 = points[0]!;
    const p1 = points[1]!;
    return {
      path: `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`,
      labelX: (p0.x + p1.x) / 2,
      labelY: (p0.y + p1.y) / 2,
    };
  }

  // Deduplicate consecutive identical points
  const cleanPts: Array<{ x: number; y: number }> = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = cleanPts[cleanPts.length - 1]!;
    const curr = points[i]!;
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > 0.5) {
      cleanPts.push(curr);
    }
  }

  if (cleanPts.length <= 2) {
    const p0 = cleanPts[0]!;
    const p1 = cleanPts[cleanPts.length - 1]!;
    return {
      path: `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`,
      labelX: (p0.x + p1.x) / 2,
      labelY: (p0.y + p1.y) / 2,
    };
  }

  let d = `M ${cleanPts[0]!.x} ${cleanPts[0]!.y}`;

  for (let i = 1; i < cleanPts.length - 1; i++) {
    const prev = cleanPts[i - 1]!;
    const curr = cleanPts[i]!;
    const next = cleanPts[i + 1]!;

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const len1 = Math.hypot(v1x, v1y);

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y);

    if (len1 === 0 || len2 === 0) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const u1x = v1x / len1;
    const u1y = v1y / len1;
    const u2x = v2x / len2;
    const u2y = v2y / len2;

    const dot = u1x * u2x + u1y * u2y;
    if (Math.abs(dot) > 0.999) {
      // Collinear segment - avoid redundant quadratic curves
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const r = Math.min(cornerRadius, len1 / 2, len2 / 2);

    const startFilletX = curr.x - u1x * r;
    const startFilletY = curr.y - u1y * r;
    const endFilletX = curr.x + u2x * r;
    const endFilletY = curr.y + u2y * r;

    d += ` L ${startFilletX} ${startFilletY}`;
    d += ` Q ${curr.x} ${curr.y} ${endFilletX} ${endFilletY}`;
  }

  const last = cleanPts[cleanPts.length - 1]!;
  d += ` L ${last.x} ${last.y}`;

  // Find longest straight segment for optimal label midpoint placement
  let maxSegmentLength = -1;
  let labelX = (cleanPts[0]!.x + last.x) / 2;
  let labelY = (cleanPts[0]!.y + last.y) / 2;

  for (let i = 0; i < cleanPts.length - 1; i++) {
    const p1 = cleanPts[i]!;
    const p2 = cleanPts[i + 1]!;
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (segLen > maxSegmentLength) {
      maxSegmentLength = segLen;
      labelX = (p1.x + p2.x) / 2;
      labelY = (p1.y + p2.y) / 2;
    }
  }

  return { path: d, labelX, labelY };
}
