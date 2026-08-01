import { cn } from "./utils/cn.ts";
import { useViewerStore } from "../application/index.ts";
import { type CanvasNode, type NodeData } from "../domain/index.ts";
import type { DialogueSearchResult } from "../infrastructure/index.ts";
import { InspectorSearchResults } from "./components/InspectorSearchResults.tsx";
import { InspectorNodeDetails } from "./components/InspectorNodeDetails.tsx";

type SelectedNodeData = NodeData;

export interface ViewerInspectorProps {
  effectiveSearch: string;
  nodeSearchMatchCount: number;
  dialogueLineSearchEnabled: boolean;
  activeDialogueSearchResults: DialogueSearchResult[];
  resolvedActiveDialogueResultIndex: number;
  selectedNode: CanvasNode | null;
  selectedNodeData: SelectedNodeData | undefined;
  selectedNodeId: string;
  selectedDialogueLineIndex: number | null;
  showAllInspectorLines: boolean;
  showMediaCuesInDialogue: boolean;
  setShowMediaCuesInDialogue: (show: boolean) => void;
  onToggleShowAllInspectorLines: () => void;
  onSetActiveDialogueResultIndex: (index: number) => void;
  onSelectDialogueSearchResult: (result: DialogueSearchResult) => void;
}

export function ViewerInspector({
  effectiveSearch,
  nodeSearchMatchCount,
  dialogueLineSearchEnabled,
  activeDialogueSearchResults,
  resolvedActiveDialogueResultIndex,
  selectedNode,
  selectedNodeData,
  selectedNodeId,
  selectedDialogueLineIndex,
  showAllInspectorLines,
  showMediaCuesInDialogue,
  setShowMediaCuesInDialogue,
  onToggleShowAllInspectorLines,
  onSetActiveDialogueResultIndex,
  onSelectDialogueSearchResult,
}: ViewerInspectorProps) {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";
  const readingSpeedWpm = useViewerStore((s) => s.readingSpeedWpm);

  return (
    <aside
      className={cn(
        "w-full xl:w-96 xl:max-w-[40%] xl:min-w-[280px] border-t xl:border-t-0 xl:border-l p-3 overflow-y-auto max-h-[45vh] xl:max-h-none transition-colors duration-200",
        isDark
          ? "border-slate-800 bg-slate-900 text-slate-100"
          : "border-gray-200 bg-white text-gray-900",
      )}
      aria-label="Inspector panel"
    >
      <div className="text-sm font-semibold mb-2">Inspector</div>
      {effectiveSearch.trim().length > 0 && (
        <div className="mb-4">
          <div
            className={cn(
              "text-xs mb-1",
              isDark ? "text-slate-300" : "text-gray-700",
            )}
            role="status"
            aria-live="polite"
          >
            Node matches (label/count): {nodeSearchMatchCount}
          </div>
          <InspectorSearchResults
            effectiveSearch={effectiveSearch}
            dialogueLineSearchEnabled={dialogueLineSearchEnabled}
            activeDialogueSearchResults={activeDialogueSearchResults}
            resolvedActiveDialogueResultIndex={resolvedActiveDialogueResultIndex}
            onSetActiveDialogueResultIndex={onSetActiveDialogueResultIndex}
            onSelectDialogueSearchResult={onSelectDialogueSearchResult}
            isDark={isDark}
          />
        </div>
      )}
      {!selectedNode || !selectedNodeData
        ? (
          <div
            className={cn(
              "text-xs",
              isDark ? "text-slate-400" : "text-gray-500",
            )}
          >
            {effectiveSearch.trim().length > 0
              ? "Choose a search result or click a visible node to inspect dialogue lines."
              : "Select a node to inspect dialogue lines, or search to jump to matching dialogue."}
          </div>
        )
        : (
          <InspectorNodeDetails
            selectedNodeData={selectedNodeData}
            selectedNodeId={selectedNodeId}
            selectedDialogueLineIndex={selectedDialogueLineIndex}
            showAllInspectorLines={showAllInspectorLines}
            showMediaCuesInDialogue={showMediaCuesInDialogue}
            setShowMediaCuesInDialogue={setShowMediaCuesInDialogue}
            onToggleShowAllInspectorLines={onToggleShowAllInspectorLines}
            effectiveSearch={effectiveSearch}
            theme={theme}
            isDark={isDark}
            readingSpeedWpm={readingSpeedWpm}
          />
        )}
    </aside>
  );
}
