import { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT } from '../config/viewerConfig';
import { type CanvasNode } from '../flowchartTransforms';
import type { DialogueSearchResult } from '../infrastructure';
import { renderHighlightedText, truncateForAria } from './viewerText';

interface SelectedNodeData {
  label?: string;
  dialogueCount?: number;
  dialogueLines?: string[];
}

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
  onToggleShowAllInspectorLines: () => void;
  onSetActiveDialogueResultIndex: (index: number) => void;
  onSelectDialogueSearchResult: (result: DialogueSearchResult) => void;
}

/* eslint-disable react-hooks/incompatible-library */
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
  onToggleShowAllInspectorLines,
  onSetActiveDialogueResultIndex,
  onSelectDialogueSearchResult,
}: ViewerInspectorProps) {
  const dialogueResultsScrollRef = useRef<HTMLDivElement | null>(null);
  const inspectorLinesScrollRef = useRef<HTMLDivElement | null>(null);

  const inspectorDialogueLines = useMemo(
    () =>
      showAllInspectorLines
        ? selectedNodeData?.dialogueLines ?? []
        : (selectedNodeData?.dialogueLines ?? []).slice(0, INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT),
    [selectedNodeData?.dialogueLines, showAllInspectorLines],
  );

  const shouldVirtualizeInspectorResults = activeDialogueSearchResults.length > 120;
  const shouldVirtualizeInspectorLines = inspectorDialogueLines.length > 120;

  const measureInspectorLineElement = useCallback(
    (element: HTMLDivElement) => element.getBoundingClientRect().height,
    [],
  );

  const dialogueResultsVirtualizer = useVirtualizer({
    count: shouldVirtualizeInspectorResults ? activeDialogueSearchResults.length : 0,
    getScrollElement: () => dialogueResultsScrollRef.current,
    estimateSize: () => 52,
    overscan: 6,
  });
  const inspectorLinesVirtualizer = useVirtualizer({
    count: shouldVirtualizeInspectorLines ? inspectorDialogueLines.length : 0,
    getScrollElement: () => inspectorLinesScrollRef.current,
    estimateSize: () => 34,
    measureElement: measureInspectorLineElement,
    overscan: 10,
  });
  /* eslint-enable react-hooks/incompatible-library */

  return (
    <aside
      className="w-full xl:w-96 xl:max-w-[40%] xl:min-w-[280px] border-t xl:border-t-0 xl:border-l border-gray-200 bg-white p-3 overflow-y-auto max-h-[45vh] xl:max-h-none"
      aria-label="Inspector panel"
    >
      <div className="text-sm font-semibold mb-2">Inspector</div>
      {effectiveSearch.trim().length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-gray-700 mb-1" role="status" aria-live="polite">
            Node matches (label/count): {nodeSearchMatchCount}
          </div>
          {!dialogueLineSearchEnabled ? (
            <div className="text-xs text-gray-600" role="status" aria-live="polite">
              Dialogue line matching is unavailable in performance mode.
            </div>
          ) : (
            <>
              <div className="text-xs font-semibold text-gray-700 mb-1">
                Dialogue line matches ({activeDialogueSearchResults.length})
              </div>
              <div
                ref={dialogueResultsScrollRef}
                className="max-h-48 overflow-y-auto"
                aria-label="Dialogue search results"
              >
                {activeDialogueSearchResults.length === 0 ? (
                  <div className="text-xs text-gray-500">
                    <div role="status" aria-live="polite">
                      No dialogue lines matched “{effectiveSearch.trim()}”. Label or dialogue-count matches may still appear elsewhere.
                    </div>
                  </div>
                ) : shouldVirtualizeInspectorResults ? (
                  <ul
                    className="relative space-y-1"
                    style={{ height: `${dialogueResultsVirtualizer.getTotalSize()}px` }}
                  >
                    {dialogueResultsVirtualizer.getVirtualItems().map((virtualItem) => {
                      const result = activeDialogueSearchResults[virtualItem.index];
                      return (
                        <li
                          key={`${result.nodeId}-${result.lineIndex}`}
                          className="absolute left-0 top-0 w-full"
                          style={{ transform: `translateY(${virtualItem.start}px)` }}
                        >
                          <button
                            type="button"
                            aria-current={virtualItem.index === resolvedActiveDialogueResultIndex ? 'true' : undefined}
                            aria-label={`${result.nodeLabel} line ${result.lineIndex}: ${truncateForAria(result.lineText)}`}
                            onClick={() => {
                              onSetActiveDialogueResultIndex(virtualItem.index);
                              onSelectDialogueSearchResult(result);
                            }}
                            className={`w-full text-left border rounded px-2 py-1 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                              virtualItem.index === resolvedActiveDialogueResultIndex
                                ? 'border-violet-400 bg-violet-50'
                                : 'border-gray-200'
                            }`}
                          >
                            <div className="text-xs font-medium">{result.nodeLabel} · line {result.lineIndex}</div>
                            <div className="text-xs text-gray-600 truncate">{renderHighlightedText(result.lineText, effectiveSearch)}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="space-y-1">
                    {activeDialogueSearchResults.map((result, resultIndex) => (
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
                    ))}
                  </ul>
                )}
              </div>
              {activeDialogueSearchResults.length > 0 && (
                <div className="mt-1 text-[11px] text-gray-500" role="status" aria-live="polite">
                  Tip: with search focused, use ↑/↓ to move results and Enter to open.
                </div>
              )}
            </>
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
          <div ref={inspectorLinesScrollRef} className={shouldVirtualizeInspectorLines ? 'max-h-64 overflow-y-auto' : ''}>
            {shouldVirtualizeInspectorLines ? (
              <div
                className="relative"
                style={{ height: `${inspectorLinesVirtualizer.getTotalSize()}px` }}
              >
                {inspectorLinesVirtualizer.getVirtualItems().map((virtualItem) => {
                  const line = inspectorDialogueLines[virtualItem.index] ?? '';
                  const absoluteIndex = virtualItem.index + 1;
                  const isSelectedLine = selectedDialogueLineIndex === absoluteIndex;
                  return (
                    <div
                      key={`${selectedNodeId}-${virtualItem.key}`}
                      ref={inspectorLinesVirtualizer.measureElement}
                      data-index={virtualItem.index}
                      className={`text-xs border rounded px-2 py-1 ${isSelectedLine ? 'border-violet-400 bg-violet-50' : 'border-gray-200'}`}
                      style={{ position: 'absolute', left: 0, top: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
                    >
                      <span className="font-medium mr-1">{absoluteIndex}.</span>
                      {renderHighlightedText(line, effectiveSearch)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1">
                {inspectorDialogueLines.map((line, idx) => {
                  const absoluteIndex = idx + 1;
                  const isSelectedLine = selectedDialogueLineIndex === absoluteIndex;
                  return (
                    <div
                      key={`${selectedNodeId}-${idx}`}
                      className={`text-xs border rounded px-2 py-1 ${isSelectedLine ? 'border-violet-400 bg-violet-50' : 'border-gray-200'}`}
                    >
                      <span className="font-medium mr-1">{absoluteIndex}.</span>
                      {renderHighlightedText(line, effectiveSearch)}
                    </div>
                  );
                })}
              </div>
            )}
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
