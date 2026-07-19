import { useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { renderHighlightedText } from "../viewerText.tsx";
import { cn } from "../utils/cn.ts";
import type { NodeData } from "../../domain/index.ts";
import { INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT } from "../../config/viewerConfig.ts";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "../utils/readingTime.ts";
import {
  Image as ImageIcon,
  Mic as MicIcon,
  Music as MusicIcon,
  Volume2 as Volume2Icon,
  VolumeX as VolumeXIcon,
} from "lucide-react";

function renderCueItem(
  cue: import("../../domain/graph.ts").AudioAssetCue,
  theme: string,
  effectiveSearch: string,
) {
  const isDark = theme === "dark";
  const isHighContrast = theme === "highContrast";

  const cueClasses = (() => {
    if (isHighContrast) {
      return "bg-white border-2 border-black text-black font-bold";
    }

    switch (cue.type) {
      case "scene":
        return isDark
          ? "bg-blue-950/60 border-blue-800/80 text-blue-300"
          : "bg-blue-50 border-blue-200 text-blue-700";
      case "play":
      case "queue":
        return cue.channel === "music"
          ? isDark
            ? "bg-emerald-950/60 border-emerald-800/80 text-emerald-300"
            : "bg-emerald-50 border-emerald-200 text-emerald-700"
          : isDark
          ? "bg-amber-950/60 border-amber-900/80 text-amber-300"
          : "bg-amber-50 border-amber-200 text-amber-700";
      case "stop":
        return isDark
          ? "bg-rose-950/60 border-rose-900/80 text-rose-300"
          : "bg-rose-50 border-rose-200 text-rose-700";
      case "voice":
        return isDark
          ? "bg-purple-950/60 border-purple-800/80 text-purple-300"
          : "bg-purple-50 border-purple-200 text-purple-700";
      default:
        return "bg-slate-50 border-slate-200 text-slate-700";
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
                isDark ? "text-emerald-400" : "text-emerald-700",
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
      className={cn(
        "flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border shadow-sm font-mono transition-colors duration-200 w-full",
        cueClasses,
      )}
      title={cue.raw}
    >
      {icon}
      <span className="font-medium tracking-wide uppercase text-[9px] shrink-0 opacity-80">
        {cue.type}
      </span>
      <span className="source-code truncate flex-1">
        {cue.type === "play" || cue.type === "stop" || cue.type === "queue"
          ? `${cue.channel}: `
          : ""}
        {effectiveSearch
          ? renderHighlightedText(cue.asset, effectiveSearch)
          : cue.asset}
      </span>
    </div>
  );
}

type SelectedNodeData = NodeData;

interface InspectorNodeDetailsProps {
  selectedNodeData: SelectedNodeData;
  selectedNodeId: string;
  selectedDialogueLineIndex: number | null;
  showAllInspectorLines: boolean;
  showMediaCuesInDialogue: boolean;
  setShowMediaCuesInDialogue: (show: boolean) => void;
  onToggleShowAllInspectorLines: () => void;
  effectiveSearch: string;
  theme: string;
  isDark: boolean;
  /** Reading speed WPM from the viewer store. */
  readingSpeedWpm: number;
  onSetPathStart: () => void;
  onSetPathTarget: () => void;
}

/* eslint-disable react-hooks/incompatible-library */
export function InspectorNodeDetails({
  selectedNodeData,
  selectedNodeId,
  selectedDialogueLineIndex,
  showAllInspectorLines,
  showMediaCuesInDialogue,
  setShowMediaCuesInDialogue,
  onToggleShowAllInspectorLines,
  effectiveSearch,
  theme,
  isDark,
  readingSpeedWpm,
  onSetPathStart,
  onSetPathTarget,
}: InspectorNodeDetailsProps) {
  const inspectorLinesScrollRef = useRef<HTMLDivElement | null>(null);

  const interleavedLines = useMemo(() => {
    const dialogueLines = selectedNodeData.dialogueLines ?? [];
    const dialogueLineNums = selectedNodeData.dialogueLineNums ?? [];
    const cues = selectedNodeData.audioAssetCues ?? [];

    const maxDialogueIdx = showAllInspectorLines
      ? dialogueLines.length
      : INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT;

    const visibleDialogueLines = dialogueLines.slice(0, maxDialogueIdx);
    const visibleDialogueLineNums = dialogueLineNums.slice(0, maxDialogueIdx);

    if (!showMediaCuesInDialogue) {
      return visibleDialogueLines.map((line, idx) => ({
        type: "dialogue" as const,
        lineNum: visibleDialogueLineNums[idx] ?? idx,
        dialogueText: line,
        dialogueIndex: idx + 1,
      }));
    }

    const items: Array<{
      type: "dialogue" | "cue";
      lineNum: number;
      dialogueText?: string;
      dialogueIndex?: number;
      cue?: import("../../domain/graph.ts").AudioAssetCue;
    }> = [];

    visibleDialogueLines.forEach((line, idx) => {
      items.push({
        type: "dialogue",
        lineNum: visibleDialogueLineNums[idx] ?? idx * 10,
        dialogueText: line,
        dialogueIndex: idx + 1,
      });
    });

    const lastVisibleLineNum =
      visibleDialogueLineNums[visibleDialogueLineNums.length - 1] ?? Infinity;

    cues.forEach((cue) => {
      if (
        !showAllInspectorLines && cue.lineNum !== undefined &&
        cue.lineNum > lastVisibleLineNum
      ) {
        return;
      }
      items.push({
        type: "cue",
        lineNum: cue.lineNum ?? 0,
        cue,
      });
    });

    items.sort((a, b) => {
      if (a.lineNum !== b.lineNum) {
        return a.lineNum - b.lineNum;
      }
      if (a.type !== b.type) {
        return a.type === "cue" ? -1 : 1;
      }
      return 0;
    });

    return items;
  }, [selectedNodeData, showMediaCuesInDialogue, showAllInspectorLines]);

  const shouldVirtualizeInspectorLines = interleavedLines.length > 120;

  const measureInspectorLineElement = useCallback(
    (element: HTMLDivElement) => element.getBoundingClientRect().height,
    [],
  );

  const inspectorLinesVirtualizer = useVirtualizer({
    count: shouldVirtualizeInspectorLines ? interleavedLines.length : 0,
    getScrollElement: () => inspectorLinesScrollRef.current,
    estimateSize: () => 34,
    measureElement: measureInspectorLineElement,
    overscan: 10,
  });

  const totalLines = selectedNodeData.dialogueLines?.length ?? 0;
  const showInspectorToggle = totalLines > INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-start gap-2">
        <div className="text-xs break-all">
          <span className="font-semibold text-gray-500">Node:</span>{" "}
          {selectedNodeData.label}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onSetPathStart}
            className={cn(
              "text-[10px] px-2 py-1 rounded border transition-colors",
              isDark
                ? "border-emerald-900 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
            )}
            title="Set as starting node for path finding"
          >
            Set Path Start
          </button>
          <button
            onClick={onSetPathTarget}
            className={cn(
              "text-[10px] px-2 py-1 rounded border transition-colors",
              isDark
                ? "border-rose-900 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60"
                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
            )}
            title="Set as target node for path finding"
          >
            Set Path Target
          </button>
        </div>
      </div>
      <div className="text-xs">
        <span className="font-semibold text-gray-500">
          Dialogue lines:
        </span>{" "}
        {selectedNodeData.dialogueCount ?? 0}
      </div>
      {(selectedNodeData.wordCount ?? 0) > 0 && (
        <div className="text-xs">
          <span className="font-semibold text-gray-500">Reading time:</span>
          {" "}
          <span
            title={`${
              (selectedNodeData.wordCount ?? 0).toLocaleString()
            } words · ${
              (selectedNodeData.pauseDuration ?? 0).toFixed(1)
            }s pauses`}
            style={{ cursor: "help" }}
          >
            {formatReadingTime(
              calculateReadingTimeSeconds(
                selectedNodeData.wordCount ?? 0,
                selectedNodeData.pauseDuration ?? 0,
                readingSpeedWpm,
              ),
            )}
          </span>
          <span className="text-gray-400">
            ({(selectedNodeData.wordCount ?? 0).toLocaleString()} words)
          </span>
        </div>
      )}
      {selectedNodeData.isOrphan && (
        <div
          className={cn(
            "text-xs p-2 rounded-lg border border-red-200 bg-red-50 text-red-800 flex flex-col gap-1 mt-2",
            isDark && "border-red-950 bg-red-950/40 text-red-200",
          )}
        >
          <div className="font-semibold flex items-center gap-1">
            <span>⚠️ Unreachable Code</span>
          </div>
          <p className="text-[10px] text-gray-500">
            This label is not connected to the main story flow and cannot be
            reached in gameplay.
          </p>
        </div>
      )}
      {selectedNodeData.characterDialogue &&
        Object.keys(selectedNodeData.characterDialogue).length > 0 && (
        <div
          className={cn(
            "text-xs space-y-1.5 mt-2 pt-2 border-t",
            isDark ? "border-slate-800" : "border-gray-100",
          )}
        >
          <div
            className={cn(
              "font-semibold",
              isDark ? "text-slate-300" : "text-gray-700",
            )}
          >
            Character Dialogue
          </div>
          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
            {Object.entries(selectedNodeData.characterDialogue).map(
              ([speaker, stats]) => {
                const pct =
                  ((stats.lineCount / (selectedNodeData.dialogueCount || 1)) *
                    100).toFixed(0);
                return (
                  <div
                    key={speaker}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="font-mono text-violet-500 font-semibold">
                      {speaker}
                    </span>
                    <span className="text-gray-400">
                      {stats.lineCount} line{stats.lineCount !== 1 ? "s" : ""}
                      {" "}
                      ({pct}%) · {stats.wordCount} words
                    </span>
                  </div>
                );
              },
            )}
          </div>
        </div>
      )}
      {selectedNodeData.collapsedLabels &&
        selectedNodeData.collapsedLabels.length > 0 && (
        <div
          className={cn(
            "text-xs space-y-1.5 mt-2 pt-2 border-t",
            isDark ? "border-slate-800" : "border-gray-100",
          )}
        >
          <div
            className={cn(
              "font-semibold",
              isDark ? "text-slate-300" : "text-gray-700",
            )}
          >
            Collapsed Labels ({selectedNodeData.collapsedLabels.length})
          </div>
          <div className="flex flex-col gap-1 max-h-24 overflow-y-auto font-mono text-[10px] text-gray-500 pr-1">
            {selectedNodeData.collapsedLabels.map((lbl, idx) => (
              <div key={idx} className="truncate">• {lbl}</div>
            ))}
          </div>
        </div>
      )}

      {!showMediaCuesInDialogue && selectedNodeData.audioAssetCues &&
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
            {selectedNodeData.audioAssetCues.map((cue, idx) => (
              <div key={idx}>
                {renderCueItem(cue, theme, effectiveSearch)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-2 mt-2">
        <div className="text-xs font-semibold">Dialogue</div>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-[11px]">
          <input
            type="checkbox"
            checked={showMediaCuesInDialogue}
            onChange={(e) => setShowMediaCuesInDialogue(e.target.checked)}
            className="rounded text-violet-600 focus:ring-violet-500 w-3 h-3"
            aria-label="Show Media Cues in Dialogue"
          />
          <span
            className={cn(isDark ? "text-slate-300" : "text-gray-600")}
          >
            Show Media Cues
          </span>
        </label>
      </div>
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
                  const item = interleavedLines[virtualItem.index];
                  if (!item) return null;

                  if (item.type === "cue") {
                    return (
                      <div
                        key={`${selectedNodeId}-cue-${virtualItem.key}`}
                        ref={inspectorLinesVirtualizer.measureElement}
                        data-index={virtualItem.index}
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          width: "100%",
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                        className="py-0.5"
                      >
                        {renderCueItem(
                          item.cue!,
                          theme,
                          effectiveSearch,
                        )}
                      </div>
                    );
                  }

                  const line = item.dialogueText ?? "";
                  const absoluteIndex = item.dialogueIndex!;
                  const isSelectedLine =
                    selectedDialogueLineIndex === absoluteIndex;
                  return (
                    <div
                      key={`${selectedNodeId}-line-${virtualItem.key}`}
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
                          : "border-gray-200 bg-white text-gray-800",
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
              {interleavedLines.map((item, idx) => {
                if (item.type === "cue") {
                  return (
                    <div
                      key={`${selectedNodeId}-cue-${idx}`}
                      className="py-0.5"
                    >
                      {renderCueItem(item.cue!, theme, effectiveSearch)}
                    </div>
                  );
                }

                const line = item.dialogueText ?? "";
                const absoluteIndex = item.dialogueIndex!;
                const isSelectedLine =
                  selectedDialogueLineIndex === absoluteIndex;
                return (
                  <div
                    key={`${selectedNodeId}-line-${idx}`}
                    className={cn(
                      "text-xs border rounded px-2 py-1 transition-colors",
                      isDark
                        ? isSelectedLine
                          ? "border-violet-500 bg-violet-950/50 text-violet-200"
                          : "border-slate-800 bg-slate-800/10 text-slate-300"
                        : isSelectedLine
                        ? "border-violet-400 bg-violet-50 text-violet-900"
                        : "border-gray-200 bg-white text-gray-800",
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

      {showInspectorToggle && (
        <button
          type="button"
          onClick={onToggleShowAllInspectorLines}
          className={cn(
            "text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 rounded transition-colors mt-2 cursor-pointer",
            isDark
              ? "text-violet-355 focus-visible:ring-violet-400"
              : "text-violet-700 focus-visible:ring-violet-500",
          )}
        >
          {showAllInspectorLines
            ? "Show less"
            : `Show more (${
              totalLines - INSPECTOR_DIALOGUE_TRUNCATE_DEFAULT
            } more)`}
        </button>
      )}
    </div>
  );
}
