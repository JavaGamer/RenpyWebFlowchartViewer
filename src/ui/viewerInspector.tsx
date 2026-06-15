import { useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT } from "../config/viewerConfig";
import { type CanvasNode } from "../domain";
import type { DialogueSearchResult } from "../infrastructure";
import { renderHighlightedText, truncateForAria } from "./viewerText";
import { cn } from "./utils/cn";
import { useViewerStore } from "../application";

import {
  Image as ImageIcon,
  Mic as MicIcon,
  Music as MusicIcon,
  Volume2 as Volume2Icon,
  VolumeX as VolumeXIcon,
} from "lucide-react";

interface SelectedNodeData {
  label?: string;
  dialogueCount?: number;
  dialogueLines?: string[];
  audioAssetCues?: import("../domain/graph").AudioAssetCue[];
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

/* eslint-disable react-hooks/incompatible-library -- @tanstack/react-virtual uses React's own hooks; the rule fires a false-positive because it cannot detect the compatible peer-dependency declaration */
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
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const dialogueResultsScrollRef = useRef<HTMLDivElement | null>(null);
  const inspectorLinesScrollRef = useRef<HTMLDivElement | null>(null);

  const inspectorDialogueLines = useMemo(
    () =>
      showAllInspectorLines
        ? selectedNodeData?.dialogueLines ?? []
        : (selectedNodeData?.dialogueLines ?? []).slice(
          0,
          INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT,
        ),
    [selectedNodeData?.dialogueLines, showAllInspectorLines],
  );

  const shouldVirtualizeInspectorResults =
    activeDialogueSearchResults.length > 120;
  const shouldVirtualizeInspectorLines = inspectorDialogueLines.length > 120;

  const measureInspectorLineElement = useCallback(
    (element: HTMLDivElement) => element.getBoundingClientRect().height,
    [],
  );

  const dialogueResultsVirtualizer = useVirtualizer({
    count: shouldVirtualizeInspectorResults
      ? activeDialogueSearchResults.length
      : 0,
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
              isDark ? "text-slate-350" : "text-gray-700",
            )}
            role="status"
            aria-live="polite"
          >
            Node matches (label/count): {nodeSearchMatchCount}
          </div>
          {!dialogueLineSearchEnabled
            ? (
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
            )
            : (
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
                          isDark ? "text-slate-450" : "text-gray-505",
                        )}
                      >
                        <div role="status" aria-live="polite">
                          No dialogue lines matched “{effectiveSearch.trim()}”.
                          Label or dialogue-count matches may still appear
                          elsewhere.
                        </div>
                      </div>
                    )
                    : shouldVirtualizeInspectorResults
                    ? (
                      <ul
                        className="relative space-y-1"
                        style={{
                          height:
                            `${dialogueResultsVirtualizer.getTotalSize()}px`,
                        }}
                      >
                        {dialogueResultsVirtualizer.getVirtualItems().map(
                          (virtualItem) => {
                            const result =
                              activeDialogueSearchResults[virtualItem.index];
                            return (
                              <li
                                key={`${result.nodeId}-${result.lineIndex}`}
                                className="absolute left-0 top-0 w-full"
                                style={{
                                  transform:
                                    `translateY(${virtualItem.start}px)`,
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
                                    onSetActiveDialogueResultIndex(
                                      virtualItem.index,
                                    );
                                    onSelectDialogueSearchResult(result);
                                  }}
                                  className={cn(
                                    "w-full text-left border rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 transition-colors",
                                    isDark
                                      ? virtualItem.index ===
                                          resolvedActiveDialogueResultIndex
                                        ? "border-violet-500 bg-violet-950/50 text-violet-200"
                                        : "border-slate-800 bg-slate-800/20 hover:bg-slate-850 text-slate-300"
                                      : virtualItem.index ===
                                          resolvedActiveDialogueResultIndex
                                      ? "border-violet-400 bg-violet-50 text-violet-900"
                                      : "border-gray-200 bg-white hover:bg-gray-50 text-gray-755",
                                  )}
                                >
                                  <div className="text-xs font-medium">
                                    {result.nodeLabel} · line {result.lineIndex}
                                  </div>
                                  <div
                                    className={cn(
                                      "text-xs truncate",
                                      isDark
                                        ? "text-slate-400"
                                        : "text-gray-600",
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
                        {activeDialogueSearchResults.map((
                          result,
                          resultIndex,
                        ) => (
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
                                  ? resultIndex ===
                                      resolvedActiveDialogueResultIndex
                                    ? "border-violet-500 bg-violet-950/50 text-violet-200"
                                    : "border-slate-800 bg-slate-800/20 hover:bg-slate-850 text-slate-300"
                                  : resultIndex ===
                                      resolvedActiveDialogueResultIndex
                                  ? "border-violet-400 bg-violet-50 text-violet-900"
                                  : "border-gray-200 bg-white hover:bg-gray-50 text-gray-755",
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
                        ))}
                      </ul>
                    )}
                </div>
                {activeDialogueSearchResults.length > 0 && (
                  <div
                    className={cn(
                      "mt-1 text-[11px]",
                      isDark ? "text-slate-500" : "text-gray-505",
                    )}
                    role="status"
                    aria-live="polite"
                  >
                    Tip: with search focused, use ↑/↓ to move results and Enter
                    to open.
                  </div>
                )}
              </>
            )}
        </div>
      )}
      {!selectedNode || !selectedNodeData
        ? (
          <div
            className={cn(
              "text-xs",
              isDark ? "text-slate-450" : "text-gray-505",
            )}
          >
            {effectiveSearch.trim().length > 0
              ? "Choose a search result or click a visible node to inspect dialogue lines."
              : "Select a node to inspect dialogue lines, or search to jump to matching dialogue."}
          </div>
        )
        : (
          <div className="space-y-2">
            <div className="text-xs">
              <span className="font-semibold text-gray-500">Node:</span>{" "}
              {selectedNodeData.label}
            </div>
            <div className="text-xs">
              <span className="font-semibold text-gray-500">
                Dialogue lines:
              </span>{" "}
              {selectedNodeData.dialogueCount ?? 0}
            </div>

            {selectedNodeData.audioAssetCues &&
              selectedNodeData.audioAssetCues.length > 0 && (
              <div
                className={cn(
                  "text-xs space-y-2 mt-2 pt-2 border-t",
                  isDark ? "border-slate-800" : "border-gray-100",
                )}
              >
                <div
                  className={cn(
                    "font-semibold",
                    isDark ? "text-slate-300" : "text-gray-700",
                  )}
                >
                  Media & Asset Cues
                </div>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {selectedNodeData.audioAssetCues.map((cue, idx) => {
                    const style = (() => {
                      switch (cue.type) {
                        case "scene":
                          return isDark
                            ? {
                              backgroundColor: "#172554",
                              borderColor: "#1e40af",
                              color: "#60a5fa",
                            }
                            : {
                              backgroundColor: "#eff6ff",
                              borderColor: "#bfdbfe",
                              color: "#1d4ed8",
                            };
                        case "play":
                        case "queue":
                          return cue.channel === "music"
                            ? isDark
                              ? {
                                backgroundColor: "#022c22",
                                borderColor: "#065f46",
                                color: "#34d399",
                              }
                              : {
                                backgroundColor: "#ecfdf5",
                                borderColor: "#a7f3d0",
                                color: "#047857",
                              }
                            : isDark
                            ? {
                              backgroundColor: "#451a03",
                              borderColor: "#78350f",
                              color: "#fbbf24",
                            }
                            : {
                              backgroundColor: "#fffbeb",
                              borderColor: "#fde68a",
                              color: "#b45309",
                            };
                        case "stop":
                          return isDark
                            ? {
                              backgroundColor: "#4c0519",
                              borderColor: "#881337",
                              color: "#f43f5e",
                            }
                            : {
                              backgroundColor: "#fff1f2",
                              borderColor: "#fecdd3",
                              color: "#be123c",
                            };
                        case "voice":
                          return isDark
                            ? {
                              backgroundColor: "#2e1065",
                              borderColor: "#581c87",
                              color: "#c084fc",
                            }
                            : {
                              backgroundColor: "#faf5ff",
                              borderColor: "#e9d5ff",
                              color: "#7e22ce",
                            };
                        default:
                          return {};
                      }
                    })();

                    const icon = (() => {
                      switch (cue.type) {
                        case "scene":
                          return (
                            <ImageIcon
                              size={12}
                              className={cn(
                                "shrink-0",
                                isDark ? "text-blue-400" : "text-blue-700",
                              )}
                            />
                          );
                        case "play":
                        case "queue":
                          return cue.channel === "music"
                            ? (
                              <MusicIcon
                                size={12}
                                className={cn(
                                  "shrink-0",
                                  isDark
                                    ? "text-emerald-400"
                                    : "text-emerald-700",
                                )}
                              />
                            )
                            : (
                              <Volume2Icon
                                size={12}
                                className={cn(
                                  "shrink-0",
                                  isDark ? "text-amber-400" : "text-amber-700",
                                )}
                              />
                            );
                        case "stop":
                          return (
                            <VolumeXIcon
                              size={12}
                              className={cn(
                                "shrink-0",
                                isDark ? "text-rose-400" : "text-rose-700",
                              )}
                            />
                          );
                        case "voice":
                          return (
                            <MicIcon
                              size={12}
                              className={cn(
                                "shrink-0",
                                isDark ? "text-purple-400" : "text-purple-700",
                              )}
                            />
                          );
                        default:
                          return null;
                      }
                    })();

                    return (
                      <div
                        key={idx}
                        className={cn(
                          "flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border shadow-sm font-mono transition-colors duration-200",
                        )}
                        style={style}
                        title={cue.raw}
                      >
                        {icon}
                        <span className="font-medium tracking-wide uppercase text-[9px] shrink-0 opacity-80">
                          {cue.type}
                        </span>
                        <span className="truncate flex-1">
                          {cue.type === "play" || cue.type === "stop" ||
                              cue.type === "queue"
                            ? `${cue.channel}: `
                            : ""}
                          {cue.asset}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="text-xs font-semibold">Dialogue</div>
            <div
              ref={inspectorLinesScrollRef}
              className={shouldVirtualizeInspectorLines
                ? "max-h-64 overflow-y-auto"
                : ""}
            >
              {shouldVirtualizeInspectorLines
                ? (
                  <div
                    className="relative"
                    style={{
                      height: `${inspectorLinesVirtualizer.getTotalSize()}px`,
                    }}
                  >
                    {inspectorLinesVirtualizer.getVirtualItems().map(
                      (virtualItem) => {
                        const line =
                          inspectorDialogueLines[virtualItem.index] ?? "";
                        const absoluteIndex = virtualItem.index + 1;
                        const isSelectedLine =
                          selectedDialogueLineIndex === absoluteIndex;
                        return (
                          <div
                            key={`${selectedNodeId}-${virtualItem.key}`}
                            ref={inspectorLinesVirtualizer.measureElement}
                            data-index={virtualItem.index}
                            className={cn(
                              "text-xs border rounded px-2 py-1 transition-colors",
                              isDark
                                ? isSelectedLine
                                  ? "border-violet-500 bg-violet-950/50 text-violet-200"
                                  : "border-slate-800 bg-slate-800/10 text-slate-300"
                                : isSelectedLine
                                ? "border-violet-400 bg-violet-50 text-violet-900"
                                : "border-gray-200 bg-white text-gray-805",
                            )}
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              width: "100%",
                              transform: `translateY(${virtualItem.start}px)`,
                            }}
                          >
                            <span className="font-medium mr-1">
                              {absoluteIndex}.
                            </span>
                            {renderHighlightedText(line, effectiveSearch)}
                          </div>
                        );
                      },
                    )}
                  </div>
                )
                : (
                  <div className="space-y-1">
                    {inspectorDialogueLines.map((line, idx) => {
                      const absoluteIndex = idx + 1;
                      const isSelectedLine =
                        selectedDialogueLineIndex === absoluteIndex;
                      return (
                        <div
                          key={`${selectedNodeId}-${idx}`}
                          className={cn(
                            "text-xs border rounded px-2 py-1 transition-colors",
                            isDark
                              ? isSelectedLine
                                ? "border-violet-500 bg-violet-950/50 text-violet-200"
                                : "border-slate-800 bg-slate-800/10 text-slate-300"
                              : isSelectedLine
                              ? "border-violet-400 bg-violet-50 text-violet-900"
                              : "border-gray-200 bg-white text-gray-805",
                          )}
                        >
                          <span className="font-medium mr-1">
                            {absoluteIndex}.
                          </span>
                          {renderHighlightedText(line, effectiveSearch)}
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
            {(selectedNodeData.dialogueLines?.length ?? 0) >
                INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT && (
              <button
                type="button"
                onClick={onToggleShowAllInspectorLines}
                className={cn(
                  "text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 rounded transition-colors",
                  isDark
                    ? "text-violet-300 focus-visible:ring-violet-400"
                    : "text-violet-700 focus-visible:ring-violet-500",
                )}
              >
                {showAllInspectorLines
                  ? "Show less"
                  : `Show more (${
                    (selectedNodeData.dialogueLines?.length ?? 0) -
                    INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT
                  } more)`}
              </button>
            )}
          </div>
        )}
    </aside>
  );
}
