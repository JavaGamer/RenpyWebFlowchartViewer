import { memo, useCallback } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { CHAPTER_SUMMARY_HEIGHT } from "../../domain/index.ts";
import type { ChapterNodeType } from "../canvasTypes.ts";
import { useViewerStore } from "../../application/index.ts";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderArchive,
  Sparkles,
} from "lucide-react";
import { cn } from "../utils/cn.ts";
import { renderHighlightedText } from "../viewerText.tsx";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "../utils/readingTime.ts";
import { useIsLodMode } from "../hooks/useLodMode.ts";
import { useViewerPresentation } from "../viewerContext.tsx";
export const ChapterNodeComponent = memo(
  function ChapterNodeComponent({ data }: NodeProps<ChapterNodeType>) {
    const { searchInput, readingSpeedWpm, layoutDirection } =
      useViewerPresentation();
    const themeName = data.theme ?? "violet";
    const isDark = themeName === "dark";

    const chapterName = data.chapter || data.label || "Uncategorized";
    const isCollapsed = data.isCollapsed === true;
    const containsActiveRoute = data.containsActiveRoute === true;
    const searchMatchCount = data.chapterSearchMatchCount ?? 0;

    const handleToggleChapter = useCallback(() => {
      useViewerStore.getState().toggleChapter(chapterName);
    }, [chapterName]);

    const totalWords = data.chapterTotalWordCount ?? data.wordCount ?? 0;
    const totalDialogue = data.chapterTotalDialogueCount ??
      data.dialogueCount ?? 0;
    const nodeCount = data.chapterNodeCount ?? 0;
    const pauseSecs = data.chapterTotalPauseDuration ?? data.pauseDuration ?? 0;

    const readingTime = totalWords > 0
      ? formatReadingTime(
        calculateReadingTimeSeconds(totalWords, pauseSecs, readingSpeedWpm),
      )
      : null;

    const targetPosition = layoutDirection === "LR"
      ? Position.Left
      : Position.Top;
    const sourcePosition = layoutDirection === "LR"
      ? Position.Right
      : Position.Bottom;

    const isLod = useIsLodMode();

    // ── 1. Collapsed Summary Card on Canvas ──────────────────────────────────
    if (isCollapsed) {
      if (isLod) {
        return (
          <div
            className={cn(
              "w-[260px] flex items-center justify-center relative select-none cursor-pointer transition-all duration-200",
              containsActiveRoute && "scale-[1.02] z-20",
            )}
            style={{ minHeight: `${CHAPTER_SUMMARY_HEIGHT}px` }}
            onClick={handleToggleChapter}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleToggleChapter();
              }
            }}
            aria-label={`Expand chapter container for ${chapterName}`}
            title={`Collapsed Chapter: ${chapterName} (${nodeCount} labels, ${totalDialogue} lines)`}
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

            {/* LOD Pill Body */}
            <div
              className={cn(
                "w-[220px] h-[28px] px-3 rounded-full border-2 shadow-xs flex items-center justify-between overflow-hidden",
                containsActiveRoute && "ring-2 ring-violet-500 shadow-md",
              )}
              style={{
                borderColor: containsActiveRoute
                  ? (isDark ? "#a78bfa" : "#7c3aed")
                  : isDark
                  ? "#475569"
                  : "#94a3b8",
                backgroundColor: isDark ? "#1e293b" : "#f8fafc",
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <FolderArchive
                  size={12}
                  className={isDark ? "text-violet-400" : "text-violet-600"}
                />
                <span
                  className="font-mono text-xs font-semibold truncate"
                  style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                >
                  {searchInput
                    ? renderHighlightedText(chapterName, searchInput)
                    : chapterName}
                </span>
              </div>
              <span
                className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-slate-700 text-slate-200 shrink-0 shadow-xs"
                title={`${nodeCount} labels`}
              >
                {nodeCount}
              </span>
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
            "p-3.5 rounded-xl border-2 shadow-md w-[260px] transition-all duration-200 cursor-pointer select-none relative",
            containsActiveRoute &&
              "ring-2 ring-violet-500 shadow-xl scale-[1.02] z-20",
          )}
          style={{
            borderColor: containsActiveRoute
              ? (isDark ? "#a78bfa" : "#7c3aed")
              : isDark
              ? "#475569"
              : "#cbd5e1",
            backgroundColor: isDark ? "#1e293b" : "#f8fafc",
          }}
          onClick={handleToggleChapter}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggleChapter();
            }
          }}
          aria-label={`Expand chapter container for ${chapterName}`}
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

          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5">
              <FolderArchive
                size={14}
                className={isDark ? "text-violet-400" : "text-violet-600"}
              />
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: isDark ? "#334155" : "#e2e8f0",
                  color: isDark ? "#94a3b8" : "#475569",
                }}
              >
                Chapter Summary
              </span>
            </div>
            <span
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors",
                isDark
                  ? "bg-slate-800 border-slate-600 text-slate-200"
                  : "bg-white border-gray-300 text-gray-700",
              )}
              aria-hidden="true"
            >
              <ChevronRight size={12} />
              <span>Expand</span>
            </span>
          </div>

          <div
            className="font-mono font-bold text-sm truncate"
            style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
          >
            {searchInput
              ? renderHighlightedText(chapterName, searchInput)
              : chapterName}
          </div>

          <div
            className="mt-1.5 text-xs flex flex-col gap-0.5"
            style={{ color: isDark ? "#94a3b8" : "#64748b" }}
          >
            <div>
              {nodeCount > 0 && (
                <span>
                  {nodeCount} label{nodeCount !== 1 ? "s" : ""}
                </span>
              )}
              {totalDialogue > 0 && (
                <span>
                  {" · "}
                  {totalDialogue} line{totalDialogue !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {totalWords > 0 && (
              <div className="text-[11px] opacity-85">
                ~{totalWords.toLocaleString()} words
                {readingTime && ` · ${readingTime}`}
              </div>
            )}
          </div>

          {searchMatchCount > 0 && (
            <div className="mt-2 pt-1.5 border-t border-slate-700/40 flex items-center gap-1 text-[10px] font-semibold text-amber-400">
              <Sparkles size={11} />
              <span>
                {searchMatchCount}{" "}
                search match{searchMatchCount !== 1 ? "es" : ""} inside
              </span>
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
    }

    // ── 2. Expanded Container Box around Child Labels ─────────────────────────
    return (
      <div
        className={cn(
          "w-full h-full rounded-2xl border-2 transition-all duration-200 pointer-events-none relative select-none",
          containsActiveRoute && "ring-2 ring-violet-500 shadow-xl",
        )}
        style={{
          borderColor: isDark
            ? "rgba(100, 116, 139, 0.45)"
            : "rgba(203, 213, 225, 0.9)",
          backgroundColor: isDark
            ? "rgba(15, 23, 42, 0.4)"
            : "rgba(248, 250, 252, 0.55)",
          borderStyle: "dashed",
        }}
      >
        {/* Interactive Header Badge Bar */}
        <div className="absolute top-2 left-3 pointer-events-auto flex items-center gap-2 z-10">
          <div
            className={cn(
              "flex items-center gap-2 px-2.5 py-1 rounded-lg border shadow-xs backdrop-blur-md transition-colors",
              isDark
                ? "bg-slate-900/90 border-slate-700 text-slate-200"
                : "bg-white/95 border-slate-200 text-slate-800",
            )}
          >
            <FileCode
              size={13}
              className={isDark ? "text-violet-400" : "text-violet-600"}
            />
            <span className="font-mono font-bold text-xs tracking-tight">
              {searchInput
                ? renderHighlightedText(chapterName, searchInput)
                : chapterName}
            </span>
            {!isLod && (
              <>
                <div
                  className="h-3 w-px mx-0.5"
                  style={{ backgroundColor: isDark ? "#475569" : "#e2e8f0" }}
                />
                <span
                  className="text-[10px] font-medium"
                  style={{ color: isDark ? "#94a3b8" : "#64748b" }}
                >
                  {nodeCount > 0 ? `${nodeCount} nodes` : ""}
                  {totalWords > 0 ? ` · ~${totalWords.toLocaleString()}w` : ""}
                  {readingTime ? ` · ${readingTime}` : ""}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleChapter();
                  }}
                  className={cn(
                    "ml-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer",
                    isDark
                      ? "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200"
                      : "bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-700",
                  )}
                  aria-label={`Collapse chapter container ${chapterName}`}
                  title="Collapse chapter into summary node"
                >
                  <ChevronDown size={11} />
                  <span>Collapse</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
);
