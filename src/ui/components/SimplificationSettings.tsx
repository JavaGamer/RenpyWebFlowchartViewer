import { useShallow } from "zustand/react/shallow";
import { useViewerStore } from "../../application/index.ts";
import { CONTROL_INPUT_CLASS } from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";

export function SimplificationSettings() {
  const {
    theme,
    simplifyCollapseLinearChains,
    simplifyInlineUtilities,
    simplifyInlineDetours,
    simplifyInlineStateToggles,
    simplifyInlineEmptyLabels,
    simplifyInlineDialogueThreshold,
    setSimplifyCollapseLinearChains,
    setSimplifyInlineUtilities,
    setSimplifyInlineDetours,
    setSimplifyInlineStateToggles,
    setSimplifyInlineEmptyLabels,
    setSimplifyInlineDialogueThreshold,
  } = useViewerStore(
    useShallow((s) => ({
      theme: s.theme,
      simplifyCollapseLinearChains: s.simplifyCollapseLinearChains,
      simplifyInlineUtilities: s.simplifyInlineUtilities,
      simplifyInlineDetours: s.simplifyInlineDetours,
      simplifyInlineStateToggles: s.simplifyInlineStateToggles,
      simplifyInlineEmptyLabels: s.simplifyInlineEmptyLabels,
      simplifyInlineDialogueThreshold: s.simplifyInlineDialogueThreshold,
      setSimplifyCollapseLinearChains: s.setSimplifyCollapseLinearChains,
      setSimplifyInlineUtilities: s.setSimplifyInlineUtilities,
      setSimplifyInlineDetours: s.setSimplifyInlineDetours,
      setSimplifyInlineStateToggles: s.setSimplifyInlineStateToggles,
      setSimplifyInlineEmptyLabels: s.setSimplifyInlineEmptyLabels,
      setSimplifyInlineDialogueThreshold: s.setSimplifyInlineDialogueThreshold,
    })),
  );

  const isDark = theme === "dark";

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Graph simplification settings"
    >
      <h3
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          isDark ? "text-slate-500" : "text-gray-400",
        )}
      >
        Simplify Graph
      </h3>
      <div
        className={cn(
          "flex flex-col gap-3 p-3 rounded-lg border text-xs",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        <div className="flex flex-col gap-2.5">
          <label
            className="inline-flex items-center gap-2 cursor-pointer select-none"
            title="Collapses consecutive label nodes that flow 1-to-1 without choices into a single node."
          >
            <input
              type="checkbox"
              checked={simplifyCollapseLinearChains}
              onChange={(e) =>
                setSimplifyCollapseLinearChains(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Collapse linear label chains"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Collapse linear chains
            </span>
          </label>

          <label
            className="inline-flex items-center gap-2 cursor-pointer select-none"
            title="Hides and bypasses labels classified as utility subroutines (shared cutscenes, system helpers)."
          >
            <input
              type="checkbox"
              checked={simplifyInlineUtilities}
              onChange={(e) => setSimplifyInlineUtilities(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Inline utility subroutines"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Inline utility labels
            </span>
          </label>

          <label
            className="inline-flex items-center gap-2 cursor-pointer select-none"
            title="Hides and bypasses detour labels called from menus that return back to the menu."
          >
            <input
              type="checkbox"
              checked={simplifyInlineDetours}
              onChange={(e) => setSimplifyInlineDetours(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Inline detour subroutines"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Inline detour labels
            </span>
          </label>

          <label
            className="inline-flex items-center gap-2 cursor-pointer select-none"
            title="Hides and bypasses labels representing side-effect logic (variable updates, flags) with no story flow."
          >
            <input
              type="checkbox"
              checked={simplifyInlineStateToggles}
              onChange={(e) => setSimplifyInlineStateToggles(e.target.checked)}
              className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
              aria-label="Inline state-toggle subroutines"
            />
            <span
              className={cn(
                "font-medium",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
            >
              Inline state-toggle labels
            </span>
          </label>

          <div
            className={cn(
              "flex flex-col gap-2 pt-2 border-t",
              isDark ? "border-slate-700" : "border-gray-100",
            )}
          >
            <label
              className="inline-flex items-center gap-2 cursor-pointer select-none"
              title="Hides and bypasses label nodes containing fewer dialogue lines than the specified threshold."
            >
              <input
                type="checkbox"
                checked={simplifyInlineEmptyLabels}
                onChange={(e) => setSimplifyInlineEmptyLabels(e.target.checked)}
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
                aria-label="Inline empty/low-dialogue labels"
              />
              <span
                className={cn(
                  "font-medium",
                  isDark ? "text-slate-355" : "text-gray-700",
                )}
              >
                Inline empty/low-dialogue labels
              </span>
            </label>

            {simplifyInlineEmptyLabels && (
              <div className="flex items-center gap-2 pl-6 mt-1">
                <span
                  className={cn(isDark ? "text-slate-400" : "text-gray-500")}
                >
                  Threshold (&lt; N lines):
                </span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={simplifyInlineDialogueThreshold}
                  onChange={(e) =>
                    setSimplifyInlineDialogueThreshold(
                      Math.max(1, parseInt(e.target.value) || 1),
                    )}
                  className={cn(
                    CONTROL_INPUT_CLASS,
                    "w-14 px-1.5 py-0.5 text-center",
                  )}
                  aria-label="Dialogue line threshold for inlining"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
