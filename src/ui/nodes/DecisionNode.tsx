import { memo } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { NODE_HEIGHT_DECISION } from "../../domain/index.ts";
import type { DecisionNodeType } from "../canvasTypes.ts";
import { cn } from "../utils/cn.ts";
import { renderHighlightedText } from "../viewerText.tsx";
import { useIsLodMode } from "../hooks/useLodMode.ts";
import { useViewerPresentation } from "../viewerContext.tsx";
import { getTheme } from "./nodeUtils.ts";
export const DecisionNodeComponent = memo(
  function DecisionNodeComponent({ data }: NodeProps<DecisionNodeType>) {
    const { searchInput, layoutDirection } = useViewerPresentation();
    const themeName = data.theme ?? "violet";
    const theme = getTheme(themeName);
    const isDark = themeName === "dark";
    const isRouteHighlighted = data.isRouteHighlighted === true;
    const isRouteDimmed = data.isRouteDimmed === true;
    const routeStepIndex = data.routeStepIndex;

    const targetPosition = layoutDirection === "LR"
      ? Position.Left
      : Position.Top;
    const sourcePosition = layoutDirection === "LR"
      ? Position.Right
      : Position.Bottom;
    const expression = data.conditionExpression ?? data.label;

    const isLod = useIsLodMode();

    if (isLod) {
      return (
        <div
          className={cn(
            "w-[220px] flex items-center justify-center relative py-2 transition-all duration-200 select-none cursor-pointer",
            isRouteHighlighted && "scale-[1.02] z-20",
          )}
          style={{
            height: `${NODE_HEIGHT_DECISION}px`,
            opacity: isRouteDimmed ? 0.2 : 1,
          }}
          title={`Decision: ${expression}`}
        >
          {/* Target Anchors */}
          <Handle
            id="target-top"
            type="target"
            position={Position.Top}
            style={{ top: "calc(50% - 14px)", left: "50%" }}
            className={cn(
              targetPosition === Position.Top
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-bottom"
            type="target"
            position={Position.Bottom}
            style={{ bottom: "calc(50% - 14px)", left: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="target-left"
            type="target"
            position={Position.Left}
            style={{ left: "20px", top: "50%" }}
            className={cn(
              targetPosition === Position.Left
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-right"
            type="target"
            position={Position.Right}
            style={{ right: "20px", top: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />

          {/* LOD Pill Body */}
          <div
            className="w-[180px] h-[28px] px-3 rounded-full border-2 shadow-xs flex items-center justify-between overflow-hidden"
            style={{
              borderColor: theme.decisionBorder,
              backgroundColor: theme.decisionBg,
              borderStyle: "solid",
              opacity: isRouteDimmed ? 0.2 : 1,
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: theme.decisionTitle }}
              />
              <span
                className="font-mono text-xs font-semibold truncate"
                style={{ color: theme.decisionText }}
              >
                {renderHighlightedText(expression, searchInput)}
              </span>
            </div>
            {routeStepIndex !== undefined && (
              <span
                className={cn(
                  "text-[9px] font-bold px-1.5 py-0.2 rounded-full shrink-0 shadow-xs",
                  isDark
                    ? "bg-amber-400 text-slate-950"
                    : "bg-amber-600 text-white",
                )}
                title={`Step ${routeStepIndex}`}
              >
                #{routeStepIndex}
              </span>
            )}
          </div>

          {/* Source Anchors */}
          <Handle
            id="source-top"
            type="source"
            position={Position.Top}
            style={{ top: "calc(50% - 14px)", left: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-bottom"
            type="source"
            position={Position.Bottom}
            style={{ bottom: "calc(50% - 14px)", left: "50%" }}
            className={cn(
              sourcePosition === Position.Bottom
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="source-left"
            type="source"
            position={Position.Left}
            style={{ left: "20px", top: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-right"
            type="source"
            position={Position.Right}
            style={{ right: "20px", top: "50%" }}
            className={cn(
              sourcePosition === Position.Right
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
        </div>
      );
    }

    return (
      <div
        className="w-[220px] flex items-center justify-center relative py-2 transition-all duration-200"
        style={{ opacity: isRouteDimmed ? 0.2 : 1 }}
      >
        {/* Target Anchors */}
        <Handle
          id="target-top"
          type="target"
          position={Position.Top}
          style={{ top: "8px", left: "50%" }}
          className={cn(
            targetPosition === Position.Top
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-bottom"
          type="target"
          position={Position.Bottom}
          style={{ bottom: "8px", left: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="target-left"
          type="target"
          position={Position.Left}
          style={{ left: "30px", top: "50%" }}
          className={cn(
            targetPosition === Position.Left
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-right"
          type="target"
          position={Position.Right}
          style={{ right: "30px", top: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <div
          className={cn(
            "w-[160px] h-[160px] rotate-45 border-2 shadow-md rounded-xl flex items-center justify-center transition-all duration-200",
            isRouteHighlighted &&
              "ring-2 ring-violet-500 shadow-xl scale-[1.02]",
          )}
          style={{
            borderColor: isRouteHighlighted
              ? (isDark ? "#a78bfa" : "#7c3aed")
              : theme.decisionBorder,
            backgroundColor: theme.decisionBg,
          }}
        >
          <div className="-rotate-45 px-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <div
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: theme.decisionTitle }}
              >
                Decision
              </div>
              {routeStepIndex !== undefined && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-violet-600 text-white shadow-xs"
                  title={`Step ${routeStepIndex} in highlighted route`}
                >
                  #{routeStepIndex}
                </span>
              )}
            </div>
            <div
              className="font-mono text-xs font-semibold break-words"
              style={{ color: theme.decisionText }}
            >
              {searchInput
                ? renderHighlightedText(expression, searchInput)
                : expression}
            </div>
          </div>
        </div>
        {/* Source Anchors */}
        <Handle
          id="source-top"
          type="source"
          position={Position.Top}
          style={{ top: "8px", left: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-bottom"
          type="source"
          position={Position.Bottom}
          style={{ bottom: "8px", left: "50%" }}
          className={cn(
            sourcePosition === Position.Bottom
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="source-left"
          type="source"
          position={Position.Left}
          style={{ left: "30px", top: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-right"
          type="source"
          position={Position.Right}
          style={{ right: "30px", top: "50%" }}
          className={cn(
            sourcePosition === Position.Right
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
      </div>
    );
  },
);
