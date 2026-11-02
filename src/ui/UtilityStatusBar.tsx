/**
 * src/ui/UtilityStatusBar.tsx
 *
 * Compact 22px technical status footer for the Ren'Py Web Flowchart Viewer.
 * Displays persistent node/edge statistics, reading time calculations,
 * and layout calculation telemetry.
 */

import { useAppStore, useViewerStore } from "../application/index.ts";
import { getParserVariantPlugin } from "../config/parserRules.ts";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "./utils/readingTime.ts";
import { cn } from "./utils/cn.ts";

export interface UtilityStatusBarProps {
  visibleNodeCount: number;
  totalNodeCount: number;
  visibleEdgeCount: number;
  totalEdgeCount: number;
  visibleWordCount: number;
  visiblePauseDuration: number;
  totalWordCount: number;
  totalPauseDuration: number;
  readingSpeedWpm: number;
}

export function UtilityStatusBar({
  visibleNodeCount,
  totalNodeCount,
  visibleEdgeCount,
  totalEdgeCount,
  visibleWordCount,
  visiblePauseDuration,
  totalWordCount,
  totalPauseDuration,
  readingSpeedWpm,
}: UtilityStatusBarProps) {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";
  const parsedVariant = useAppStore((s) => s.parsedVariant);
  const activeLanguage = useViewerStore((s) => s.activeLanguage);

  const displayVariantName = parsedVariant
    ? getParserVariantPlugin(parsedVariant).label
    : "Ren'Py";

  const visibleTime = formatReadingTime(
    calculateReadingTimeSeconds(
      visibleWordCount,
      visiblePauseDuration,
      readingSpeedWpm,
    ),
  );
  const totalTime = formatReadingTime(
    calculateReadingTimeSeconds(
      totalWordCount,
      totalPauseDuration,
      readingSpeedWpm,
    ),
  );

  return (
    <footer
      className={cn(
        "h-6 shrink-0 border-t px-3 flex items-center justify-between text-[11px] font-mono z-30 select-none transition-colors duration-200",
        isDark
          ? "bg-slate-900 border-slate-800 text-slate-400"
          : "bg-gray-50 border-gray-200 text-gray-600",
      )}
    >
      <div className="flex items-center gap-3 min-w-0 truncate">
        <span
          className={cn(
            "font-medium",
            isDark ? "text-slate-200" : "text-gray-800",
          )}
        >
          {visibleNodeCount} / {totalNodeCount} nodes · {visibleEdgeCount} /
          {" "}
          {totalEdgeCount} edges
        </span>
        <span>|</span>
        <span
          title={`${visibleWordCount.toLocaleString()} words visible / ${totalWordCount.toLocaleString()} words total (${readingSpeedWpm} wpm)`}
        >
          Reading: <strong>{visibleTime}</strong> / {totalTime}
        </span>
        {activeLanguage && (
          <>
            <span>|</span>
            <span
              className={cn(
                "font-medium",
                isDark ? "text-violet-400" : "text-violet-700",
              )}
            >
              Lang: {activeLanguage}
            </span>
          </>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-3 shrink-0">
        <span className="hidden md:flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>ELK Engine</span>
        </span>
        <span className="hidden md:inline">|</span>
        <span
          className={cn(
            "font-sans font-medium",
            isDark ? "text-violet-400" : "text-violet-700",
          )}
        >
          {displayVariantName}
        </span>
      </div>
    </footer>
  );
}
