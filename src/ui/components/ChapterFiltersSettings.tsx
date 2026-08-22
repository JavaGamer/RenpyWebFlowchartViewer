import { useShallow } from "zustand/react/shallow";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "../utils/readingTime.ts";
import { useViewerStore } from "../../application/index.ts";
import {
  CONTROL_BUTTON_CLASS,
  CONTROL_INPUT_CLASS,
  MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES,
} from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";

/** Per-chapter word count and pause duration aggregated from parsed nodes. */
export type ChapterStats = Map<
  string,
  { wordCount: number; pauseDuration: number }
>;

export interface ChapterFiltersSettingsProps {
  chapters: string[];
  labels: string[];
  collapsedLabelCount: number;
  visibleSubgraphLabels: string[];
  visibleLabelSubgraphToggles: string[];
  shouldShowAllLabelSubgraphToggles: boolean;
  setAllVisibleSubgraphLabelsCollapsed: (collapsed: boolean) => void;
  /** Optional stats keyed by chapter name for reading time display. */
  chapterStats?: ChapterStats;
}

export function ChapterFiltersSettings({
  chapters,
  labels,
  collapsedLabelCount,
  visibleSubgraphLabels,
  visibleLabelSubgraphToggles,
  shouldShowAllLabelSubgraphToggles,
  setAllVisibleSubgraphLabelsCollapsed,
  chapterStats,
}: ChapterFiltersSettingsProps) {
  const {
    theme,
    enableCompoundContainers,
    collapsedChapters,
    labelSubgraphSearchInput,
    collapsedParentLabels,
    readingSpeedWpm,

    setEnableCompoundContainers,
    toggleChapter,
    setAllChaptersCollapsed,
    setLabelSubgraphSearchInput,
    toggleParentLabel,
    toggleShowAllLabelSubgraphToggles,
  } = useViewerStore(
    useShallow((s) => ({
      theme: s.theme,
      enableCompoundContainers: s.enableCompoundContainers,
      collapsedChapters: s.collapsedChapters,
      labelSubgraphSearchInput: s.labelSubgraphSearchInput,
      collapsedParentLabels: s.collapsedParentLabels,
      readingSpeedWpm: s.readingSpeedWpm,

      setEnableCompoundContainers: s.setEnableCompoundContainers,
      toggleChapter: s.toggleChapter,
      setAllChaptersCollapsed: s.setAllChaptersCollapsed,
      setLabelSubgraphSearchInput: s.setLabelSubgraphSearchInput,
      toggleParentLabel: s.toggleParentLabel,
      toggleShowAllLabelSubgraphToggles: s.toggleShowAllLabelSubgraphToggles,
    })),
  );

  const isDark = theme === "dark";

  if (chapters.length === 0 && labels.length === 0) {
    return null;
  }

  const allCollapsed = chapters.length > 0 &&
    chapters.every((ch) => collapsedChapters[ch]);

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Chapter and label subgraph filters"
    >
      <h3
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          isDark ? "text-slate-500" : "text-gray-400",
        )}
      >
        Subgraphs & Containers
      </h3>
      <div
        className={cn(
          "flex flex-col gap-3.5 p-3 rounded-lg border text-xs",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        {chapters.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span
                className={cn(
                  "font-semibold text-xs",
                  isDark ? "text-slate-300" : "text-gray-700",
                )}
              >
                Chapter Containers
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setAllChaptersCollapsed(chapters, !allCollapsed)}
                  className={cn(
                    "text-[11px] font-medium px-2 py-0.5 rounded border transition-colors cursor-pointer",
                    isDark
                      ? "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300"
                      : "bg-white hover:bg-gray-100 border-gray-200 text-gray-700",
                  )}
                >
                  {allCollapsed ? "Expand All" : "Collapse All"}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs mb-1">
              <input
                type="checkbox"
                checked={enableCompoundContainers}
                onChange={(e) => setEnableCompoundContainers(e.target.checked)}
                className="rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
              />
              <span className={isDark ? "text-slate-300" : "text-gray-700"}>
                Group nodes into visually bounded chapter containers
              </span>
            </label>

            <div className="flex flex-wrap gap-1.5">
              {chapters.map((chapter) => {
                const stats = chapterStats?.get(chapter);
                const hasTime = stats && stats.wordCount > 0;
                const readingTime = hasTime
                  ? formatReadingTime(
                    calculateReadingTimeSeconds(
                      stats.wordCount,
                      stats.pauseDuration,
                      readingSpeedWpm,
                    ),
                  )
                  : null;
                return (
                  <button
                    type="button"
                    key={chapter}
                    onClick={() => toggleChapter(chapter)}
                    className={cn(
                      CONTROL_BUTTON_CLASS,
                      "cursor-pointer transition-colors",
                      isDark
                        ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-100",
                    )}
                    aria-label={`${
                      collapsedChapters[chapter] ? "Expand" : "Collapse"
                    } chapter ${chapter}${
                      readingTime ? ` (${readingTime} reading time)` : ""
                    }`}
                  >
                    {collapsedChapters[chapter] ? "▸" : "▾"} {chapter}
                    {readingTime && (
                      <span
                        style={{
                          opacity: 0.6,
                          marginLeft: "0.25em",
                          fontSize: "0.85em",
                        }}
                      >
                        {readingTime}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {labels.length > 0 && (
          <div
            className={cn(
              "flex flex-col gap-2.5 border-t pt-2.5",
              isDark ? "border-slate-700" : "border-gray-100",
            )}
          >
            <div className="flex justify-between items-center">
              <span
                className={cn(
                  "font-semibold text-xs",
                  isDark ? "text-slate-300" : "text-gray-700",
                )}
              >
                Label Subgraphs
              </span>
              <span
                className={cn(
                  "text-[11px]",
                  isDark ? "text-slate-400" : "text-gray-500",
                )}
                aria-live="polite"
              >
                {collapsedLabelCount} collapsed
              </span>
            </div>
            <div className="flex gap-2">
              <input
                id="label-subgraph-filter"
                type="search"
                value={labelSubgraphSearchInput}
                onChange={(e) => setLabelSubgraphSearchInput(e.target.value)}
                placeholder="Filter labels"
                aria-label="Filter label subgraphs"
                className={cn(
                  "flex-1 min-w-0",
                  CONTROL_INPUT_CLASS,
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
                )}
              />
              <button
                type="button"
                onClick={() => setAllVisibleSubgraphLabelsCollapsed(true)}
                disabled={visibleSubgraphLabels.length === 0}
                className={cn(
                  CONTROL_BUTTON_CLASS,
                  "cursor-pointer",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                )}
                aria-label="Collapse all visible label subgraphs"
              >
                Collapse all
              </button>
              <button
                type="button"
                onClick={() => setAllVisibleSubgraphLabelsCollapsed(false)}
                disabled={visibleSubgraphLabels.length === 0}
                className={cn(
                  CONTROL_BUTTON_CLASS,
                  "cursor-pointer",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                )}
                aria-label="Expand all visible label subgraphs"
              >
                Expand all
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
              {visibleSubgraphLabels.length === 0
                ? (
                  <span
                    className={cn(
                      "text-[11px]",
                      isDark ? "text-slate-400" : "text-gray-500",
                    )}
                  >
                    No labels match the filter.
                  </span>
                )
                : (
                  <>
                    {visibleLabelSubgraphToggles.map((label) => (
                      <button
                        type="button"
                        key={label}
                        onClick={() => toggleParentLabel(label)}
                        className={cn(
                          CONTROL_BUTTON_CLASS,
                          "cursor-pointer",
                          isDark
                            ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                            : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                        )}
                        aria-label={`${
                          collapsedParentLabels[label] ? "Expand" : "Collapse"
                        } label ${label}`}
                      >
                        {collapsedParentLabels[label] ? "▸" : "▾"} {label}
                      </button>
                    ))}
                    {visibleSubgraphLabels.length >
                        MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES && (
                      <button
                        type="button"
                        onClick={toggleShowAllLabelSubgraphToggles}
                        className={cn(
                          CONTROL_BUTTON_CLASS,
                          "cursor-pointer",
                          isDark
                            ? "bg-violet-950/40 text-violet-300 hover:bg-violet-950/80 border-violet-800/80"
                            : "bg-violet-50 text-violet-700 hover:bg-violet-100 border-violet-200",
                        )}
                        aria-label={shouldShowAllLabelSubgraphToggles
                          ? "Show fewer label subgraph toggles"
                          : `Show ${
                            Math.max(
                              visibleSubgraphLabels.length -
                                MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES,
                              0,
                            )
                          } more label subgraph toggles`}
                      >
                        {shouldShowAllLabelSubgraphToggles
                          ? "Show fewer"
                          : `Show ${
                            Math.max(
                              visibleSubgraphLabels.length -
                                MAX_VISIBLE_LABEL_SUBGRAPH_TOGGLES,
                              0,
                            )
                          } more`}
                      </button>
                    )}
                  </>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
