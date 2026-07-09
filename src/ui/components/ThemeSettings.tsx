import { useShallow } from "zustand/react/shallow";
import { useViewerStore } from "../../application/index.ts";
import { CONTROL_BUTTON_CLASS } from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";

export interface ThemeSettingsProps {
  largeGraphMode: boolean;
  largeGraphModeStatusText: string;
}

export function ThemeSettings({
  largeGraphMode,
  largeGraphModeStatusText,
}: ThemeSettingsProps) {
  const {
    theme,
    showCallReturns,
    showAudioAssetCues,
    showMediaCuesInDialogue,
    minimapPannable,
    minimapZoomable,
    largeGraphModeOverride,
    visibleEdgeKinds,
    setShowCallReturns,
    setShowAudioAssetCues,
    setShowMediaCuesInDialogue,
    setMinimapPannable,
    setMinimapZoomable,
    setLargeGraphModeOverride,
    setEdgeKindVisible,
  } = useViewerStore(
    useShallow((s) => ({
      theme: s.theme,
      showCallReturns: s.showCallReturns,
      showAudioAssetCues: s.showAudioAssetCues,
      showMediaCuesInDialogue: s.showMediaCuesInDialogue,
      minimapPannable: s.minimapPannable,
      minimapZoomable: s.minimapZoomable,
      largeGraphModeOverride: s.largeGraphModeOverride,
      visibleEdgeKinds: s.visibleEdgeKinds,
      setShowCallReturns: s.setShowCallReturns,
      setShowAudioAssetCues: s.setShowAudioAssetCues,
      setShowMediaCuesInDialogue: s.setShowMediaCuesInDialogue,
      setMinimapPannable: s.setMinimapPannable,
      setMinimapZoomable: s.setMinimapZoomable,
      setLargeGraphModeOverride: s.setLargeGraphModeOverride,
      setEdgeKindVisible: s.setEdgeKindVisible,
    })),
  );

  const isDark = theme === "dark";

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Advanced graph filters"
    >
      <h3
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          isDark ? "text-slate-500" : "text-gray-400",
        )}
      >
        Graph Filters
      </h3>
      <div
        className={cn(
          "flex flex-col gap-3.5 p-3 rounded-lg border text-xs",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showCallReturns}
              onChange={(e) => setShowCallReturns(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Show call returns"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Show call returns
            </span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAudioAssetCues}
              onChange={(e) => setShowAudioAssetCues(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Show media cues"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Show media cues
            </span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showMediaCuesInDialogue}
              onChange={(e) => setShowMediaCuesInDialogue(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Show Media Cues in Dialogue"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Show Media Cues in Dialogue
            </span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={minimapPannable}
              onChange={(e) => setMinimapPannable(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Enable minimap panning"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Enable minimap panning
            </span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={minimapZoomable}
              onChange={(e) => setMinimapZoomable(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Enable minimap zooming"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Enable minimap zooming
            </span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none col-span-2">
            <input
              type="checkbox"
              checked={largeGraphMode}
              onChange={(e) => setLargeGraphModeOverride(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Enable large graph mode"
            />
            <span
              className={cn(
                "font-medium mr-1",
                isDark ? "text-slate-355" : "text-gray-700",
              )}
            >
              Large graph mode
            </span>
            {largeGraphModeOverride !== null && (
              <button
                type="button"
                className={cn(
                  CONTROL_BUTTON_CLASS,
                  "py-0.5 px-1.5 ml-auto text-[10px] cursor-pointer",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                )}
                onClick={() => setLargeGraphModeOverride(null)}
                aria-label="Use automatic large graph mode"
              >
                Use auto
              </button>
            )}
          </label>
        </div>

        <div
          className={cn(
            "text-[11px] border-t pt-2",
            isDark
              ? "text-slate-400 border-slate-700"
              : "text-gray-500 border-gray-100",
          )}
          role="status"
          aria-live="polite"
        >
          Status: {largeGraphModeStatusText}
        </div>

        <div
          className={cn(
            "flex flex-col gap-2 border-t pt-2",
            isDark ? "border-slate-700" : "border-gray-100",
          )}
        >
          <span
            className={cn(
              "font-semibold text-xs",
              isDark ? "text-slate-300" : "text-gray-700",
            )}
          >
            Visible Edge Kinds
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(["sequence", "jump", "call", "call_return"] as const).map((
              kind,
            ) => (
              <label
                key={kind}
                className="inline-flex items-center gap-2 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={visibleEdgeKinds[kind]}
                  onChange={(e) => setEdgeKindVisible(kind, e.target.checked)}
                  className="rounded text-violet-600 focus:ring-violet-500 w-3.5 h-3.5 cursor-pointer"
                  aria-label={`Show ${kind.replace("_", " ")} edges`}
                />
                <span
                  className={cn(
                    "text-[11px] capitalize",
                    isDark ? "text-slate-400" : "text-gray-600",
                  )}
                >
                  {kind.replace("_", " ")}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
