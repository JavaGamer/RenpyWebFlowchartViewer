import { useViewerStore } from "../../application/index.ts";
import { useShallow } from "zustand/react/shallow";
import { ViewerAdvancedControls } from "../ViewerAdvancedControls.tsx";
import type { CanvasNode } from "../../domain/index.ts";
import type { ChapterStats } from "./ChapterFiltersSettings.tsx";
import { Modal } from "../primitives/index.ts";

interface AdvancedControlsModalProps {
  relayout: () => void;
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
  discoveredFlags: string[];
  chapterStats?: ChapterStats;
}

export function AdvancedControlsModal({
  relayout,
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
  discoveredFlags,
  chapterStats,
}: AdvancedControlsModalProps) {
  const { showAdvancedControls, setShowAdvancedControls, theme } =
    useViewerStore(
      useShallow((s) => ({
        showAdvancedControls: s.showAdvancedControls,
        setShowAdvancedControls: s.setShowAdvancedControls,
        theme: s.theme,
      })),
    );
  const isDark = theme === "dark";

  return (
    <Modal
      open={showAdvancedControls}
      onOpenChange={setShowAdvancedControls}
      variant="sidebar"
      modal={false}
      isDark={isDark}
      title="Advanced Settings"
      description="Configure graph layouts, filters, themes, and path simulations."
    >
      <div className="px-6 py-4">
        <ViewerAdvancedControls
          onRelayout={relayout}
          focusTargetNode={focusTargetNode}
          onFocusSelectedNode={onFocusSelectedNode}
          largeGraphMode={largeGraphMode}
          largeGraphModeStatusText={largeGraphModeStatusText}
          labels={labels}
          chapters={chapters}
          collapsedLabelCount={collapsedLabelCount}
          visibleSubgraphLabels={visibleSubgraphLabels}
          visibleLabelSubgraphToggles={visibleLabelSubgraphToggles}
          shouldShowAllLabelSubgraphToggles={shouldShowAllLabelSubgraphToggles}
          setAllVisibleSubgraphLabelsCollapsed={setAllVisibleSubgraphLabelsCollapsed}
          discoveredFlags={discoveredFlags}
          chapterStats={chapterStats}
        />
      </div>
    </Modal>
  );
}
