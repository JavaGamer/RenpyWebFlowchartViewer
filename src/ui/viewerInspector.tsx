import { INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT } from '../config/viewerConfig';
import { type CanvasNode } from '../flowchartTransforms';
import { type DialogueSearchResult, renderHighlightedText, truncateForAria } from './viewerText';

interface SelectedNodeData {
  label?: string;
  dialogueCount?: number;
  dialogueLines?: string[];
}

export interface ViewerInspectorProps {
  effectiveSearch: string;
  dialogueSearchResults: DialogueSearchResult[];
  resolvedActiveDialogueResultIndex: number;
  selectedNode: CanvasNode | null;
  selectedNodeData: SelectedNodeData | undefined;
  selectedNodeId: string;
  selectedDialogueLineIndex: number | null;
  showAllInspectorLines: boolean;
  onToggleShowAllInspectorLines: () => void;
  onSetActiveDialogueResultIndex: (index: number) => void;
  onSelectDialogueSearchResult: (result: DialogueSearchResult) => void;
}

export function ViewerInspector({
  effectiveSearch,
  dialogueSearchResults,
  resolvedActiveDialogueResultIndex,
  selectedNode,
  selectedNodeData,
  selectedNodeId,
  selectedDialogueLineIndex,
  showAllInspectorLines,
  onToggleShowAllInspectorLines,
  onSetActiveDialogueResultIndex,
  onSelectDialogueSearchResult,
}: ViewerInspectorProps) {
  return (
    <aside
      className="w-full xl:w-96 xl:max-w-[40%] xl:min-w-[280px] border-t xl:border-t-0 xl:border-l border-gray-200 bg-white p-3 overflow-y-auto max-h-[45vh] xl:max-h-none"
      aria-label="Inspector panel"
    >
      <div className="text-sm font-semibold mb-2">Inspector</div>
      {effectiveSearch.trim().length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-700 mb-1">
            Dialogue line matches ({dialogueSearchResults.length})
          </div>
          <ul className="space-y-1 max-h-48 overflow-y-auto" aria-label="Dialogue search results">
            {dialogueSearchResults.length === 0 ? (
              <li className="text-xs text-gray-500">
                <div role="status" aria-live="polite">
                  No dialogue lines matched “{effectiveSearch.trim()}”. Label or dialogue-count matches may still appear elsewhere.
                </div>
              </li>
            ) : (
              dialogueSearchResults.map((result, resultIndex) => (
                <li key={`${result.nodeId}-${result.lineIndex}`}>
                  <button
                    type="button"
                    aria-current={resultIndex === resolvedActiveDialogueResultIndex ? 'true' : undefined}
                    aria-label={`${result.nodeLabel} line ${result.lineIndex}: ${truncateForAria(result.lineText)}`}
                    onClick={() => {
                      onSetActiveDialogueResultIndex(resultIndex);
                      onSelectDialogueSearchResult(result);
                    }}
                    className={`w-full text-left border rounded px-2 py-1 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                      resultIndex === resolvedActiveDialogueResultIndex
                        ? 'border-violet-400 bg-violet-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="text-xs font-medium">{result.nodeLabel} · line {result.lineIndex}</div>
                    <div className="text-xs text-gray-600 truncate">{renderHighlightedText(result.lineText, effectiveSearch)}</div>
                  </button>
                </li>
              ))
            )}
          </ul>
          {dialogueSearchResults.length > 0 && (
            <div className="mt-1 text-[11px] text-gray-500" role="status" aria-live="polite">
              Tip: with search focused, use ↑/↓ to move results and Enter to open.
            </div>
          )}
        </div>
      )}
      {!selectedNode || !selectedNodeData ? (
        <div className="text-xs text-gray-500">
          {effectiveSearch.trim().length > 0
            ? 'Choose a search result or click a visible node to inspect dialogue lines.'
            : 'Select a node to inspect dialogue lines, or search to jump to matching dialogue.'}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs">
            <span className="font-semibold">Node:</span> {selectedNodeData.label}
          </div>
          <div className="text-xs">
            <span className="font-semibold">Dialogue lines:</span> {selectedNodeData.dialogueCount ?? 0}
          </div>
          <div className="text-xs font-semibold">Dialogue</div>
          <div className="space-y-1">
            {(showAllInspectorLines
              ? selectedNodeData.dialogueLines ?? []
              : (selectedNodeData.dialogueLines ?? []).slice(0, INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT)
            ).map((line, idx) => {
              const absoluteIndex = idx + 1;
              const isSelectedLine = selectedDialogueLineIndex === absoluteIndex;
              return (
                <div
                  key={`${selectedNodeId}-${absoluteIndex}`}
                  className={`text-xs border rounded px-2 py-1 ${isSelectedLine ? 'border-violet-400 bg-violet-50' : 'border-gray-200'}`}
                >
                  <span className="font-medium mr-1">{absoluteIndex}.</span>
                  {renderHighlightedText(line, effectiveSearch)}
                </div>
              );
            })}
          </div>
          {(selectedNodeData.dialogueLines?.length ?? 0) > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT && (
            <button
              type="button"
              onClick={onToggleShowAllInspectorLines}
              className="text-xs text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
            >
              {showAllInspectorLines ? 'Show less' : `Show more (${(selectedNodeData.dialogueLines?.length ?? 0) - INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT} more)`}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
