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
  calculateSelfLoopArc,
  detectBackEdge,
  type LabeledEdgeType,
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

  const isSelf = data?.isSelfLoop ||
    (sourceX === targetX && sourceY === targetY);
  const isBack = data?.isBackEdge ||
    detectBackEdge(
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
      layoutDirection,
      isSelf,
    );

  const isCustomPathStale = data?.bendPoints &&
    data.bendPoints.length >= 2 &&
    (Math.hypot(
          sourceX - data.bendPoints[0]!.x,
          sourceY - data.bendPoints[0]!.y,
        ) > 3 ||
      Math.hypot(
          targetX - data.bendPoints[data.bendPoints.length - 1]!.x,
          targetY - data.bendPoints[data.bendPoints.length - 1]!.y,
        ) > 3);

  if (data?.svgPath && data?.labelPosition && !isCustomPathStale) {
    edgePath = data.svgPath;
    labelX = data.labelPosition.x;
    labelY = data.labelPosition.y;
  } else if (isSelf) {
    const res = calculateSelfLoopArc({
      sourceX,
      sourceY,
      targetX,
      targetY,
      direction: layoutDirection,
      laneIndex: data?.laneIndex ?? 0,
    });
    edgePath = res.path;
    labelX = res.labelX;
    labelY = res.labelY;
  } else if (isBack) {
    const res = calculateBackEdgeSpline({
      sourceX,
      sourceY,
      targetX,
      targetY,
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
  } else {
    const [d, lx, ly] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    edgePath = d;
    labelX = lx;
    labelY = ly;
  }

  const activeLanguage = useViewerStore((s) => s.activeLanguage);
  const translations = useAppStore((s) => s.translations);

  const rawLabel = data?.label;
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
                `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
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
