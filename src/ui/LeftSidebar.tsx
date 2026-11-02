/**
 * src/ui/LeftSidebar.tsx
 *
 * Left-side workspace dock for the Ren'Py Web Flowchart Viewer.
 * Provides:
 * - Project File & Chapter Explorer (click to focus node)
 * - Label Explorer (click to jump/select node)
 * - Subgraph Collapse/Expand Quick Actions
 * - Quick Node Kind Visibility Filters (Labels, Menus, Decisions)
 * - Fast navigation & link to Advanced Controls
 */

import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode,
  Filter,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import { useViewerStore } from "../application/index.ts";
import type { ChapterStats } from "./components/ChapterFiltersSettings.tsx";
import { cn } from "./utils/cn.ts";

export interface LeftSidebarProps {
  chapters: string[];
  labels: string[];
  collapsedLabelCount?: number;
  visibleSubgraphLabels?: string[];
  visibleLabelSubgraphToggles?: string[];
  shouldShowAllLabelSubgraphToggles?: boolean;
  setAllVisibleSubgraphLabelsCollapsed?: (collapsed: boolean) => void;
  chapterStats?: ChapterStats;
  largeGraphMode?: boolean;
  largeGraphModeStatusText?: string;
  onFocusNode?: (nodeId: string) => void;
}

export function LeftSidebar({
  chapters,
  labels,
  collapsedLabelCount = 0,
  visibleSubgraphLabels = [],
  setAllVisibleSubgraphLabelsCollapsed,
  chapterStats,
  onFocusNode,
}: LeftSidebarProps) {
  const isLeftSidebarOpen = useViewerStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useViewerStore((s) => s.toggleLeftSidebar);
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const selectedSearchNodeKinds = useViewerStore(
    (s) => s.selectedSearchNodeKinds,
  );
  const setSelectedSearchNodeKinds = useViewerStore(
    (s) => s.setSelectedSearchNodeKinds,
  );
  const selectedSearchChapter = useViewerStore((s) => s.selectedSearchChapter);
  const setSelectedSearchChapter = useViewerStore(
    (s) => s.setSelectedSearchChapter,
  );
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useViewerStore((s) => s.setSelectedNodeId);
  const setShowAdvancedControls = useViewerStore(
    (s) => s.setShowAdvancedControls,
  );
  const collapsedChapters = useViewerStore((s) => s.collapsedChapters);
  const toggleChapterCollapse = useViewerStore((s) => s.toggleChapterCollapse);
  const setAllChaptersCollapsed = useViewerStore((s) => s.setAllChaptersCollapsed);

  const [explorerOpen, setExplorerOpen] = useState(true);
  const [labelsOpen, setLabelsOpen] = useState(true);
  const [labelFilter, setLabelFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);

  const filteredLabels = useMemo(() => {
    if (!labelFilter.trim()) return labels;
    const lower = labelFilter.trim().toLowerCase();
    return labels.filter((lbl) => lbl.toLowerCase().includes(lower));
  }, [labels, labelFilter]);

  if (!isLeftSidebarOpen) {
    return null;
  }

  const toggleKind = (kind: "LABEL" | "MENU" | "DECISION") => {
    setSelectedSearchNodeKinds({
      ...selectedSearchNodeKinds,
      [kind]: !selectedSearchNodeKinds[kind],
    });
  };

  return (
    <aside
      className={cn(
        "w-full xl:w-64 max-h-[40vh] xl:max-h-none shrink-0 border-b xl:border-b-0 xl:border-r flex flex-col z-20 text-xs overflow-y-auto transition-colors duration-200 select-none",
        isDark
          ? "bg-slate-900 border-slate-800 text-slate-100"
          : "bg-white border-gray-200 text-gray-900 shadow-xs",
      )}
      aria-label="Files and filters dock"
    >
      {/* Sidebar Header */}
      <div
        className={cn(
          "h-9 px-3 border-b flex items-center justify-between font-semibold shrink-0",
          isDark
            ? "border-slate-800 bg-slate-900/80 text-slate-200"
            : "border-gray-200 bg-gray-50/80 text-gray-700",
        )}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Layers size={14} className="text-violet-500" />
          <span>Explorer & Filters</span>
        </span>
        <button
          type="button"
          onClick={toggleLeftSidebar}
          className={cn(
            "p-1 rounded transition-colors cursor-pointer",
            isDark
              ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              : "text-gray-400 hover:text-gray-700 hover:bg-gray-100",
          )}
          aria-label="Close left sidebar"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-4">
        {/* Accordion 1: Project Files & Chapters Explorer */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setExplorerOpen((prev) => !prev)}
            aria-expanded={explorerOpen}
            className={cn(
              "flex items-center justify-between text-[11px] font-bold uppercase tracking-wider py-0.5 text-left transition-colors w-full cursor-pointer rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400",
              isDark
                ? "text-slate-500 hover:text-slate-300"
                : "text-gray-500 hover:text-gray-800",
            )}
            title={`${chapters.length} chapters, ${labels.length} labels`}
          >
            <span className="flex items-center gap-1">
              <BookOpen size={12} />
              <span>Chapters ({chapters.length})</span>
            </span>
            {explorerOpen
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
          </button>

          {explorerOpen && (
            <div className="flex flex-col gap-1 pt-1">
              {chapters.length === 0
                ? (
                  <div
                    className={cn(
                      "text-[11px] py-1 italic",
                      isDark ? "text-slate-500" : "text-gray-400",
                    )}
                  >
                    No chapters defined in scripts
                  </div>
                )
                : (
                  chapters.map((ch) => {
                    const stats = chapterStats?.get(ch);
                    const isSelected = selectedSearchChapter === ch;
                    const isChapterCollapsed = Boolean(collapsedChapters[ch]);

                    return (
                      <div
                        key={ch}
                        className={cn(
                          "w-full px-2 py-1 rounded flex items-center justify-between text-xs border transition-colors group",
                          isSelected
                            ? (isDark
                              ? "bg-violet-950/60 border-violet-800 text-violet-200 font-semibold"
                              : "bg-violet-50 border-violet-200 text-violet-800 font-semibold")
                            : (isDark
                              ? "border-transparent hover:bg-slate-800 text-slate-300"
                              : "border-transparent hover:bg-gray-100 text-gray-700"),
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSearchChapter(isSelected ? "" : ch);
                            if (onFocusNode) {
                              onFocusNode(ch);
                            }
                          }}
                          className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                          title={`Filter by chapter: ${ch}`}
                        >
                          <FileCode
                            size={13}
                            className={isSelected
                              ? (isDark ? "text-violet-400" : "text-violet-600")
                              : (isDark ? "text-slate-400" : "text-gray-400")}
                          />
                          <span className={cn(
                            "truncate font-mono text-[11px]",
                            isChapterCollapsed && "line-through opacity-75",
                          )}>
                            {ch}
                          </span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {stats && stats.wordCount > 0 && (
                            <span
                              className={cn(
                                "text-[10px] font-mono",
                                isDark ? "text-slate-500" : "text-gray-500",
                              )}
                            >
                              {stats.wordCount.toLocaleString()}w
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleChapterCollapse(ch);
                            }}
                            aria-label={isChapterCollapsed
                              ? `Expand chapter ${ch}`
                              : `Collapse chapter ${ch}`}
                            title={isChapterCollapsed
                              ? `Expand chapter ${ch}`
                              : `Collapse chapter ${ch}`}
                            className={cn(
                              "p-0.5 rounded transition-colors cursor-pointer",
                              isChapterCollapsed
                                ? "text-amber-500 hover:text-amber-400"
                                : (isDark
                                  ? "text-slate-400 hover:text-slate-200"
                                  : "text-gray-400 hover:text-gray-600"),
                            )}
                          >
                            {isChapterCollapsed
                              ? <EyeOff size={11} aria-hidden="true" />
                              : <Eye size={11} aria-hidden="true" />}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              {chapters.length > 1 && (
                <div
                  className={cn(
                    "flex items-center gap-1.5 pt-1.5 mt-0.5 border-t",
                    isDark ? "border-slate-800" : "border-gray-200",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setAllChaptersCollapsed(true)}
                    className={cn(
                      "px-2 py-0.5 rounded border text-[10px] font-medium transition-colors cursor-pointer",
                      isDark
                        ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200",
                    )}
                  >
                    Collapse All
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllChaptersCollapsed(false)}
                    className={cn(
                      "px-2 py-0.5 rounded border text-[10px] font-medium transition-colors cursor-pointer",
                      isDark
                        ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200",
                    )}
                  >
                    Expand All
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Accordion 2: Story Labels Explorer */}
        {labels.length > 0 && (
          <div
            className={cn(
              "flex flex-col gap-1.5 pt-2 border-t",
              isDark ? "border-slate-800" : "border-gray-200",
            )}
          >
            <button
              type="button"
              onClick={() => setLabelsOpen((prev) => !prev)}
              aria-expanded={labelsOpen}
              className={cn(
                "flex items-center justify-between text-[11px] font-bold uppercase tracking-wider py-0.5 text-left transition-colors w-full cursor-pointer rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400",
                isDark
                  ? "text-slate-500 hover:text-slate-300"
                  : "text-gray-500 hover:text-gray-800",
              )}
              title={`${labels.length} story labels`}
            >
              <span className="flex items-center gap-1">
                <Tag size={12} />
                <span>Story Labels ({labels.length})</span>
              </span>
              {labelsOpen
                ? <ChevronDown size={14} />
                : <ChevronRight size={14} />}
            </button>

            {labelsOpen && (
              <div className="flex flex-col gap-1 pt-1">
                {labels.length > 8 && (
                  <div className="relative mb-1 flex items-center">
                    <input
                      type="text"
                      value={labelFilter}
                      onChange={(e) => setLabelFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setLabelFilter("");
                        }
                      }}
                      placeholder="Filter labels..."
                      aria-label="Filter labels"
                      className={cn(
                        "w-full h-6 pl-2 text-[11px] rounded border transition-colors font-mono",
                        labelFilter.length > 0 ? "pr-6" : "pr-2",
                        isDark
                          ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus-visible:ring-1 focus-visible:ring-violet-400"
                          : "bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus-visible:ring-1 focus-visible:ring-violet-500",
                      )}
                    />
                    {labelFilter.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setLabelFilter("")}
                        className={cn(
                          "absolute right-1 p-0.5 rounded-full transition-colors cursor-pointer",
                          isDark
                            ? "text-slate-400 hover:text-slate-200"
                            : "text-gray-400 hover:text-gray-600",
                        )}
                        aria-label="Clear label filter"
                        title="Clear label filter"
                      >
                        <X size={10} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto pr-1">
                  {filteredLabels.map((lbl) => {
                    const isSelected = selectedNodeId === lbl;
                    const isSubgraph = visibleSubgraphLabels.includes(lbl);

                    return (
                      <button
                        type="button"
                        key={lbl}
                        onClick={() => {
                          if (onFocusNode) {
                            onFocusNode(lbl);
                          }
                          setSelectedNodeId(lbl);
                        }}
                        className={cn(
                          "w-full px-2 py-1 rounded flex items-center justify-between text-xs cursor-pointer border transition-colors text-left",
                          isSelected
                            ? (isDark
                              ? "bg-violet-950/60 border-violet-800 text-violet-200 font-semibold"
                              : "bg-violet-50 border-violet-200 text-violet-800 font-semibold")
                            : (isDark
                              ? "border-transparent hover:bg-slate-800 text-slate-300"
                              : "border-transparent hover:bg-gray-100 text-gray-700"),
                        )}
                        title={`Focus label: ${lbl}`}
                      >
                        <span className="truncate font-mono text-[11px]">
                          {lbl}
                        </span>
                        {isSubgraph && (
                          <span
                            className={cn(
                              "text-[9px] px-1 rounded uppercase font-semibold font-mono shrink-0 ml-1 border",
                              isDark
                                ? "bg-slate-800 border-slate-700 text-violet-400"
                                : "bg-violet-50 border-violet-200 text-violet-700",
                            )}
                          >
                            subgraph
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {filteredLabels.length === 0 && (
                    <div
                      className={cn(
                        "text-[11px] py-1 italic",
                        isDark ? "text-slate-500" : "text-gray-400",
                      )}
                    >
                      No matching labels
                    </div>
                  )}
                </div>

                {visibleSubgraphLabels.length > 0 &&
                  setAllVisibleSubgraphLabelsCollapsed && (
                  <div
                    className={cn(
                      "flex items-center gap-1.5 pt-2 mt-1 border-t",
                      isDark ? "border-slate-800" : "border-gray-200",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setAllVisibleSubgraphLabelsCollapsed(true)}
                      className={cn(
                        "px-2 py-0.5 rounded border text-[10px] font-medium transition-colors cursor-pointer",
                        isDark
                          ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                          : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200",
                      )}
                    >
                      Collapse All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAllVisibleSubgraphLabelsCollapsed(false)}
                      className={cn(
                        "px-2 py-0.5 rounded border text-[10px] font-medium transition-colors cursor-pointer",
                        isDark
                          ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                          : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200",
                      )}
                    >
                      Expand All
                    </button>
                    {collapsedLabelCount > 0 && (
                      <span
                        className={cn(
                          "text-[10px] font-mono ml-auto",
                          isDark ? "text-violet-400" : "text-violet-600",
                        )}
                      >
                        {collapsedLabelCount} collapsed
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Accordion 3: Node Kind Filters */}
        <div
          className={cn(
            "flex flex-col gap-1.5 pt-2 border-t",
            isDark ? "border-slate-800" : "border-gray-200",
          )}
        >
          <button
            type="button"
            onClick={() => setFiltersOpen((prev) => !prev)}
            aria-expanded={filtersOpen}
            className={cn(
              "flex items-center justify-between text-[11px] font-bold uppercase tracking-wider py-0.5 text-left transition-colors cursor-pointer rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400",
              isDark
                ? "text-slate-500 hover:text-slate-300"
                : "text-gray-500 hover:text-gray-800",
            )}
          >
            <span className="flex items-center gap-1">
              <Filter size={12} />
              <span>Visible Node Kinds</span>
            </span>
            {filtersOpen
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
          </button>

          {filtersOpen && (
            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={selectedSearchNodeKinds.LABEL}
                  onChange={() => toggleKind("LABEL")}
                  className="rounded text-violet-600 focus:ring-violet-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span
                  className={cn(
                    "font-mono font-semibold text-[11px]",
                    isDark ? "text-violet-400" : "text-violet-700",
                  )}
                >
                  [LABEL]
                </span>
                <span
                  className={cn(
                    "text-[11px]",
                    isDark ? "text-slate-400" : "text-gray-600",
                  )}
                >
                  Story labels
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={selectedSearchNodeKinds.MENU}
                  onChange={() => toggleKind("MENU")}
                  className="rounded text-amber-500 focus:ring-amber-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span
                  className={cn(
                    "font-mono font-semibold text-[11px]",
                    isDark ? "text-amber-400" : "text-amber-700",
                  )}
                >
                  [MENU]
                </span>
                <span
                  className={cn(
                    "text-[11px]",
                    isDark ? "text-slate-400" : "text-gray-600",
                  )}
                >
                  Branch choices
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={selectedSearchNodeKinds.DECISION}
                  onChange={() => toggleKind("DECISION")}
                  className="rounded text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span
                  className={cn(
                    "font-mono font-semibold text-[11px]",
                    isDark ? "text-teal-400" : "text-teal-700",
                  )}
                >
                  [DECISION]
                </span>
                <span
                  className={cn(
                    "text-[11px]",
                    isDark ? "text-slate-400" : "text-gray-600",
                  )}
                >
                  Logic branches
                </span>
              </label>

              {(!selectedSearchNodeKinds.LABEL ||
                !selectedSearchNodeKinds.MENU ||
                !selectedSearchNodeKinds.DECISION) && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSearchNodeKinds({
                      LABEL: true,
                      MENU: true,
                      DECISION: true,
                    })}
                  className={cn(
                    "mt-1 text-[10px] font-medium px-2 py-0.5 rounded border self-start transition-colors cursor-pointer",
                    isDark
                      ? "text-violet-300 border-slate-700 bg-slate-800 hover:bg-slate-700"
                      : "text-violet-700 border-gray-200 bg-gray-50 hover:bg-gray-100",
                  )}
                >
                  Reset / Select All
                </button>
              )}
            </div>
          )}
        </div>

        {/* Quick Link to Advanced Graph Controls Modal */}
        <div
          className={cn(
            "pt-2 border-t",
            isDark ? "border-slate-800" : "border-gray-200",
          )}
        >
          <button
            type="button"
            onClick={() => setShowAdvancedControls(true)}
            className={cn(
              "w-full px-2.5 py-1.5 rounded border text-xs font-medium flex items-center justify-between transition-colors cursor-pointer",
              isDark
                ? "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:text-gray-900",
            )}
          >
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal size={13} className="text-violet-500" />
              <span>Advanced Settings...</span>
            </span>
            <ChevronRight size={13} className="text-slate-400" />
          </button>
        </div>
      </div>
    </aside>
  );
}
