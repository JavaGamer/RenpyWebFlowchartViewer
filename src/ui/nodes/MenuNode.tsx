import { memo } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { getNodeHeight } from "../../domain/index.ts";
import type { MenuNodeType } from "../canvasTypes.ts";
import { useAppStore, useViewerStore } from "../../application/index.ts";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "../utils/cn.ts";
import { renderHighlightedText } from "../viewerText.tsx";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "../utils/readingTime.ts";
import { useIsLodMode } from "../hooks/useLodMode.ts";
import { useViewerPresentation } from "../viewerContext.tsx";
import { getTheme } from "./nodeUtils.ts";
export const MenuNodeComponent = memo(
  function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
    const { searchInput, readingSpeedWpm, layoutDirection } =
      useViewerPresentation();
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
    const activeLanguage = useViewerStore((s) => s.activeLanguage);
    const translations = useAppStore((s) => s.translations);
    const displayLabel = (activeLanguage &&
        translations?.translationsByLanguage[activeLanguage]?.strings[
          data.label
        ])
      ? translations.translationsByLanguage[activeLanguage].strings[data.label]!
      : data.label;

    const menuHeight = getNodeHeight({
      type: "MENU",
      label: displayLabel,
    });

    const isLod = useIsLodMode();

    if (isLod) {
      return (
        <div
          className={cn(
            "w-[220px] flex items-center justify-center relative select-none cursor-pointer transition-all duration-200",
            isRouteHighlighted && "scale-[1.02] z-20",
          )}
          style={{ minHeight: `${menuHeight}px` }}
          title={`Menu: ${displayLabel}`}
        >
          {/* Target Anchors */}
          <Handle
            id="target-top"
            type="target"
            position={Position.Top}
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
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="target-left"
            type="target"
            position={Position.Left}
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
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <div className="flex items-center justify-between w-full px-2">
            <div className="flex items-center gap-1 min-w-0">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: theme.menuTitle }}
              />
              <span
                className="font-mono text-xs font-semibold truncate"
                style={{ color: theme.menuText }}
              >
                {searchInput
                  ? renderHighlightedText(displayLabel, searchInput)
                  : displayLabel}
              </span>
            </div>
            {routeStepIndex !== undefined && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-violet-600 text-white shrink-0 shadow-xs"
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
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-bottom"
            type="source"
            position={Position.Bottom}
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
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-right"
            type="source"
            position={Position.Right}
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
        className={cn(
          "px-4 py-3 rounded-xl border-2 shadow-md w-[220px] transition-all duration-200",
          isRouteHighlighted &&
            "ring-2 ring-violet-500 shadow-xl z-20 scale-[1.02]",
        )}
        style={{
          minHeight: `${menuHeight}px`,
          borderColor: isRouteHighlighted
            ? (isDark ? "#a78bfa" : "#7c3aed")
            : theme.menuBorder,
          backgroundColor: theme.menuBg,
          opacity: isRouteDimmed ? 0.2 : 1,
        }}
      >
        {/* Target Anchors */}
        <Handle
          id="target-top"
          type="target"
          position={Position.Top}
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
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="target-left"
          type="target"
          position={Position.Left}
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
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5">
            <div
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: theme.menuTitle }}
            >
              Menu
            </div>
            {data.mutations && data.mutations.length > 0 && (
              <span
                className={cn(
                  "text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border flex items-center gap-1 cursor-help",
                  isDark
                    ? "bg-cyan-950/60 border-cyan-800/80 text-cyan-300"
                    : "bg-cyan-50 border-cyan-200 text-cyan-800",
                )}
                title={data.mutations
                  .map(
                    (m) =>
                      `${
                        m.isPersistent &&
                          !m.variableName.startsWith("persistent.")
                          ? "persistent."
                          : ""
                      }${m.variableName} ${m.operator} ${m.rawExpression}`,
                  )
                  .join("\n")}
              >
                <SlidersHorizontal size={10} aria-hidden="true" />
                <span>
                  {data.mutations.length}{" "}
                  {data.mutations.length === 1 ? "var" : "vars"}
                </span>
              </span>
            )}
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
          className="font-mono font-bold line-clamp-2 break-words text-sm"
          style={{ color: theme.menuText }}
        >
          {searchInput
            ? renderHighlightedText(displayLabel, searchInput)
            : displayLabel}
        </div>
        {data.dialogueCount > 0 && (
          <div className="mt-1 text-xs" style={{ color: theme.menuTitle }}>
            {data.dialogueCount}{" "}
            dialogue line{data.dialogueCount !== 1 ? "s" : ""}
            {(data.wordCount ?? 0) > 0 && (() => {
              const secs = calculateReadingTimeSeconds(
                data.wordCount ?? 0,
                data.pauseDuration ?? 0,
                readingSpeedWpm,
              );
              return (
                <span
                  title={`~${(data.wordCount ?? 0).toLocaleString()} words`}
                  style={{ opacity: 0.75, cursor: "help" }}
                >
                  {" · "}
                  {formatReadingTime(secs)}
                </span>
              );
            })()}
          </div>
        )}
        {/* Source Anchors */}
        <Handle
          id="source-top"
          type="source"
          position={Position.Top}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-bottom"
          type="source"
          position={Position.Bottom}
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
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-right"
          type="source"
          position={Position.Right}
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
