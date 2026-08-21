import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { BarChart3, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useViewerStore } from "../../application/index.ts";
import { cn } from "../utils/cn.ts";
import type { HighlightedRoute } from "../../domain/index.ts";

export interface ActiveRouteBannerProps {
  onFocusNode?: (nodeId: string) => void;
}

interface BannerContentProps {
  route: HighlightedRoute;
  onFocusNode?: (nodeId: string) => void;
  isDark: boolean;
  onClear: () => void;
  onOpenAnalytics: () => void;
}

function ActiveRouteBannerContent({
  route,
  onFocusNode,
  isDark,
  onClear,
  onOpenAnalytics,
}: BannerContentProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  const isModalOpen = useViewerStore((s) => s.isAnalyticsModalOpen);

  // Focus the first node once on mount
  useEffect(() => {
    if (route.nodeIds.length > 0 && onFocusNode) {
      onFocusNode(route.nodeIds[0]!);
    }
  }, [route, onFocusNode]);

  // Keyboard shortcut: Esc to clear route highlight (only when not interacting with modals/inputs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isModalOpen) {
        const target = e.target as HTMLElement | null;
        const isInput = target && (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable
        );
        if (!isInput) {
          onClear();
        }
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [onClear, isModalOpen]);

  const handlePrevStep = useCallback(() => {
    if (route.nodeIds.length === 0) return;
    const prevIdx = Math.max(0, currentStepIdx - 1);
    setCurrentStepIdx(prevIdx);
    onFocusNode?.(route.nodeIds[prevIdx]!);
  }, [currentStepIdx, route.nodeIds, onFocusNode]);

  const handleNextStep = useCallback(() => {
    if (route.nodeIds.length === 0) return;
    const nextIdx = Math.min(route.nodeIds.length - 1, currentStepIdx + 1);
    setCurrentStepIdx(nextIdx);
    onFocusNode?.(route.nodeIds[nextIdx]!);
  }, [currentStepIdx, route.nodeIds, onFocusNode]);

  if (route.nodeIds.length === 0) return null;

  const totalSteps = route.nodeIds.length;
  const currentNodeId = route.nodeIds[currentStepIdx];

  return (
    <aside
      aria-label="Active route playback and step controls"
      className={cn(
        "absolute top-4 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 rounded-xl shadow-2xl border backdrop-blur-md transition-all duration-200 animate-fade-in",
        isDark
          ? "bg-slate-900/90 border-violet-800 text-slate-100 shadow-violet-950/40"
          : "bg-white/95 border-violet-300 text-gray-900 shadow-violet-500/10",
      )}
    >
      <div className="flex items-center gap-2 border-r pr-2 sm:pr-3 border-violet-200 dark:border-violet-800">
        <span className="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse" />
        <span className="text-xs font-bold font-mono tracking-tight text-violet-600 dark:text-violet-400">
          Route
        </span>
        <span
          className="text-xs font-semibold max-w-[140px] sm:max-w-[220px] truncate"
          title={route.endingLabel}
        >
          → {route.endingLabel}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
        <span className="font-mono font-medium">
          Step {currentStepIdx + 1}/{totalSteps}
        </span>
        <span className="hidden sm:inline font-mono opacity-80">
          ({currentNodeId})
        </span>
        <span className="hidden md:inline">·</span>
        <span className="hidden md:inline font-mono">
          {route.formattedReadingTime} (~{route.totalWords.toLocaleString()}
          {" "}
          words)
        </span>
      </div>

      <div className="flex items-center gap-1 ml-auto">
        <button
          type="button"
          onClick={handlePrevStep}
          disabled={currentStepIdx <= 0}
          className={cn(
            "p-1 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer",
            isDark
              ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100",
          )}
          aria-label="Previous step in route"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={handleNextStep}
          disabled={currentStepIdx >= totalSteps - 1}
          className={cn(
            "p-1 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer",
            isDark
              ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100",
          )}
          aria-label="Next step in route"
        >
          <ChevronRight size={14} />
        </button>

        <button
          type="button"
          onClick={onOpenAnalytics}
          className={cn(
            "flex items-center gap-1 text-xs px-2 py-1 rounded border ml-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 cursor-pointer",
            isDark
              ? "bg-violet-950/60 border-violet-800 text-violet-300 hover:bg-violet-900/80"
              : "bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100",
          )}
          title="Open Narrative & Ending Analytics"
        >
          <BarChart3 size={12} />
          <span className="hidden sm:inline">Analytics</span>
        </button>

        <button
          type="button"
          onClick={onClear}
          className={cn(
            "p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 cursor-pointer",
          )}
          aria-label="Clear route highlight (Esc)"
          title="Clear route highlight (Esc)"
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}

export function ActiveRouteBanner({ onFocusNode }: ActiveRouteBannerProps) {
  const {
    highlightedRoute,
    clearHighlightedRoute,
    setAnalyticsModalOpen,
    theme,
  } = useViewerStore(
    useShallow((s) => ({
      highlightedRoute: s.highlightedRoute,
      clearHighlightedRoute: s.clearHighlightedRoute,
      setAnalyticsModalOpen: s.setAnalyticsModalOpen,
      theme: s.theme,
    })),
  );

  const isDark = theme === "dark";

  if (!highlightedRoute) return null;

  return (
    <ActiveRouteBannerContent
      key={highlightedRoute.routeId}
      route={highlightedRoute}
      onFocusNode={onFocusNode}
      isDark={isDark}
      onClear={clearHighlightedRoute}
      onOpenAnalytics={() => setAnalyticsModalOpen(true)}
    />
  );
}
