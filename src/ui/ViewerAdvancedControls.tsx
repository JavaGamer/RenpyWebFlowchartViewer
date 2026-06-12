import { LayoutGrid, Palette, LocateFixed } from 'lucide-react';
import type { CanvasNode, ConditionVisibilityMode, EdgeKindFilter, LayoutDirection, ThemeName } from '../domain';

import { CONTROL_INPUT_CLASS, CONTROL_BUTTON_CLASS, MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES } from './viewerConstants';
import type { MockFlagValue } from '../domain';

export interface ViewerAdvancedControlsProps {
  layoutDirection: LayoutDirection;
  setLayoutDirection: (dir: LayoutDirection) => void;
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
  return (
    <div id="viewer-advanced-controls" className="flex flex-col gap-5" role="group" aria-label="Advanced controls">
      {/* Section 1: Layout and focus controls */}
      <div className="flex flex-col gap-2" role="group" aria-label="Layout and focus controls">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Layout & Focus</h3>
        <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50/50 rounded-lg border border-gray-100">
          <label className="text-xs flex flex-col gap-1 font-medium text-gray-700">
            <span className="flex items-center gap-1 text-gray-600">
              <LayoutGrid size={13} aria-hidden="true" />
              Direction
            </span>
            <select
              value={layoutDirection}
              onChange={(e) => setLayoutDirection(e.target.value as LayoutDirection)}
              aria-label="Auto layout direction"
              className={CONTROL_INPUT_CLASS}
            >
              <option value="TB">Top to bottom</option>
              <option value="LR">Left to right</option>
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1 font-medium text-gray-700">
            <span className="flex items-center gap-1 text-gray-600">
              <Palette size={13} aria-hidden="true" />
              Theme
            </span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeName)}
              aria-label="Color theme"
              className={CONTROL_INPUT_CLASS}
            >
              <option value="violet">Default</option>
              <option value="highContrast">High contrast</option>
              <option value="colorblind">Colorblind-safe</option>
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1 font-medium text-gray-700 col-span-2">
            Focus label
            <div className="flex gap-2">
              <select
                value={focusNodeId}
                onChange={(e) => setFocusNodeId(e.target.value)}
                aria-label="Focus label"
                className={`flex-1 min-w-0 ${CONTROL_INPUT_CLASS}`}
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
                className={`${CONTROL_BUTTON_CLASS} px-3 py-1 cursor-pointer`}
                aria-label="Center selected label"
              >
                <LocateFixed size={12} className="inline mr-1" aria-hidden="true" />
                Center
              </button>
            </div>
          </label>
          <div className="col-span-2 flex justify-between items-center pt-1">
            <button
              onClick={onRelayout}
              className={`${CONTROL_BUTTON_CLASS} px-3 py-1 cursor-pointer`}
              aria-label="Re-run auto layout"
            >
              Re-run layout
            </button>
            <span className="text-[11px] text-gray-500" aria-live="off">
              {!focusNodeId
                ? 'Select a label, then center it.'
                : focusTargetNode
                  ? `Ready to center: ${focusNodeId}`
                  : `${focusNodeId} is hidden by filters.`}
            </span>
          </div>
        </div>
      </div>

      {/* Section 2: Graph filters */}
      <div className="flex flex-col gap-2" role="group" aria-label="Advanced graph filters">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Graph Filters</h3>
        <div className="flex flex-col gap-3.5 p-3 bg-gray-50/50 rounded-lg border border-gray-100 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showCallReturns}
                onChange={(e) => setShowCallReturns(e.target.checked)}
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Show call returns"
              />
              <span className="font-medium text-gray-700">Show call returns</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAudioAssetCues}
                onChange={(e) => setShowAudioAssetCues(e.target.checked)}
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Show media cues"
              />
              <span className="font-medium text-gray-700">Show media cues</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none col-span-2">
              <input
                type="checkbox"
                checked={largeGraphMode}
                onChange={(e) => setLargeGraphModeOverride(e.target.checked)}
                className="rounded text-violet-600 focus:ring-violet-500 w-4 h-4"
                aria-label="Enable large graph mode"
              />
              <span className="font-medium text-gray-700 mr-1">Large graph mode</span>
              {largeGraphModeOverride !== null && (
                <button
                  type="button"
                  className={`${CONTROL_BUTTON_CLASS} py-0.5 px-1.5 ml-auto text-[10px] cursor-pointer`}
                  onClick={() => setLargeGraphModeOverride(null)}
                  aria-label="Use automatic large graph mode"
                >
                  Use auto
                </button>
              )}
            </label>
          </div>
          
          <div className="text-[11px] text-gray-500 border-t border-gray-100 pt-2" role="status" aria-live="polite">
            Status: {largeGraphModeStatusText}
          </div>

          <div className="flex flex-col gap-2 border-t border-gray-100 pt-2">
            <span className="font-semibold text-gray-700 text-xs">Visible Edge Kinds</span>
            <div className="grid grid-cols-2 gap-2">
              {(['sequence', 'jump', 'call', 'call_return'] as const).map((kind) => (
                <label key={kind} className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={visibleEdgeKinds[kind]}
                    onChange={(e) => setEdgeKindVisible(kind, e.target.checked)}
                    className="rounded text-violet-600 focus:ring-violet-500 w-3.5 h-3.5"
                    aria-label={`Show ${kind.replace('_', ' ')} edges`}
                  />
                  <span className="text-gray-600 text-[11px] capitalize">{kind.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Subgraphs */}
      {(chapters.length > 0 || labels.length > 0) && (
        <div className="flex flex-col gap-2" role="group" aria-label="Chapter and label subgraph filters">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Subgraphs</h3>
          <div className="flex flex-col gap-3.5 p-3 bg-gray-50/50 rounded-lg border border-gray-100 text-xs">
            {chapters.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="font-semibold text-gray-700 text-xs">Chapter Subgraphs</span>
                <div className="flex flex-wrap gap-1.5">
                  {chapters.map((chapter) => (
                    <button
                      key={chapter}
                      onClick={() => toggleChapter(chapter)}
                      className={`${CONTROL_BUTTON_CLASS} cursor-pointer hover:bg-gray-100 transition-colors`}
                      aria-label={`${collapsedChapters[chapter] ? 'Expand' : 'Collapse'} chapter ${chapter}`}
                    >
                      {collapsedChapters[chapter] ? '▸' : '▾'} {chapter}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {labels.length > 0 && (
              <div className="flex flex-col gap-2.5 border-t border-gray-100 pt-2.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-700 text-xs">Label Subgraphs</span>
                  <span className="text-[11px] text-gray-505" aria-live="polite">
                    {collapsedLabelCount} collapsed
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    id="label-subgraph-filter"
                    type="search"
                    value={labelSubgraphSearchInput}
                    onChange={(e) => setLabelSubgraphSearchInput(e.target.value)}
                    placeholder="Filter labels"
                    aria-label="Filter label subgraphs"
                    className={`flex-1 min-w-0 ${CONTROL_INPUT_CLASS}`}
                  />
                  <button
                    type="button"
                    onClick={() => setAllVisibleSubgraphLabelsCollapsed(true)}
                    disabled={visibleSubgraphLabels.length === 0}
                    className={`${CONTROL_BUTTON_CLASS} cursor-pointer`}
                    aria-label="Collapse all visible label subgraphs"
                  >
                    Collapse all
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllVisibleSubgraphLabelsCollapsed(false)}
                    disabled={visibleSubgraphLabels.length === 0}
                    className={`${CONTROL_BUTTON_CLASS} cursor-pointer`}
                    aria-label="Expand all visible label subgraphs"
                  >
                    Expand all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {visibleSubgraphLabels.length === 0 ? (
                    <span className="text-[11px] text-gray-500">No labels match the filter.</span>
                  ) : (
                    <>
                      {visibleLabelSubgraphToggles.map((label) => (
                        <button
                          key={label}
                          onClick={() => toggleParentLabel(label)}
                          className={`${CONTROL_BUTTON_CLASS} cursor-pointer`}
                          aria-label={`${collapsedParentLabels[label] ? 'Expand' : 'Collapse'} label ${label}`}
                        >
                          {collapsedParentLabels[label] ? '▸' : '▾'} {label}
                        </button>
                      ))}
                      {visibleSubgraphLabels.length > MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES && (
                        <button
                          type="button"
                          onClick={toggleShowAllLabelSubgraphToggles}
                          className={`${CONTROL_BUTTON_CLASS} bg-violet-50 text-violet-700 hover:bg-violet-100 border-violet-200 cursor-pointer`}
                          aria-label={
                            shouldShowAllLabelSubgraphToggles
                              ? 'Show fewer label subgraph toggles'
                              : `Show ${Math.max(visibleSubgraphLabels.length - MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES, 0)} more label subgraph toggles`
                          }
                        >
                          {shouldShowAllLabelSubgraphToggles
                            ? 'Show fewer'
                            : `Show ${Math.max(visibleSubgraphLabels.length - MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES, 0)} more`}
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
      <div className="flex flex-col gap-2" role="group" aria-label="Mock state simulation controls">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Conditional Simulation</h3>
        <div className="flex flex-col gap-3.5 p-3 bg-gray-50/50 rounded-lg border border-gray-100 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs flex flex-col gap-1 font-medium text-gray-700">
              Unreachable paths
              <select
                id="condition-visibility-mode"
                value={conditionVisibilityMode}
                onChange={(e) => setConditionVisibilityMode(e.target.value as ConditionVisibilityMode)}
                className={CONTROL_INPUT_CLASS}
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
                className={`${CONTROL_BUTTON_CLASS} cursor-pointer w-full py-1.5`}
                aria-label="Reset mock flag state"
              >
                Reset flags
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-gray-100 pt-2.5">
            <span className="font-semibold text-gray-700 text-xs">Condition Flags</span>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {discoveredFlags.length === 0 ? (
                <span className="text-[11px] text-gray-500 col-span-2">No condition flags discovered.</span>
              ) : (
                discoveredFlags.map((flag) => (
                  <label key={flag} className="flex items-center justify-between gap-1.5 text-xs border border-gray-100 rounded px-2 py-1 bg-white">
                    <span className="truncate flex-1 font-medium text-gray-600" title={flag}>{flag}</span>
                    <select
                      value={mockFlags[flag] ?? 'unknown'}
                      onChange={(e) => setMockFlag(flag, e.target.value as MockFlagValue)}
                      className="px-1 py-0.5 border border-gray-300 rounded text-[11px] bg-gray-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500 shrink-0 cursor-pointer"
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
