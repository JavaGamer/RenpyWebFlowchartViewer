import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DialogueSearchResult } from "../../infrastructure/index.ts";
import { renderHighlightedText, truncateForAria } from "../viewerText.tsx";
import { cn } from "../utils/cn.ts";

interface InspectorSearchResultsProps {
  effectiveSearch: string;
  dialogueLineSearchEnabled: boolean;
  activeDialogueSearchResults: DialogueSearchResult[];
  resolvedActiveDialogueResultIndex: number;
  onSetActiveDialogueResultIndex: (index: number) => void;
  onSelectDialogueSearchResult: (result: DialogueSearchResult) => void;
  isDark: boolean;
}

/* eslint-disable react-hooks/incompatible-library */
export function InspectorSearchResults({
  effectiveSearch,
  dialogueLineSearchEnabled,
  activeDialogueSearchResults,
  resolvedActiveDialogueResultIndex,
  onSetActiveDialogueResultIndex,
  onSelectDialogueSearchResult,
  isDark,
}: InspectorSearchResultsProps) {
  const dialogueResultsScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualizeInspectorResults =
    activeDialogueSearchResults.length > 120;

  const dialogueResultsVirtualizer = useVirtualizer({
    count: shouldVirtualizeInspectorResults
      ? activeDialogueSearchResults.length
      : 0,
    getScrollElement: () => dialogueResultsScrollRef.current,
    estimateSize: () => 52,
    overscan: 6,
  });

  if (!dialogueLineSearchEnabled) {
    return (
      <div
        className={cn(
          "text-xs",
          isDark ? "text-slate-400" : "text-gray-600",
        )}
        role="status"
        aria-live="polite"
      >
        Dialogue line matching is unavailable in performance mode.
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "text-xs font-semibold mb-1",
          isDark ? "text-slate-300" : "text-gray-700",
        )}
      >
        Dialogue line matches ({activeDialogueSearchResults.length})
      </div>
      <div
        ref={dialogueResultsScrollRef}
        className="max-h-48 overflow-y-auto"
        aria-label="Dialogue search results"
      >
        {activeDialogueSearchResults.length === 0
          ? (
            <div
              className={cn(
                "text-xs",
                isDark ? "text-slate-400" : "text-gray-500",
              )}
            >
              <div role="status" aria-live="polite">
                No dialogue lines matched “{effectiveSearch.trim()}”. Label or
                dialogue-count matches may still appear elsewhere.
              </div>
            </div>
          )
          : shouldVirtualizeInspectorResults
          ? (
            <ul
              className="relative space-y-1"
              style={{
                height: `${dialogueResultsVirtualizer.getTotalSize()}px`,
              }}
            >
              {dialogueResultsVirtualizer.getVirtualItems().map(
                (virtualItem) => {
                  const result = activeDialogueSearchResults[virtualItem.index];
                  return (
                    <li
                      key={`${result.nodeId}-${result.lineIndex}`}
                      className="absolute left-0 top-0 w-full"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <button
                        type="button"
                        aria-current={virtualItem.index ===
                            resolvedActiveDialogueResultIndex
                          ? "true"
                          : undefined}
                        aria-label={`${result.nodeLabel} line ${result.lineIndex}: ${
                          truncateForAria(result.lineText)
                        }`}
                        onClick={() => {
                          onSetActiveDialogueResultIndex(virtualItem.index);
                          onSelectDialogueSearchResult(result);
                        }}
                        className={cn(
                          "w-full text-left border rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 transition-colors",
                          isDark
                            ? virtualItem.index ===
                                resolvedActiveDialogueResultIndex
                              ? "border-violet-500 bg-violet-950/50 text-violet-200"
                              : "border-slate-800 bg-slate-800/20 hover:bg-slate-800 text-slate-300"
                            : virtualItem.index ===
                                resolvedActiveDialogueResultIndex
                            ? "border-violet-400 bg-violet-50 text-violet-900"
                            : "border-gray-200 bg-white hover:bg-gray-50 text-gray-700",
                        )}
                      >
                        <div className="text-xs font-medium">
                          {result.nodeLabel} · line {result.lineIndex}
                        </div>
                        <div
                          className={cn(
                            "text-xs truncate",
                            isDark ? "text-slate-400" : "text-gray-600",
                          )}
                        >
                          {renderHighlightedText(
                            result.lineText,
                            effectiveSearch,
                          )}
                        </div>
                      </button>
                    </li>
                  );
                },
              )}
            </ul>
          )
          : (
            <ul className="space-y-1">
              {activeDialogueSearchResults.map((result, resultIndex) => (
                <li key={`${result.nodeId}-${result.lineIndex}`}>
                  <button
                    type="button"
                    aria-current={resultIndex ===
                        resolvedActiveDialogueResultIndex
                      ? "true"
                      : undefined}
                    aria-label={`${result.nodeLabel} line ${result.lineIndex}: ${
                      truncateForAria(result.lineText)
                    }`}
                    onClick={() => {
                      onSetActiveDialogueResultIndex(resultIndex);
                      onSelectDialogueSearchResult(result);
                    }}
                    className={cn(
                      "w-full text-left border rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 transition-colors",
                      isDark
                        ? resultIndex === resolvedActiveDialogueResultIndex
                          ? "border-violet-500 bg-violet-950/50 text-violet-200"
                          : "border-slate-800 bg-slate-800/20 hover:bg-slate-800 text-slate-300"
                        : resultIndex === resolvedActiveDialogueResultIndex
                        ? "border-violet-400 bg-violet-50 text-violet-900"
                        : "border-gray-200 bg-white hover:bg-gray-50 text-gray-700",
                    )}
                  >
                    <div className="text-xs font-medium">
                      {result.nodeLabel} · line {result.lineIndex}
                    </div>
                    <div
                      className={cn(
                        "text-xs truncate",
                        isDark ? "text-slate-400" : "text-gray-600",
                      )}
                    >
                      {renderHighlightedText(result.lineText, effectiveSearch)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      {activeDialogueSearchResults.length > 0 && (
        <div
          className={cn(
            "mt-1 text-[11px]",
            isDark ? "text-slate-500" : "text-gray-500",
          )}
          role="status"
          aria-live="polite"
        >
          Tip: with search focused, use ↑/↓ to move results and Enter to open.
        </div>
      )}
    </>
  );
}
