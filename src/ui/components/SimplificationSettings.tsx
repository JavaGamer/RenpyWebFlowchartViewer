import { useShallow } from "zustand/react/shallow";
import { useViewerStore } from "../../application/index.ts";
import { CONTROL_INPUT_CLASS } from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";
import { SectionHeader, Toggle } from "../primitives/index.ts";

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
      <SectionHeader title="Simplify Graph" isDark={isDark} />
      <div
        className={cn(
          "flex flex-col gap-3 p-3 rounded-lg border text-xs",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        <div className="flex flex-col gap-2.5">
          <Toggle
            checked={simplifyCollapseLinearChains}
            onChange={setSimplifyCollapseLinearChains}
            label="Collapse linear chains"
            title="Collapses consecutive label nodes that flow 1-to-1 without choices into a single node."
            isDark={isDark}
          />

          <Toggle
            checked={simplifyInlineUtilities}
            onChange={setSimplifyInlineUtilities}
            label="Inline utility labels"
            title="Hides and bypasses labels classified as utility subroutines (shared cutscenes, system helpers)."
            isDark={isDark}
          />

          <Toggle
            checked={simplifyInlineDetours}
            onChange={setSimplifyInlineDetours}
            label="Inline detour labels"
            title="Hides and bypasses detour labels called from menus that return back to the menu."
            isDark={isDark}
          />

          <Toggle
            checked={simplifyInlineStateToggles}
            onChange={setSimplifyInlineStateToggles}
            label="Inline state-toggle labels"
            title="Hides and bypasses labels representing side-effect logic (variable updates, flags) with no story flow."
            isDark={isDark}
          />

          <div
            className={cn(
              "flex flex-col gap-2 pt-2 border-t",
              isDark ? "border-slate-700" : "border-gray-100",
            )}
          >
            <Toggle
              checked={simplifyInlineEmptyLabels}
              onChange={setSimplifyInlineEmptyLabels}
              label="Inline empty/low-dialogue labels"
              title="Hides and bypasses label nodes containing fewer dialogue lines than the specified threshold."
              isDark={isDark}
            />

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
