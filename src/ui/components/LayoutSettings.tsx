import { LayoutGrid, LocateFixed, Palette, SlidersHorizontal } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { CanvasNode, LayoutDensity, LayoutDirection, ThemeName } from "../../domain/index.ts";
import { useViewerStore } from "../../application/index.ts";
import { CONTROL_BUTTON_CLASS, CONTROL_INPUT_CLASS } from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";

export interface LayoutSettingsProps {
  onRelayout: () => void;
  onFocusSelectedNode: () => void;
  focusTargetNode: CanvasNode | undefined;
  labels: string[];
}

export function LayoutSettings({
  onRelayout,
  onFocusSelectedNode,
  focusTargetNode,
  labels,
}: LayoutSettingsProps) {
  const {
    layoutDirection,
    layoutDensity,
    theme,
    focusNodeId,
    setLayoutDirection,
    setLayoutDensity,
    setTheme,
    setFocusNodeId,
  } = useViewerStore(
    useShallow((s) => ({
      layoutDirection: s.layoutDirection,
      layoutDensity: s.layoutDensity,
      theme: s.theme,
      focusNodeId: s.focusNodeId,
      setLayoutDirection: s.setLayoutDirection,
      setLayoutDensity: s.setLayoutDensity,
      setTheme: s.setTheme,
      setFocusNodeId: s.setFocusNodeId,
    })),
  );

  const isDark = theme === "dark";

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Layout and focus controls"
    >
      <h3
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          isDark ? "text-slate-500" : "text-gray-400",
        )}
      >
        Layout & Focus
      </h3>
      <div
        className={cn(
          "grid grid-cols-3 gap-2 p-3 rounded-lg border",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium",
            isDark ? "text-slate-350" : "text-gray-700",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1",
              isDark ? "text-slate-400" : "text-gray-600",
            )}
          >
            <LayoutGrid size={13} aria-hidden="true" />
            Direction
          </span>
          <select
            value={layoutDirection}
            onChange={(e) =>
              setLayoutDirection(e.target.value as LayoutDirection)}
            aria-label="Auto layout direction"
            className={cn(
              CONTROL_INPUT_CLASS,
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
            )}
          >
            <option value="TB">Top-Bottom</option>
            <option value="LR">Left-Right</option>
          </select>
        </label>
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium",
            isDark ? "text-slate-350" : "text-gray-700",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1",
              isDark ? "text-slate-400" : "text-gray-600",
            )}
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            Density
          </span>
          <select
            value={layoutDensity}
            onChange={(e) =>
              setLayoutDensity(e.target.value as LayoutDensity)}
            aria-label="Layout density"
            className={cn(
              CONTROL_INPUT_CLASS,
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
            )}
          >
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="spacious">Spacious</option>
          </select>
        </label>
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium",
            isDark ? "text-slate-350" : "text-gray-700",
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1",
              isDark ? "text-slate-400" : "text-gray-600",
            )}
          >
            <Palette size={13} aria-hidden="true" />
            Theme
          </span>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeName)}
            aria-label="Color theme"
            className={cn(
              CONTROL_INPUT_CLASS,
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
            )}
          >
            <option value="violet">Default</option>
            <option value="highContrast">Contrast</option>
            <option value="colorblind">Colorblind</option>
            <option value="dark">Dark Mode</option>
          </select>
        </label>
        <label
          className={cn(
            "text-xs flex flex-col gap-1 font-medium col-span-3",
            isDark ? "text-slate-350" : "text-gray-700",
          )}
        >
          Focus label
          <div className="flex gap-2">
            <select
              value={focusNodeId}
              onChange={(e) => setFocusNodeId(e.target.value)}
              aria-label="Focus label"
              className={cn(
                "flex-1 min-w-0",
                CONTROL_INPUT_CLASS,
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
              )}
            >
              <option value="">Select label</option>
              {labels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onFocusSelectedNode}
              disabled={!focusNodeId}
              className={cn(
                CONTROL_BUTTON_CLASS,
                "px-3 py-1 cursor-pointer",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
              aria-label="Center selected label"
            >
              <LocateFixed
                size={12}
                className="inline mr-1"
                aria-hidden="true"
              />
              Center
            </button>
          </div>
        </label>
        <div className="col-span-2 flex justify-between items-center pt-1">
          <button
            onClick={onRelayout}
            className={cn(
              CONTROL_BUTTON_CLASS,
              "px-3 py-1 cursor-pointer",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
            )}
            aria-label="Re-run auto layout"
          >
            Re-run layout
          </button>
          <span
            className={cn(
              "text-[11px]",
              isDark ? "text-slate-400" : "text-gray-500",
            )}
            aria-live="off"
          >
            {!focusNodeId
              ? "Select a label, then center it."
              : focusTargetNode
              ? `Ready to center: ${focusNodeId}`
              : `${focusNodeId} is hidden by filters.`}
          </span>
        </div>
      </div>
    </div>
  );
}
