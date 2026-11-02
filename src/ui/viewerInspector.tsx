import { X } from "lucide-react";
import { cn } from "./utils/cn.ts";
import { useViewerStore } from "../application/index.ts";
import {
  type CanvasNode,
  type FlowEdge,
  type NodeData,
} from "../domain/index.ts";
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
  flowEdges?: FlowEdge[];
  onSolveRoute?: (nodeId: string) => void;
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
  flowEdges,
  onSolveRoute,
}: ViewerInspectorProps) {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";
  const readingSpeedWpm = useViewerStore((s) => s.readingSpeedWpm);
  const isRightDockOpen = useViewerStore((s) => s.isRightDockOpen);
  const toggleRightDock = useViewerStore((s) => s.toggleRightDock);

  if (!isRightDockOpen) {
    return null;
  }

  return (
    <aside
      className={cn(
        "w-full xl:w-96 xl:max-w-[40%] xl:min-w-[280px] border-t xl:border-t-0 xl:border-l p-3 overflow-y-auto max-h-[45vh] xl:max-h-none transition-colors duration-200 z-20",
        isDark
          ? "border-slate-800 bg-slate-900 text-slate-100"
          : "border-gray-200 bg-white text-gray-900",
      )}
      aria-label="Inspector panel"
    >
      <div className="flex items-center justify-between font-semibold mb-2">
        <span className="text-sm">Inspector</span>
        <button
          type="button"
          onClick={toggleRightDock}
          className={cn(
            "p-1 rounded transition-colors cursor-pointer",
            isDark
              ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              : "text-gray-400 hover:text-gray-700 hover:bg-gray-100",
          )}
          aria-label="Close inspector"
        >
          <X size={14} />
        </button>
      </div>
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
            flowEdges={flowEdges}
            onSolveRoute={onSolveRoute}
          />
        )}
    </aside>
  );
}
