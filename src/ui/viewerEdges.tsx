import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import type { LabeledEdgeType } from "../domain/index.ts";
import { useViewerStore } from "../application/index.ts";
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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";
  const isHighContrast = theme === "highContrast";

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {(data?.label || data?.originType === "screen") && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform:
                `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              opacity: style?.opacity !== undefined
                ? style.opacity
                : (data?.conditionState === "unreachable" ? 0.45 : 1),
            }}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] max-w-[140px] truncate shadow-sm nodrag nopan border transition-colors duration-200 flex items-center gap-1",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-200"
                : isHighContrast
                ? "bg-white border-2 border-black text-black font-semibold"
                : "bg-white border-gray-200 text-gray-600",
            )}
          >
            {data?.originType === "screen" && (
              <span className="text-[9px] px-1 rounded bg-blue-500/20 text-blue-500 dark:text-blue-300 font-mono">
                screen
              </span>
            )}
            {data?.label && <span className="truncate">{data.label}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
