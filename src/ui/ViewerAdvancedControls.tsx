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
    <div id="viewer-advanced-controls" className="border border-gray-200 rounded-lg p-3 flex flex-col gap-3" role="group" aria-label="Advanced controls">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Layout and focus controls">
        <label className="text-xs flex items-center gap-1">
          <LayoutGrid size={14} aria-hidden="true" />
          Layout
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
        <button
          onClick={onRelayout}
          className={CONTROL_BUTTON_CLASS}
          aria-label="Re-run auto layout"
        >
          Auto-layout
        </button>
        <label className="text-xs flex items-center gap-1 flex-wrap">
          <Palette size={14} aria-hidden="true" />
          Theme
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

        <label className="text-xs flex items-center gap-1 flex-wrap">
          Focus label
          <select
            value={focusNodeId}
            onChange={(e) => setFocusNodeId(e.target.value)}
            aria-label="Focus label"
            className={CONTROL_INPUT_CLASS}
          >
            <option value="">Select label</option>
            {labels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onFocusSelectedNode}
          disabled={!focusNodeId}
          className={CONTROL_BUTTON_CLASS}
          aria-label="Center selected label"
        >
          <LocateFixed size={12} className="inline mr-1" aria-hidden="true" />
          Center
        </button>
        <span className="text-[11px] text-gray-600" aria-live="off">
          {!focusNodeId
            ? 'Select a label, then center it in view.'
            : focusTargetNode
              ? `Ready to center: ${focusNodeId}`
              : `${focusNodeId} is hidden by current filters.`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs" role="group" aria-label="Advanced graph filters">
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={showCallReturns}
            onChange={(e) => setShowCallReturns(e.target.checked)}
            aria-label="Show call returns"
          />
          Show call returns
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={showAudioAssetCues}
            onChange={(e) => setShowAudioAssetCues(e.target.checked)}
            aria-label="Show media cues"
          />
          Show media cues
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={largeGraphMode}
            onChange={(e) => setLargeGraphModeOverride(e.target.checked)}
            aria-label="Enable large graph mode"
          />
          Large graph mode
        </label>
        {largeGraphModeOverride !== null && (
          <button
            type="button"
            className={CONTROL_BUTTON_CLASS}
            onClick={() => setLargeGraphModeOverride(null)}
            aria-label="Use automatic large graph mode"
          >
            Use auto
          </button>
        )}
        <span className="text-[11px] text-gray-600" role="status" aria-live="polite">
          {largeGraphModeStatusText}
        </span>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span>Edges</span>
          {(['sequence', 'jump', 'call', 'call_return'] as const).map((kind) => (
            <label key={kind} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={visibleEdgeKinds[kind]}
                onChange={(e) => setEdgeKindVisible(kind, e.target.checked)}
                aria-label={`Show ${kind.replace('_', ' ')} edges`}
              />
              {kind.replace('_', ' ')}
            </label>
          ))}
        </div>
      </div>
      <div className="border-t border-gray-200 pt-3 flex flex-col gap-3" role="group" aria-label="Chapter and label subgraph filters">
        {chapters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-xs">Chapter subgraphs:</span>
            {chapters.map((chapter) => (
              <button
                key={chapter}
                onClick={() => toggleChapter(chapter)}
                className={CONTROL_BUTTON_CLASS}
                aria-label={`${collapsedChapters[chapter] ? 'Expand' : 'Collapse'} chapter ${chapter}`}
              >
                {collapsedChapters[chapter] ? '▸' : '▾'} {chapter}
              </button>
            ))}
          </div>
        )}
        {labels.length > 0 && (
          <div className="flex flex-col gap-2 min-w-[18rem]" role="group" aria-label="Label subgraphs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-xs">Label subgraphs:</span>
              <span className="text-[11px] text-gray-600" aria-live="polite">
                {collapsedLabelCount} collapsed
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="label-subgraph-filter" className="sr-only">
                Filter label subgraphs
              </label>
              <input
                id="label-subgraph-filter"
                type="search"
                value={labelSubgraphSearchInput}
                onChange={(e) => setLabelSubgraphSearchInput(e.target.value)}
                placeholder="Filter labels"
                aria-label="Filter label subgraphs"
                className={CONTROL_INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => setAllVisibleSubgraphLabelsCollapsed(true)}
                disabled={visibleSubgraphLabels.length === 0}
                className={CONTROL_BUTTON_CLASS}
                aria-label="Collapse all visible label subgraphs"
              >
                Collapse all
              </button>
              <button
                type="button"
                onClick={() => setAllVisibleSubgraphLabelsCollapsed(false)}
                disabled={visibleSubgraphLabels.length === 0}
                className={CONTROL_BUTTON_CLASS}
                aria-label="Expand all visible label subgraphs"
              >
                Expand all
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {visibleSubgraphLabels.length === 0 ? (
                <span className="text-[11px] text-gray-500">No labels match the filter.</span>
              ) : (
                <>
                  {visibleLabelSubgraphToggles.map((label) => (
                    <button
                      key={label}
                      onClick={() => toggleParentLabel(label)}
                      className={CONTROL_BUTTON_CLASS}
                      aria-label={`${collapsedParentLabels[label] ? 'Expand' : 'Collapse'} label ${label}`}
                    >
                      {collapsedParentLabels[label] ? '▸' : '▾'} {label}
                    </button>
                  ))}
                  {visibleSubgraphLabels.length > MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES && (
                    <button
                      type="button"
                      onClick={toggleShowAllLabelSubgraphToggles}
                      className={CONTROL_BUTTON_CLASS}
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
      <div className="border-t border-gray-200 pt-3 flex flex-col gap-3" role="group" aria-label="Mock state simulation controls">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-xs">Conditional simulation:</span>
          <label className="text-xs flex items-center gap-1" htmlFor="condition-visibility-mode">
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
          <button
            type="button"
            onClick={resetMockFlags}
            className={CONTROL_BUTTON_CLASS}
            aria-label="Reset mock flag state"
          >
            Reset flags
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {discoveredFlags.length === 0 ? (
            <span className="text-[11px] text-gray-500">No condition flags discovered in the current graph.</span>
          ) : (
            discoveredFlags.map((flag) => (
              <label key={flag} className="inline-flex items-center gap-1">
                <span>{flag}</span>
                <select
                  value={mockFlags[flag] ?? 'unknown'}
                  onChange={(e) => setMockFlag(flag, e.target.value as MockFlagValue)}
                  className={CONTROL_INPUT_CLASS}
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
  );
}
