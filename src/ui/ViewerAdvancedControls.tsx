import type { CanvasNode } from "../domain/index.ts";
import { LayoutSettings } from "./components/LayoutSettings.tsx";
import { ThemeSettings } from "./components/ThemeSettings.tsx";
import { SimplificationSettings } from "./components/SimplificationSettings.tsx";
import { MockFlagsSettings } from "./components/MockFlagsSettings.tsx";
import {
  ChapterFiltersSettings,
  type ChapterStats,
} from "./components/ChapterFiltersSettings.tsx";
import { ReadingSettings } from "./components/ReadingSettings.tsx";

export interface ViewerAdvancedControlsProps {
  onRelayout: () => void;
  focusTargetNode: CanvasNode | undefined;
  onFocusSelectedNode: () => void;
  largeGraphMode: boolean;
  largeGraphModeStatusText: string;
  labels: string[];

  chapters: string[];
  collapsedLabelCount: number;
  visibleSubgraphLabels: string[];
  visibleLabelSubgraphToggles: string[];
  shouldShowAllLabelSubgraphToggles: boolean;
  setAllVisibleSubgraphLabelsCollapsed: (collapsed: boolean) => void;
  /** Per-chapter reading stats for the chapter filter buttons. */
  chapterStats?: ChapterStats;

  discoveredFlags: string[];
}

export function ViewerAdvancedControls({
  onRelayout,
  focusTargetNode,
  onFocusSelectedNode,
  largeGraphMode,
  largeGraphModeStatusText,
  labels,
  chapters,
  collapsedLabelCount,
  visibleSubgraphLabels,
  visibleLabelSubgraphToggles,
  shouldShowAllLabelSubgraphToggles,
  setAllVisibleSubgraphLabelsCollapsed,
  chapterStats,
  discoveredFlags,
}: ViewerAdvancedControlsProps) {
  return (
    <div
      id="viewer-advanced-controls"
      className="flex flex-col gap-5"
      role="group"
      aria-label="Advanced controls"
    >
      <LayoutSettings
        onRelayout={onRelayout}
        onFocusSelectedNode={onFocusSelectedNode}
        focusTargetNode={focusTargetNode}
        labels={labels}
      />

      <ReadingSettings />

      <ThemeSettings
        largeGraphMode={largeGraphMode}
        largeGraphModeStatusText={largeGraphModeStatusText}
      />

      <SimplificationSettings />

      <MockFlagsSettings discoveredFlags={discoveredFlags} />

      <ChapterFiltersSettings
        chapters={chapters}
        labels={labels}
        collapsedLabelCount={collapsedLabelCount}
        visibleSubgraphLabels={visibleSubgraphLabels}
        visibleLabelSubgraphToggles={visibleLabelSubgraphToggles}
        shouldShowAllLabelSubgraphToggles={shouldShowAllLabelSubgraphToggles}
        setAllVisibleSubgraphLabelsCollapsed={setAllVisibleSubgraphLabelsCollapsed}
        chapterStats={chapterStats}
      />
    </div>
  );
}
