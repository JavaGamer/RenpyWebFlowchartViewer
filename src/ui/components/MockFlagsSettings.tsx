import { useShallow } from "zustand/react/shallow";
import type {
  ConditionVisibilityMode,
  MockFlagValue,
} from "../../domain/index.ts";
import { useViewerStore } from "../../application/index.ts";
import {
  CONTROL_BUTTON_CLASS,
  CONTROL_INPUT_CLASS,
} from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";

export interface MockFlagsSettingsProps {
  discoveredFlags: string[];
}

export function MockFlagsSettings({ discoveredFlags }: MockFlagsSettingsProps) {
  const {
    theme,
    conditionVisibilityMode,
    mockFlags,
    setConditionVisibilityMode,
    setMockFlag,
    resetMockFlags,
  } = useViewerStore(
    useShallow((s) => ({
      theme: s.theme,
      conditionVisibilityMode: s.conditionVisibilityMode,
      mockFlags: s.mockFlags,
      setConditionVisibilityMode: s.setConditionVisibilityMode,
      setMockFlag: s.setMockFlag,
      resetMockFlags: s.resetMockFlags,
    })),
  );

  const isDark = theme === "dark";

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Mock state simulation controls"
    >
      <h3
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          isDark ? "text-slate-500" : "text-gray-400",
        )}
      >
        Conditional Simulation
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
          <label
            className={cn(
              "text-xs flex flex-col gap-1 font-medium",
              isDark ? "text-slate-355" : "text-gray-700",
            )}
          >
            Unreachable paths
            <select
              id="condition-visibility-mode"
              value={conditionVisibilityMode}
              onChange={(e) =>
                setConditionVisibilityMode(
                  e.target.value as ConditionVisibilityMode,
                )}
              className={cn(
                CONTROL_INPUT_CLASS,
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
              )}
              aria-label="Unreachable condition path visibility mode"
            >
              <option value="fade">Fade</option>
              <option value="hide">Hide</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={resetMockFlags}
              className={cn(
                CONTROL_BUTTON_CLASS,
                "cursor-pointer w-full py-1.5",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
              aria-label="Reset mock flag state"
            >
              Reset flags
            </button>
          </div>
        </div>
        <div
          className={cn(
            "flex flex-col gap-2 border-t pt-2.5",
            isDark ? "border-slate-750" : "border-gray-105",
          )}
        >
          <span
            className={cn(
              "font-semibold text-xs",
              isDark ? "text-slate-300" : "text-gray-700",
            )}
          >
            Condition Flags
          </span>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {discoveredFlags.length === 0
              ? (
                <span
                  className={cn(
                    "text-[11px]",
                    isDark ? "text-slate-450" : "text-gray-500",
                  )}
                >
                  No condition flags discovered.
                </span>
              )
              : (
                discoveredFlags.map((flag) => (
                  <label
                    key={flag}
                    className={cn(
                      "flex items-center justify-between gap-1.5 text-xs border rounded px-2 py-1",
                      isDark
                        ? "bg-slate-800 border-slate-700/60 text-slate-200"
                        : "bg-white border-gray-100 text-gray-700",
                    )}
                  >
                    <span
                      className="truncate flex-1 font-medium"
                      title={flag}
                    >
                      {flag}
                    </span>
                    <select
                      value={mockFlags[flag] ?? "unknown"}
                      onChange={(e) =>
                        setMockFlag(flag, e.target.value as MockFlagValue)}
                      className={cn(
                        "px-1 py-0.5 border rounded text-[11px] shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1",
                        isDark
                          ? "bg-slate-700 border-slate-600 text-slate-100 focus-visible:ring-violet-400"
                          : "bg-gray-50 border-gray-300 text-gray-750 focus-visible:ring-violet-500",
                      )}
                      aria-label={`Mock value for ${flag}`}
                    >
                      <option value="unknown">unknown</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </label>
                ))
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
