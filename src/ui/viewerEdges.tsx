import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  Position,
} from "@xyflow/react";
import {
  calculateBackEdgeSpline,
  calculateParallelForwardSpline,
  calculateSelfLoopArc,
  detectBackEdge,
  NODE_WIDTH,
} from "../domain/index.ts";
import type { LabeledEdgeType } from "./canvasTypes.ts";
import { useViewerLayoutDirection } from "./viewerContext.tsx";
import { cn } from "./utils/cn.ts";

export const LabeledEdge = memo(function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
  selected,
}: EdgeProps<LabeledEdgeType>) {
  const layoutDirection = useViewerLayoutDirection();
  const theme = data?.theme ?? "violet";
  const isDark = theme === "dark";
  const isHighContrast = theme === "highContrast";

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  const safeSourceX = Number.isFinite(sourceX) ? sourceX : 0;
  const safeSourceY = Number.isFinite(sourceY) ? sourceY : 0;
  const safeTargetX = Number.isFinite(targetX) ? targetX : 0;
  const safeTargetY = Number.isFinite(targetY) ? targetY : 0;

  const isSelf = data?.isSelfLoop ||
    (safeSourceX === safeTargetX && safeSourceY === safeTargetY);
  const isBack = data?.isBackEdge ||
    detectBackEdge(
      { x: safeSourceX, y: safeSourceY },
      { x: safeTargetX, y: safeTargetY },
      layoutDirection,
      isSelf,
    );

  const startPt = data?.bendPoints?.[0];
  const endPt = data?.bendPoints && data.bendPoints.length >= 2
    ? data.bendPoints[data.bendPoints.length - 1]
    : undefined;

  const sourceDx = startPt ? safeSourceX - startPt.x : 0;
  const sourceDy = startPt ? safeSourceY - startPt.y : 0;
  const targetDx = endPt ? safeTargetX - endPt.x : 0;
  const targetDy = endPt ? safeTargetY - endPt.y : 0;

  const isRigidTranslation = Boolean(
    startPt && endPt &&
      Math.abs(sourceDx - targetDx) <= 2 &&
      Math.abs(sourceDy - targetDy) <= 2,
  );
  const hasMoved = Boolean(
    startPt && endPt &&
      (Math.abs(sourceDx) > 3 || Math.abs(sourceDy) > 3 ||
        Math.abs(targetDx) > 3 || Math.abs(targetDy) > 3),
  );

  const maxPrimaryOffset = 84;
  const maxCrossOffset = NODE_WIDTH / 2 + 12;
  const isCustomPathStale = Boolean(
    startPt && endPt && (
      layoutDirection === "TB"
        ? (
          Math.abs(safeSourceY - startPt.y) > maxPrimaryOffset ||
          Math.abs(safeSourceX - startPt.x) > maxCrossOffset ||
          Math.abs(safeTargetY - endPt.y) > maxPrimaryOffset ||
          Math.abs(safeTargetX - endPt.x) > maxCrossOffset
        )
        : (
          Math.abs(safeSourceX - startPt.x) > maxPrimaryOffset ||
          Math.abs(safeSourceY - startPt.y) > 96 ||
          Math.abs(safeTargetX - endPt.x) > maxPrimaryOffset ||
          Math.abs(safeTargetY - endPt.y) > 96
        )
    ),
  );

  if (isSelf) {
    const res = calculateSelfLoopArc({
      sourceX: safeSourceX,
      sourceY: safeSourceY,
      targetX: safeTargetX,
      targetY: safeTargetY,
      direction: layoutDirection,
      laneIndex: data?.laneIndex ?? 0,
    });
    edgePath = res.path;
    labelX = res.labelX;
    labelY = res.labelY;
  } else if (isBack) {
    const res = calculateBackEdgeSpline({
      sourceX: safeSourceX,
      sourceY: safeSourceY,
      targetX: safeTargetX,
      targetY: safeTargetY,
      sourcePosition: sourcePosition ??
        (layoutDirection === "LR" ? Position.Bottom : Position.Right),
      targetPosition: targetPosition ??
        (layoutDirection === "LR" ? Position.Bottom : Position.Right),
      direction: layoutDirection,
      laneIndex: data?.laneIndex ?? 0,
      isLeft: data?.isLeft ?? true,
      outerGutterCoord: data?.outerGutterCoord,
    });
    edgePath = res.path;
    labelX = res.labelX;
    labelY = res.labelY;
  } else if (data?.isLongSkip) {
    const res = calculateBackEdgeSpline({
      sourceX: safeSourceX,
      sourceY: safeSourceY,
      targetX: safeTargetX,
      targetY: safeTargetY,
      sourcePosition: sourcePosition ??
        (layoutDirection === "LR" ? Position.Bottom : Position.Right),
      targetPosition: targetPosition ??
        (layoutDirection === "LR" ? Position.Bottom : Position.Right),
      direction: layoutDirection,
      laneIndex: data?.laneIndex ?? 0,
      isLeft: false,
      outerGutterCoord: data?.outerGutterCoord,
    });
    edgePath = res.path;
    labelX = res.labelX;
    labelY = res.labelY;
  } else if (
    data?.parallelCount !== undefined &&
    data.parallelCount > 1 &&
    data.parallelIndex !== undefined
  ) {
    const res = calculateParallelForwardSpline({
      sourceX: safeSourceX,
      sourceY: safeSourceY,
      targetX: safeTargetX,
      targetY: safeTargetY,
      sourcePosition,
      targetPosition,
      direction: layoutDirection,
      parallelIndex: data.parallelIndex,
      parallelCount: data.parallelCount,
    });
    edgePath = res.path;
    labelX = res.labelX;
    labelY = res.labelY;
  } else if (data?.svgPath && data?.labelPosition && !hasMoved) {
    edgePath = data.svgPath;
    labelX = data.labelPosition.x;
    labelY = data.labelPosition.y;
  } else if (
    data?.svgPath && data?.labelPosition && isRigidTranslation &&
    !isCustomPathStale
  ) {
    const [d] = getBezierPath({
      sourceX: safeSourceX,
      sourceY: safeSourceY,
      sourcePosition,
      targetX: safeTargetX,
      targetY: safeTargetY,
      targetPosition,
    });
    edgePath = d;
    labelX = data.labelPosition.x + sourceDx;
    labelY = data.labelPosition.y + sourceDy;
  } else {
    const [d, lx, ly] = getBezierPath({
      sourceX: safeSourceX,
      sourceY: safeSourceY,
      sourcePosition,
      targetX: safeTargetX,
      targetY: safeTargetY,
      targetPosition,
    });
    edgePath = d;
    labelX = lx;
    labelY = ly;
  }

  const safeLabelX = Number.isFinite(labelX) ? labelX : 0;
  const safeLabelY = Number.isFinite(labelY) ? labelY : 0;

  const rawLabel = data?.label ??
    (data?.timeout?.isTimeout
      ? (data.timeout.durationSeconds !== undefined
        ? `Timeout (${data.timeout.durationSeconds}s)`
        : "Timeout")
      : undefined);
  const displayLabel = data?.displayLabel ?? rawLabel;

  const tooltipParts: string[] = [];
  if (displayLabel) {
    tooltipParts.push(displayLabel);
    if (rawLabel && displayLabel !== rawLabel) {
      tooltipParts.push(`(Original: ${rawLabel})`);
    }
  }
  if (data?.condition) {
    const condExpr = typeof data.condition === "object"
      ? data.condition.expression
      : String(data.condition);
    if (condExpr) {
      tooltipParts.push(`Condition: ${condExpr}`);
    }
  }
  if (data?.conditionState) {
    tooltipParts.push(`State: ${data.conditionState}`);
  }
  if (data?.timeout !== undefined) {
    const timeoutSec = typeof data.timeout === "object"
      ? data.timeout.durationSeconds
      : data.timeout;
    if (timeoutSec !== undefined) {
      tooltipParts.push(`Timeout: ${timeoutSec}s`);
    }
  }
  const isFallthrough = data?.kind === "fallthrough" ||
    data?.isFallthrough === true;
  const effectiveStyle = isFallthrough
    ? {
      ...style,
      strokeDasharray: style?.strokeDasharray || "4 4",
      opacity: (typeof style?.opacity === "number" ? style.opacity : 1) * 0.8,
    }
    : style;
  const fullTooltip = tooltipParts.join(" · ");

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={effectiveStyle}
      />
      {displayLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform:
                `translate(-50%, -50%) translate(${safeLabelX}px,${safeLabelY}px)`,
              pointerEvents: "all",
              opacity: data?.conditionState === "unreachable" ? 0.45 : 1,
              zIndex: selected ? 1005 : 10,
            }}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] max-w-[130px] truncate shadow-sm nodrag nopan border transition-colors duration-200 cursor-help backdrop-blur-sm z-10",
              isFallthrough && "border-dashed italic",
              isDark
                ? "bg-slate-800/90 border-slate-700 text-slate-200 hover:max-w-none hover:z-30"
                : isHighContrast
                ? "bg-white border-2 border-black text-black font-semibold hover:max-w-none hover:z-30"
                : "bg-white/95 border-gray-200 text-gray-700 hover:max-w-none hover:z-30",
            )}
            title={fullTooltip || displayLabel}
          >
            {displayLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
