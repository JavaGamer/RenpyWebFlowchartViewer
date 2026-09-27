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

export interface ParallelForwardSplineParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: Position;
  targetPosition?: Position;
  direction?: LayoutDirection;
  parallelIndex?: number;
  parallelCount?: number;
}

/**
 * Calculates smooth divergent cubic bezier curves for parallel forward edges
 * connecting the exact same source and target nodes.
 *
 * Staggers lateral control point offsets and longitudinal label t-parameters
 * so multiple edges and their text labels never overlap.
 */
export function calculateParallelForwardSpline(
  params: ParallelForwardSplineParams,
): SplineResult {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    direction = "TB",
    parallelIndex = 0,
    parallelCount = 1,
  } = params;

  if (parallelCount <= 1) {
    const midX = (sourceX + targetX) / 2;
    const midY = (sourceY + targetY) / 2;
    if (direction === "TB") {
      const cp1X = sourceX;
      const cp1Y = sourceY + (targetY - sourceY) * 0.5;
      const cp2X = targetX;
      const cp2Y = sourceY + (targetY - sourceY) * 0.5;
      return {
        path:
          `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`,
        labelX: midX,
        labelY: midY,
      };
    } else {
      const cp1X = sourceX + (targetX - sourceX) * 0.5;
      const cp1Y = sourceY;
      const cp2X = sourceX + (targetX - sourceX) * 0.5;
      const cp2Y = targetY;
      return {
        path:
          `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`,
        labelX: midX,
        labelY: midY,
      };
    }
  }

  // Centered index around 0 (e.g. for count=2: -0.5, +0.5; for count=3: -1, 0, +1)
  const centeredIndex = parallelIndex - (parallelCount - 1) / 2;
  const bowSpacing = 90;
  const bowOffset = centeredIndex * bowSpacing;

  // Longitudinal label staggering: shift t away from 0.5 along the curve
  const t = Math.max(0.2, Math.min(0.8, 0.5 + centeredIndex * 0.22));
  const mt = 1 - t;

  if (direction === "TB") {
    const deltaY = targetY - sourceY;
    const cp1X = sourceX + bowOffset;
    const cp1Y = sourceY + deltaY * 0.35;
    const cp2X = targetX + bowOffset;
    const cp2Y = sourceY + deltaY * 0.65;

    const path =
      `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;

    // Cubic bezier evaluation at parameter t
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
    // "LR" direction
    const deltaX = targetX - sourceX;
    const cp1X = sourceX + deltaX * 0.35;
    const cp1Y = sourceY + bowOffset;
    const cp2X = sourceX + deltaX * 0.65;
    const cp2Y = targetY + bowOffset;

    const path =
      `M ${sourceX} ${sourceY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;

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

export interface ObstacleRect {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObstructedForwardSplineParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  direction?: LayoutDirection;
  obstacles: ObstacleRect[];
  existingPts?: Array<{ x: number; y: number }>;
  laneIndex?: number;
  laneCount?: number;
  preferredSide?: "left" | "right" | "top" | "bottom";
}

export interface ObstructedForwardSplineResult extends SplineResult {
  bendPoints: Array<{ x: number; y: number }>;
  hitObstacles: ObstacleRect[];
  detourSide: "left" | "right" | "top" | "bottom";
}

function segmentIntersectsRect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  left: number,
  right: number,
  top: number,
  bottom: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const checks: Array<[number, number]> = [
    [-dx, p1.x - left],
    [dx, right - p1.x],
    [-dy, p1.y - top],
    [dy, bottom - p1.y],
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }

  return t0 <= t1;
}

function computeDetourLabelT(laneIndex: number, laneCount: number): number {
  const k = Math.max(0, laneIndex);
  if (laneCount > 1) {
    const centered = k - (laneCount - 1) / 2;
    return Math.max(0.22, Math.min(0.78, 0.5 + centered * 0.22));
  }
  if (k > 0) {
    const step = Math.ceil(k / 2) * 0.16 * (k % 2 === 1 ? 1 : -1);
    return Math.max(0.22, Math.min(0.78, 0.5 + step));
  }
  return 0.5;
}

/**
 * Detects if a multi-rank forward edge is obstructed by one or more intermediate
 * nodes and computes a filleted orthogonal bypass path and clear label position
 * around the obstructing node(s). Returns null if the edge is unobstructed.
 */
export function calculateObstructedForwardSpline(
  params: ObstructedForwardSplineParams,
): ObstructedForwardSplineResult | null {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    direction = "TB",
    obstacles,
    existingPts,
    laneIndex = 0,
    laneCount = 1,
    preferredSide,
  } = params;

  if (!obstacles || obstacles.length === 0) {
    return null;
  }

  const pts = existingPts && existingPts.length >= 2 ? existingPts : [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ];

  const currentFilleted = buildFilletedOrthogonalPath(pts);
  const clearance = 44;
  const k = Math.max(0, laneIndex);
  const laneStep = 28;
  const effectiveClearance = clearance + k * laneStep;
  const laneLeadShift = laneCount > 1 ? ((laneCount - 1) / 2 - k) * 6 : 0;
  const labelT = computeDetourLabelT(k, laneCount);

  if (direction === "TB") {
    if (targetY <= sourceY + 16) return null;

    const intermediateObstacles = obstacles.filter(
      (obs) => obs.y >= sourceY - 4 && obs.y + obs.height <= targetY + 4,
    );
    if (intermediateObstacles.length === 0) return null;

    const padX = 28;
    const padY = 8;

    const initialHitObstacles = intermediateObstacles.filter((obs) => {
      const left = obs.x - padX;
      const right = obs.x + obs.width + padX;
      const top = obs.y - padY;
      const bottom = obs.y + obs.height + padY;

      for (let i = 0; i < pts.length - 1; i++) {
        if (
          segmentIntersectsRect(pts[i]!, pts[i + 1]!, left, right, top, bottom)
        ) {
          return true;
        }
      }

      if (
        currentFilleted.labelX >= obs.x - 40 &&
        currentFilleted.labelX <= obs.x + obs.width + 40 &&
        currentFilleted.labelY >= obs.y - 16 &&
        currentFilleted.labelY <= obs.y + obs.height + 16
      ) {
        return true;
      }

      return false;
    });

    if (initialHitObstacles.length === 0) return null;

    const baseMinObsY = Math.min(...initialHitObstacles.map((o) => o.y));
    const baseMaxObsBottom = Math.max(
      ...initialHitObstacles.map((o) => o.y + o.height),
    );
    const minObsX = Math.min(...initialHitObstacles.map((o) => o.x));
    const maxObsX = Math.max(...initialHitObstacles.map((o) => o.x + o.width));

    let leftMinObsY = baseMinObsY;
    let leftMaxObsBottom = baseMaxObsBottom;
    const leftHitObstacles = [...initialHitObstacles];
    const leftHitSet = new Set(initialHitObstacles);

    let leftDetourX = minObsX - effectiveClearance;
    let leftChanged = true;
    while (leftChanged) {
      leftChanged = false;
      for (const obs of intermediateObstacles) {
        if (
          leftDetourX > obs.x - effectiveClearance &&
          leftDetourX <= obs.x + obs.width + padX
        ) {
          leftDetourX = obs.x - effectiveClearance;
          leftMinObsY = Math.min(leftMinObsY, obs.y);
          leftMaxObsBottom = Math.max(leftMaxObsBottom, obs.y + obs.height);
          if (!leftHitSet.has(obs)) {
            leftHitSet.add(obs);
            leftHitObstacles.push(obs);
          }
          leftChanged = true;
        }
      }
    }

    let rightMinObsY = baseMinObsY;
    let rightMaxObsBottom = baseMaxObsBottom;
    const rightHitObstacles = [...initialHitObstacles];
    const rightHitSet = new Set(initialHitObstacles);

    let rightDetourX = maxObsX + effectiveClearance;
    let rightChanged = true;
    while (rightChanged) {
      rightChanged = false;
      for (const obs of intermediateObstacles) {
        if (
          rightDetourX >= obs.x - padX &&
          rightDetourX < obs.x + obs.width + effectiveClearance
        ) {
          rightDetourX = obs.x + obs.width + effectiveClearance;
          rightMinObsY = Math.min(rightMinObsY, obs.y);
          rightMaxObsBottom = Math.max(rightMaxObsBottom, obs.y + obs.height);
          if (!rightHitSet.has(obs)) {
            rightHitSet.add(obs);
            rightHitObstacles.push(obs);
          }
          rightChanged = true;
        }
      }
    }

    const leftCost = Math.abs(sourceX - leftDetourX) +
      Math.abs(targetX - leftDetourX);
    const rightCost = Math.abs(sourceX - rightDetourX) +
      Math.abs(targetX - rightDetourX);
    const routeLeft = preferredSide === "left"
      ? true
      : preferredSide === "right"
      ? false
      : leftCost < rightCost - 1;
    const detourSide = routeLeft ? "left" : "right";
    const detourX = routeLeft ? leftDetourX : rightDetourX;
    const minObsY = routeLeft ? leftMinObsY : rightMinObsY;
    const maxObsBottom = routeLeft ? leftMaxObsBottom : rightMaxObsBottom;
    const hitObstacles = routeLeft ? leftHitObstacles : rightHitObstacles;

    let leadOutY = Math.max(
      sourceY + 14,
      Math.min(minObsY - 14, (sourceY + minObsY) / 2 + laneLeadShift),
    );
    let leadInY = Math.min(
      targetY - 14,
      Math.max(maxObsBottom + 14, (maxObsBottom + targetY) / 2 - laneLeadShift),
    );
    if (leadOutY >= leadInY) {
      leadOutY = sourceY + (targetY - sourceY) * 0.2;
      leadInY = sourceY + (targetY - sourceY) * 0.8;
    }

    const bendPoints = [
      { x: sourceX, y: sourceY },
      { x: sourceX, y: leadOutY },
      { x: detourX, y: leadOutY },
      { x: detourX, y: leadInY },
      { x: targetX, y: leadInY },
      { x: targetX, y: targetY },
    ];
    const filleted = buildFilletedOrthogonalPath(bendPoints, 10);

    return {
      path: filleted.path,
      labelX: detourX,
      labelY: leadOutY + (leadInY - leadOutY) * labelT,
      bendPoints,
      hitObstacles,
      detourSide,
    };
  } else {
    if (targetX <= sourceX + 16) return null;

    const intermediateObstacles = obstacles.filter(
      (obs) => obs.x >= sourceX - 4 && obs.x + obs.width <= targetX + 4,
    );
    if (intermediateObstacles.length === 0) return null;

    const padX = 8;
    const padY = 28;

    const initialHitObstacles = intermediateObstacles.filter((obs) => {
      const left = obs.x - padX;
      const right = obs.x + obs.width + padX;
      const top = obs.y - padY;
      const bottom = obs.y + obs.height + padY;

      for (let i = 0; i < pts.length - 1; i++) {
        if (
          segmentIntersectsRect(pts[i]!, pts[i + 1]!, left, right, top, bottom)
        ) {
          return true;
        }
      }

      if (
        currentFilleted.labelX >= obs.x - 16 &&
        currentFilleted.labelX <= obs.x + obs.width + 16 &&
        currentFilleted.labelY >= obs.y - 24 &&
        currentFilleted.labelY <= obs.y + obs.height + 24
      ) {
        return true;
      }

      return false;
    });

    if (initialHitObstacles.length === 0) return null;

    const baseMinObsX = Math.min(...initialHitObstacles.map((o) => o.x));
    const baseMaxObsRight = Math.max(
      ...initialHitObstacles.map((o) => o.x + o.width),
    );
    const minObsY = Math.min(...initialHitObstacles.map((o) => o.y));
    const maxObsY = Math.max(...initialHitObstacles.map((o) => o.y + o.height));

    let topMinObsX = baseMinObsX;
    let topMaxObsRight = baseMaxObsRight;
    const topHitObstacles = [...initialHitObstacles];
    const topHitSet = new Set(initialHitObstacles);

    let topDetourY = minObsY - effectiveClearance;
    let topChanged = true;
    while (topChanged) {
      topChanged = false;
      for (const obs of intermediateObstacles) {
        if (
          topDetourY > obs.y - effectiveClearance &&
          topDetourY <= obs.y + obs.height + padY
        ) {
          topDetourY = obs.y - effectiveClearance;
          topMinObsX = Math.min(topMinObsX, obs.x);
          topMaxObsRight = Math.max(topMaxObsRight, obs.x + obs.width);
          if (!topHitSet.has(obs)) {
            topHitSet.add(obs);
            topHitObstacles.push(obs);
          }
          topChanged = true;
        }
      }
    }

    let bottomMinObsX = baseMinObsX;
    let bottomMaxObsRight = baseMaxObsRight;
    const bottomHitObstacles = [...initialHitObstacles];
    const bottomHitSet = new Set(initialHitObstacles);

    let bottomDetourY = maxObsY + effectiveClearance;
    let bottomChanged = true;
    while (bottomChanged) {
      bottomChanged = false;
      for (const obs of intermediateObstacles) {
        if (
          bottomDetourY >= obs.y - padY &&
          bottomDetourY < obs.y + obs.height + effectiveClearance
        ) {
          bottomDetourY = obs.y + obs.height + effectiveClearance;
          bottomMinObsX = Math.min(bottomMinObsX, obs.x);
          bottomMaxObsRight = Math.max(bottomMaxObsRight, obs.x + obs.width);
          if (!bottomHitSet.has(obs)) {
            bottomHitSet.add(obs);
            bottomHitObstacles.push(obs);
          }
          bottomChanged = true;
        }
      }
    }

    const topCost = Math.abs(sourceY - topDetourY) +
      Math.abs(targetY - topDetourY);
    const bottomCost = Math.abs(sourceY - bottomDetourY) +
      Math.abs(targetY - bottomDetourY);
    const routeTop = preferredSide === "top"
      ? true
      : preferredSide === "bottom"
      ? false
      : topCost < bottomCost - 1;
    const detourSide = routeTop ? "top" : "bottom";
    const detourY = routeTop ? topDetourY : bottomDetourY;
    const minObsX = routeTop ? topMinObsX : bottomMinObsX;
    const maxObsRight = routeTop ? topMaxObsRight : bottomMaxObsRight;
    const hitObstacles = routeTop ? topHitObstacles : bottomHitObstacles;

    let leadOutX = Math.max(
      sourceX + 14,
      Math.min(minObsX - 14, (sourceX + minObsX) / 2 + laneLeadShift),
    );
    let leadInX = Math.min(
      targetX - 14,
      Math.max(maxObsRight + 14, (maxObsRight + targetX) / 2 - laneLeadShift),
    );
    if (leadOutX >= leadInX) {
      leadOutX = sourceX + (targetX - sourceX) * 0.2;
      leadInX = sourceX + (targetX - sourceX) * 0.8;
    }

    const bendPoints = [
      { x: sourceX, y: sourceY },
      { x: leadOutX, y: sourceY },
      { x: leadOutX, y: detourY },
      { x: leadInX, y: detourY },
      { x: leadInX, y: targetY },
      { x: targetX, y: targetY },
    ];
    const filleted = buildFilletedOrthogonalPath(bendPoints, 10);

    return {
      path: filleted.path,
      labelX: leadOutX + (leadInX - leadOutX) * labelT,
      labelY: detourY,
      bendPoints,
      hitObstacles,
      detourSide,
    };
  }
}
