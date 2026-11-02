/**
 * src/ui/components/CanvasHud.tsx
 *
 * Minimalist floating HUD overlay for canvas navigation controls:
 * - Zoom in / out / fit
 * - Layout direction toggle (TB vs LR)
 * - Pacing Heatmap toggle
 */

import { Minus, Plus } from "lucide-react";
import { useViewerStore } from "../../application/index.ts";
import { cn } from "../utils/cn.ts";

export interface CanvasHudNavigationApi {
  zoomIn?: (options?: { duration?: number }) => void;
  zoomOut?: (options?: { duration?: number }) => void;
  fitView?: (options?: { duration?: number; padding?: number }) => void;
}

export interface CanvasHudProps {
  onFitView?: () => void;
  flowInstanceRef?: React.MutableRefObject<CanvasHudNavigationApi | null>;
}

export function CanvasHud({ onFitView, flowInstanceRef }: CanvasHudProps) {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";
  const layoutDirection = useViewerStore((s) => s.layoutDirection);
  const setLayoutDirection = useViewerStore((s) => s.setLayoutDirection);
  const showPacingHeatmap = useViewerStore((s) => s.showPacingHeatmap);
  const setShowPacingHeatmap = useViewerStore((s) => s.setShowPacingHeatmap);

  const handleZoomIn = () => {
    flowInstanceRef?.current?.zoomIn?.({ duration: 200 });
  };

  const handleZoomOut = () => {
    flowInstanceRef?.current?.zoomOut?.({ duration: 200 });
  };

  const handleFit = () => {
    if (onFitView) {
      onFitView();
    } else {
      flowInstanceRef?.current?.fitView?.({ duration: 300, padding: 0.2 });
    }
  };

  return (
    <div
      className={cn(
        "absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs shadow-sm select-none transition-colors duration-200",
        isDark
          ? "bg-slate-900/90 border-slate-700/80 text-slate-200"
          : "bg-white/95 border-gray-300 text-gray-800",
      )}
      role="group"
      aria-label="Canvas navigation controls"
    >
      {/* Zoom Out */}
      <button
        type="button"
        onClick={handleZoomOut}
        className={cn(
          "w-6 h-6 rounded flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
          isDark
            ? "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
            : "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
        )}
        title="Zoom Out"
        aria-label="Zoom out"
      >
        <Minus size={12} aria-hidden="true" />
      </button>

      {/* Fit to View */}
      <button
        type="button"
        onClick={handleFit}
        className={cn(
          "px-1.5 h-6 rounded flex items-center justify-center font-mono text-[11px] font-medium transition-colors leading-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
          theme === "highContrast"
            ? "text-black border-black hover:bg-gray-200"
            : isDark
            ? "text-slate-300 hover:text-slate-100 hover:bg-slate-800/40"
            : "text-gray-700 hover:text-gray-900 hover:bg-gray-100",
        )}
        title="Fit canvas to view (Ctrl+L)"
        aria-label="Canvas fit to view"
        aria-keyshortcuts="Control+L Meta+L"
      >
        Fit
      </button>

      {/* Zoom In */}
      <button
        type="button"
        onClick={handleZoomIn}
        className={cn(
          "w-6 h-6 rounded flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
          isDark
            ? "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
            : "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
        )}
        title="Zoom In"
        aria-label="Zoom in"
      >
        <Plus size={12} aria-hidden="true" />
      </button>

      <span
        className={cn(
          "h-3.5 w-px mx-0.5",
          isDark ? "bg-slate-700" : "bg-gray-300",
        )}
      />

      {/* Direction: TB / LR */}
      <div
        className={cn(
          "flex items-center rounded border overflow-hidden",
          isDark ? "border-slate-700" : "border-gray-200",
        )}
      >
        <button
          type="button"
          onClick={() => setLayoutDirection("TB")}
          aria-pressed={layoutDirection === "TB"}
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-mono font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
            layoutDirection === "TB"
              ? "bg-violet-600 text-white"
              : (isDark
                ? "text-slate-400 hover:text-slate-200"
                : "text-gray-500 hover:text-gray-800"),
          )}
          title="Top to Bottom layout"
          aria-label="Top to Bottom layout"
        >
          TB
        </button>
        <button
          type="button"
          onClick={() => setLayoutDirection("LR")}
          aria-pressed={layoutDirection === "LR"}
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-mono font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500",
            layoutDirection === "LR"
              ? "bg-violet-600 text-white"
              : (isDark
                ? "text-slate-400 hover:text-slate-200"
                : "text-gray-500 hover:text-gray-800"),
          )}
          title="Left to Right layout"
          aria-label="Left to Right layout"
        >
          LR
        </button>
      </div>

      <span
        className={cn(
          "h-3.5 w-px mx-0.5",
          isDark ? "bg-slate-700" : "bg-gray-300",
        )}
      />

      {/* Pacing Heatmap Toggle */}
      <label
        className={cn(
          "flex items-center gap-1.5 cursor-pointer text-[11px] select-none transition-colors",
          isDark
            ? "text-slate-300 hover:text-white"
            : "text-gray-700 hover:text-gray-900",
        )}
      >
        <input
          type="checkbox"
          checked={showPacingHeatmap}
          onChange={(e) => setShowPacingHeatmap(e.target.checked)}
          className="rounded text-violet-600 w-3.5 h-3.5 cursor-pointer"
          aria-label="Toggle pacing heatmap"
        />
        <span className="text-[11px] font-sans">Heatmap</span>
      </label>
    </div>
  );
}
