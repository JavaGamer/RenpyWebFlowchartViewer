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
  calculateObstructedForwardSpline,
  calculateParallelForwardSpline,
  calculateSelfLoopArc,
  detectBackEdge,
  type LabeledEdgeType,
  NODE_WIDTH,
} from "../domain/index.ts";
import { useViewerLayoutDirection } from "./viewerContext.tsx";
import { useAppStore, useViewerStore } from "../application/index.ts";
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
  const hasExactEndpoints = Boolean(
    startPt && endPt &&
      Math.abs(safeSourceX - startPt.x) <= 1 &&
      Math.abs(safeSourceY - startPt.y) <= 1 &&
      Math.abs(safeTargetX - endPt.x) <= 1 &&
      Math.abs(safeTargetY - endPt.y) <= 1,
  );

  let liveBypassRes:
    | ReturnType<typeof calculateObstructedForwardSpline>
    | null = null;
  if (
    !isSelf &&
    !isBack &&
    !isCustomPathStale &&
    !hasExactEndpoints &&
    data?.obstacles &&
    data.obstacles.length > 0 &&
    (safeSourceX !== 0 || safeSourceY !== 0 || safeTargetX !== 0 ||
      safeTargetY !== 0)
  ) {
    liveBypassRes = calculateObstructedForwardSpline({
      sourceX: safeSourceX,
      sourceY: safeSourceY,
      targetX: safeTargetX,
      targetY: safeTargetY,
      direction: layoutDirection,
      obstacles: data.obstacles,
      laneIndex: data.detourLaneIndex ?? 0,
      laneCount: data.detourLaneCount ?? 1,
    });
  }

  if (liveBypassRes) {
    edgePath = liveBypassRes.path;
    labelX = liveBypassRes.labelX;
    labelY = liveBypassRes.labelY;
  } else if (data?.svgPath && data?.labelPosition && !isCustomPathStale) {
    edgePath = data.svgPath;
    labelX = data.labelPosition.x;
    labelY = data.labelPosition.y;
  } else if (isSelf) {
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

  const activeLanguage = useViewerStore((s) => s.activeLanguage);
  const translations = useAppStore((s) => s.translations);

  const rawLabel = data?.label ??
    (data?.timeout?.isTimeout
      ? (data.timeout.durationSeconds !== undefined
        ? `Timeout (${data.timeout.durationSeconds}s)`
        : "Timeout")
      : undefined);
  const displayLabel = (rawLabel && activeLanguage &&
      translations?.translationsByLanguage[activeLanguage]?.strings[rawLabel])
    ? translations.translationsByLanguage[activeLanguage].strings[rawLabel]!
    : rawLabel;

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
  const fullTooltip = tooltipParts.join(" · ");

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {displayLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform:
                `translate(-50%, -50%) translate(${safeLabelX}px,${safeLabelY}px)`,
              pointerEvents: "all",
              opacity: data?.conditionState === "unreachable" ? 0.45 : 1,
            }}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] max-w-[120px] truncate shadow-sm nodrag nopan border transition-colors duration-200 cursor-help",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-200"
                : isHighContrast
                ? "bg-white border-2 border-black text-black font-semibold"
                : "bg-white border-gray-200 text-gray-600",
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
