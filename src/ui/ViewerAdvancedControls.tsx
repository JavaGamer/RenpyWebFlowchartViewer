import {
  LayoutGrid,
  LocateFixed,
  Palette,
  SlidersHorizontal,
} from "lucide-react";
import type {
  CanvasNode,
  ConditionVisibilityMode,
  EdgeKindFilter,
  LayoutDensity,
  LayoutDirection,
  ThemeName,
} from "../domain/index.ts";

import {
  CONTROL_BUTTON_CLASS,
  CONTROL_INPUT_CLASS,
  MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES,
} from "./viewerConstants.ts";
import type { MockFlagValue } from "../domain/index.ts";
import { cn } from "./utils/cn.ts";

export interface ViewerAdvancedControlsProps {
  layoutDirection: LayoutDirection;
  setLayoutDirection: (dir: LayoutDirection) => void;
  layoutDensity: LayoutDensity;
  setLayoutDensity: (density: LayoutDensity) => void;
  onRelayout: () => void;

  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;

  focusNodeId: string;
  setFocusNodeId: (id: string) => void;
  labels: string[];
  onFocusSelectedNode: () => void;
  focusTargetNode: CanvasNode | undefined;

  showCallReturns: boolean;
  setShowCallReturns: (v: boolean) => void;
  showAudioAssetCues: boolean;
  setShowAudioAssetCues: (v: boolean) => void;
  showMediaCuesInDialogue: boolean;
  setShowMediaCuesInDialogue: (v: boolean) => void;
  minimapPannable: boolean;
  setMinimapPannable: (v: boolean) => void;
  minimapZoomable: boolean;
  setMinimapZoomable: (v: boolean) => void;
  largeGraphMode: boolean;
  largeGraphModeOverride: boolean | null;
  setLargeGraphModeOverride: (v: boolean | null) => void;
  largeGraphModeStatusText: string;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
  setEdgeKindVisible: (kind: EdgeKindFilter, visible: boolean) => void;

  chapters: string[];
  collapsedChapters: Record<string, boolean>;
  toggleChapter: (chapter: string) => void;

  collapsedLabelCount: number;
  labelSubgraphSearchInput: string;
  setLabelSubgraphSearchInput: (v: string) => void;
  visibleSubgraphLabels: string[];
  visibleLabelSubgraphToggles: string[];
  shouldShowAllLabelSubgraphToggles: boolean;
  collapsedParentLabels: Record<string, boolean>;
  toggleParentLabel: (label: string) => void;
  setAllVisibleSubgraphLabelsCollapsed: (collapsed: boolean) => void;
  toggleShowAllLabelSubgraphToggles: () => void;
  discoveredFlags: string[];
  mockFlags: Record<string, MockFlagValue>;
  setMockFlag: (flag: string, value: MockFlagValue) => void;
  resetMockFlags: () => void;
  conditionVisibilityMode: ConditionVisibilityMode;
  setConditionVisibilityMode: (mode: ConditionVisibilityMode) => void;
}

export function ViewerAdvancedControls({
  layoutDirection,
  setLayoutDirection,
  layoutDensity,
  setLayoutDensity,
  onRelayout,
  theme,
  setTheme,
  focusNodeId,
  setFocusNodeId,
  labels,
  onFocusSelectedNode,
  focusTargetNode,
  showCallReturns,
  setShowCallReturns,
  showAudioAssetCues,
  setShowAudioAssetCues,
  showMediaCuesInDialogue,
  setShowMediaCuesInDialogue,
  minimapPannable,
  setMinimapPannable,
  minimapZoomable,
  setMinimapZoomable,
  largeGraphMode,
  largeGraphModeOverride,
  setLargeGraphModeOverride,
  largeGraphModeStatusText,
  visibleEdgeKinds,
  setEdgeKindVisible,
  chapters,
  collapsedChapters,
  toggleChapter,
  collapsedLabelCount,
  labelSubgraphSearchInput,
  setLabelSubgraphSearchInput,
  visibleSubgraphLabels,
  visibleLabelSubgraphToggles,
  shouldShowAllLabelSubgraphToggles,
  collapsedParentLabels,
  toggleParentLabel,
  setAllVisibleSubgraphLabelsCollapsed,
  toggleShowAllLabelSubgraphToggles,
  discoveredFlags,
  mockFlags,
  setMockFlag,
  resetMockFlags,
  conditionVisibilityMode,
  setConditionVisibilityMode,
}: ViewerAdvancedControlsProps) {
  const isDark = theme === "dark";

  return (
    <div
      id="viewer-advanced-controls"
      className="flex flex-col gap-5"
      role="group"
      aria-label="Advanced controls"
    >
      {/* Section 1: Layout and focus controls */}
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
              isDark ? "text-slate-300" : "text-gray-700",
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
              isDark ? "text-slate-300" : "text-gray-700",
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
              isDark ? "text-slate-300" : "text-gray-700",
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
              isDark ? "text-slate-300" : "text-gray-700",
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

      {/* Section 2: Graph filters */}
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
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Show call returns"
              />
              <span
                className={cn(
                  "font-medium",
                  isDark ? "text-slate-350" : "text-gray-700",
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
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Show media cues"
              />
              <span
                className={cn(
                  "font-medium",
                  isDark ? "text-slate-350" : "text-gray-700",
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
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Show Media Cues in Dialogue"
              />
              <span
                className={cn(
                  "font-medium",
                  isDark ? "text-slate-350" : "text-gray-700",
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
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Enable minimap panning"
              />
              <span
                className={cn(
                  "font-medium",
                  isDark ? "text-slate-350" : "text-gray-700",
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
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Enable minimap zooming"
              />
              <span
                className={cn(
                  "font-medium",
                  isDark ? "text-slate-350" : "text-gray-700",
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
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Enable large graph mode"
              />
              <span
                className={cn(
                  "font-medium mr-1",
                  isDark ? "text-slate-350" : "text-gray-700",
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
                      ? "bg-slate-850 border-slate-700 text-slate-300 hover:bg-slate-750"
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
                ? "text-slate-400 border-slate-750"
                : "text-gray-500 border-gray-105",
            )}
            role="status"
            aria-live="polite"
          >
            Status: {largeGraphModeStatusText}
          </div>

          <div
            className={cn(
              "flex flex-col gap-2 border-t pt-2",
              isDark ? "border-slate-750" : "border-gray-105",
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
                    className="rounded text-violet-600 focus:ring-violet-500 w-3.5 h-3.5"
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

      {/* Section 3: Subgraphs */}
      {(chapters.length > 0 || labels.length > 0) && (
        <div
          className="flex flex-col gap-2"
          role="group"
          aria-label="Chapter and label subgraph filters"
        >
          <h3
            className={cn(
              "text-[11px] font-bold uppercase tracking-wider",
              isDark ? "text-slate-500" : "text-gray-400",
            )}
          >
            Subgraphs
          </h3>
          <div
            className={cn(
              "flex flex-col gap-3.5 p-3 rounded-lg border text-xs",
              isDark
                ? "bg-slate-800/40 border-slate-700/60"
                : "bg-gray-50/50 border-gray-100",
            )}
          >
            {chapters.length > 0 && (
              <div className="flex flex-col gap-2">
                <span
                  className={cn(
                    "font-semibold text-xs",
                    isDark ? "text-slate-350" : "text-gray-700",
                  )}
                >
                  Chapter Subgraphs
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {chapters.map((chapter) => (
                    <button
                      key={chapter}
                      onClick={() => toggleChapter(chapter)}
                      className={cn(
                        CONTROL_BUTTON_CLASS,
                        "cursor-pointer transition-colors",
                        isDark
                          ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-100",
                      )}
                      aria-label={`${
                        collapsedChapters[chapter] ? "Expand" : "Collapse"
                      } chapter ${chapter}`}
                    >
                      {collapsedChapters[chapter] ? "▸" : "▾"} {chapter}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {labels.length > 0 && (
              <div
                className={cn(
                  "flex flex-col gap-2.5 border-t pt-2.5",
                  isDark ? "border-slate-750" : "border-gray-105",
                )}
              >
                <div className="flex justify-between items-center">
                  <span
                    className={cn(
                      "font-semibold text-xs",
                      isDark ? "text-slate-300" : "text-gray-700",
                    )}
                  >
                    Label Subgraphs
                  </span>
                  <span
                    className={cn(
                      "text-[11px]",
                      isDark ? "text-slate-450" : "text-gray-500",
                    )}
                    aria-live="polite"
                  >
                    {collapsedLabelCount} collapsed
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    id="label-subgraph-filter"
                    type="search"
                    value={labelSubgraphSearchInput}
                    onChange={(e) =>
                      setLabelSubgraphSearchInput(e.target.value)}
                    placeholder="Filter labels"
                    aria-label="Filter label subgraphs"
                    className={cn(
                      "flex-1 min-w-0",
                      CONTROL_INPUT_CLASS,
                      isDark
                        ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                        : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setAllVisibleSubgraphLabelsCollapsed(true)}
                    disabled={visibleSubgraphLabels.length === 0}
                    className={cn(
                      CONTROL_BUTTON_CLASS,
                      "cursor-pointer",
                      isDark
                        ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                    )}
                    aria-label="Collapse all visible label subgraphs"
                  >
                    Collapse all
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllVisibleSubgraphLabelsCollapsed(false)}
                    disabled={visibleSubgraphLabels.length === 0}
                    className={cn(
                      CONTROL_BUTTON_CLASS,
                      "cursor-pointer",
                      isDark
                        ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                    )}
                    aria-label="Expand all visible label subgraphs"
                  >
                    Expand all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {visibleSubgraphLabels.length === 0
                    ? (
                      <span
                        className={cn(
                          "text-[11px]",
                          isDark ? "text-slate-450" : "text-gray-500",
                        )}
                      >
                        No labels match the filter.
                      </span>
                    )
                    : (
                      <>
                        {visibleLabelSubgraphToggles.map((label) => (
                          <button
                            key={label}
                            onClick={() => toggleParentLabel(label)}
                            className={cn(
                              CONTROL_BUTTON_CLASS,
                              "cursor-pointer",
                              isDark
                                ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                            )}
                            aria-label={`${
                              collapsedParentLabels[label]
                                ? "Expand"
                                : "Collapse"
                            } label ${label}`}
                          >
                            {collapsedParentLabels[label] ? "▸" : "▾"} {label}
                          </button>
                        ))}
                        {visibleSubgraphLabels.length >
                            MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES && (
                          <button
                            type="button"
                            onClick={toggleShowAllLabelSubgraphToggles}
                            className={cn(
                              CONTROL_BUTTON_CLASS,
                              "cursor-pointer",
                              isDark
                                ? "bg-violet-950/40 text-violet-300 hover:bg-violet-950/80 border-violet-800/80"
                                : "bg-violet-50 text-violet-700 hover:bg-violet-100 border-violet-200",
                            )}
                            aria-label={shouldShowAllLabelSubgraphToggles
                              ? "Show fewer label subgraph toggles"
                              : `Show ${
                                Math.max(
                                  visibleSubgraphLabels.length -
                                    MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES,
                                  0,
                                )
                              } more label subgraph toggles`}
                          >
                            {shouldShowAllLabelSubgraphToggles
                              ? "Show fewer"
                              : `Show ${
                                Math.max(
                                  visibleSubgraphLabels.length -
                                    MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES,
                                  0,
                                )
                              } more`}
                          </button>
                        )}
                      </>
                    )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 4: Conditional simulation */}
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
                onChange={(e) => setConditionVisibilityMode(
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
    </div>
  );
}
