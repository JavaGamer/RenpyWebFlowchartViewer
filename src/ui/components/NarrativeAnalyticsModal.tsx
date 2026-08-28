import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Award,
  BarChart3,
  Check,
  Copy,
  Download,
  Flame,
  GitBranch,
  Users,
} from "lucide-react";
import {
  type AnalyticsTab,
  downloadBlob,
  exportAnalyticsToMarkdown,
  exportCharacterStatsToCsv,
  exportEndingMatrixToCsv,
  exportRoutesToCsv,
  useAppStore,
  useViewerStore,
} from "../../application/index.ts";
import {
  generateProjectNarrativeReport,
  type HighlightedRoute,
  type ProjectNarrativeReport,
  type StoryRoute,
} from "../../domain/index.ts";
import { Modal } from "../primitives/index.ts";
import { cn } from "../utils/cn.ts";
import { AnalyticsOverviewTab } from "./analytics/AnalyticsOverviewTab.tsx";
import { AnalyticsEndingsTab } from "./analytics/AnalyticsEndingsTab.tsx";
import { AnalyticsRoutesTab } from "./analytics/AnalyticsRoutesTab.tsx";
import { AnalyticsPacingTab } from "./analytics/AnalyticsPacingTab.tsx";
import { AnalyticsCharactersTab } from "./analytics/AnalyticsCharactersTab.tsx";

import { RouteSolverModal } from "./RouteSolverModal.tsx";

export interface NarrativeAnalyticsModalProps {
  onFocusNode?: (nodeId: string) => void;
}

export function NarrativeAnalyticsModal({
  onFocusNode,
}: NarrativeAnalyticsModalProps) {
  const {
    isAnalyticsModalOpen,
    setAnalyticsModalOpen,
    activeAnalyticsTab,
    setActiveAnalyticsTab,
    setHighlightedRoute,
    customEndingTags,
    setCustomEndingTag,
    theme,
    readingSpeedWpm,
  } = useViewerStore(
    useShallow((s) => ({
      isAnalyticsModalOpen: s.isAnalyticsModalOpen,
      setAnalyticsModalOpen: s.setAnalyticsModalOpen,
      activeAnalyticsTab: s.activeAnalyticsTab,
      setActiveAnalyticsTab: s.setActiveAnalyticsTab,
      setHighlightedRoute: s.setHighlightedRoute,
      customEndingTags: s.customEndingTags,
      setCustomEndingTag: s.setCustomEndingTag,
      theme: s.theme,
      readingSpeedWpm: s.readingSpeedWpm,
    })),
  );

  const { flowNodes, flowEdges } = useAppStore(
    useShallow((s) => ({
      flowNodes: s.flowNodes,
      flowEdges: s.flowEdges,
    })),
  );

  const [copied, setCopied] = useState(false);
  const [isRouteSolverOpen, setIsRouteSolverOpen] = useState(false);
  const [routeSolverTargetId, setRouteSolverTargetId] = useState<string | null>(
    null,
  );
  const isDark = theme === "dark";

  // Clean timeout on unmount or reset
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // Compute or memoize narrative report
  const report = useMemo<ProjectNarrativeReport>(() => {
    if (flowNodes.length === 0) {
      return {
        totalEndings: 0,
        reachableEndings: [],
        unreachableEndings: [],
        totalRoutes: 0,
        routes: [],
        shortestRoute: null,
        longestRoute: null,
        averageReadingTimeSeconds: 0,
        formattedAverageReadingTime: "< 1m",
        totalUniqueStoryWords: 0,
        totalUniqueReadingTimeSeconds: 0,
        formattedTotalUniqueReadingTime: "< 1m",
        globalDialogueToChoiceRatio: 0,
        globalBranchingFactor: 0,
        pointsOfNoReturn: [],
        chapterPacing: {},
        characterStats: [],
        isTruncated: false,
      };
    }

    return generateProjectNarrativeReport(flowNodes, flowEdges, {
      readingSpeedWpm,
      customTags: customEndingTags,
    });
  }, [flowNodes, flowEdges, readingSpeedWpm, customEndingTags]);

  const handleHighlightRoute = useCallback((route: StoryRoute) => {
    const stepOrderMap: Record<string, number> = {};
    route.nodeIds.forEach((id, idx) => {
      stepOrderMap[id] = idx + 1;
    });

    const highlightPayload: HighlightedRoute = {
      routeId: route.routeId,
      name: `Route to ${route.terminalEnding.label}`,
      endingLabel: route.terminalEnding.label,
      nodeIds: route.nodeIds,
      edgeIds: route.edgeIds,
      stepOrderMap,
      totalWords: route.wordCount,
      formattedReadingTime: route.formattedReadingTime,
    };

    setHighlightedRoute(highlightPayload);
    setAnalyticsModalOpen(false);

    if (route.nodeIds.length > 0 && onFocusNode) {
      onFocusNode(route.nodeIds[0]!);
    }
  }, [setHighlightedRoute, setAnalyticsModalOpen, onFocusNode]);

  // Export handlers
  const handleExportMarkdown = useCallback(async () => {
    const md = exportAnalyticsToMarkdown(report);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    await downloadBlob(blob, "narrative-analytics-report.md");
  }, [report]);

  const handleExportCsvEndings = useCallback(async () => {
    const csv = exportEndingMatrixToCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    await downloadBlob(blob, "ending-matrix.csv");
  }, [report]);

  const handleExportCsvRoutes = useCallback(async () => {
    const csv = exportRoutesToCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    await downloadBlob(blob, "story-routes.csv");
  }, [report]);

  const handleExportCsvCharacters = useCallback(async () => {
    const csv = exportCharacterStatsToCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    await downloadBlob(blob, "character-stats.csv");
  }, [report]);

  const handleCopyMarkdown = useCallback(() => {
    const md = exportAnalyticsToMarkdown(report);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(md)
        .then(() => setCopied(true))
        .catch((err) => console.error("Failed to copy report:", err));
    }
  }, [report]);

  const tabs = useMemo<
    Array<{ id: AnalyticsTab; label: string; icon: typeof BarChart3 }>
  >(() => [
    { id: "overview", label: "Overview", icon: BarChart3 },
    {
      id: "endings",
      label: `Ending Matrix (${report.totalEndings})`,
      icon: Award,
    },
    {
      id: "routes",
      label: `Routes (${report.totalRoutes})`,
      icon: GitBranch,
    },
    { id: "pacing", label: "Pacing & Density", icon: Flame },
    {
      id: "characters",
      label: `Characters (${report.characterStats.length})`,
      icon: Users,
    },
  ], [report.characterStats.length, report.totalEndings, report.totalRoutes]);

  const tabButtonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let targetIdx = index;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        targetIdx = (index + 1) % tabs.length;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        targetIdx = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        targetIdx = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        targetIdx = tabs.length - 1;
      }

      if (targetIdx !== index) {
        setActiveAnalyticsTab(tabs[targetIdx]!.id);
        tabButtonRefs.current[targetIdx]?.focus();
      }
    },
    [tabs, setActiveAnalyticsTab],
  );

  return (
    <Modal
      open={isAnalyticsModalOpen}
      onOpenChange={setAnalyticsModalOpen}
      variant="centered"
      isDark={isDark}
      title="Narrative & Ending Analytics"
      description="Choice matrix, route reachability, pacing density, and reading times."
    >
      <div className="flex flex-col h-[78vh] max-h-[750px] w-full text-slate-800 dark:text-slate-100">
        {/* Navigation Tabs & Actions Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
          <nav aria-label="Analytics sections">
            <div
              role="tablist"
              aria-orientation="horizontal"
              className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/70 text-xs font-medium"
            >
              {tabs.map((tab, idx) => {
                const Icon = tab.icon;
                const isActive = activeAnalyticsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      tabButtonRefs.current[idx] = el;
                    }}
                    id={`analytics-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`analytics-panel-${tab.id}`}
                    tabIndex={isActive ? 0 : -1}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                    onClick={() => setActiveAnalyticsTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
                      isActive
                        ? "bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200",
                    )}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className={cn(
                "flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100",
              )}
              title="Copy full Markdown summary report to clipboard"
            >
              {copied
                ? <Check size={13} className="text-emerald-500" />
                : <Copy size={13} />}
              <span>{copied ? "Copied!" : "Copy MD"}</span>
            </button>

            <button
              type="button"
              onClick={handleExportMarkdown}
              className={cn(
                "flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100",
              )}
              title="Download Markdown Report"
            >
              <Download size={13} />
              <span>Export .md</span>
            </button>

            <button
              type="button"
              onClick={activeAnalyticsTab === "endings"
                ? handleExportCsvEndings
                : activeAnalyticsTab === "characters"
                ? handleExportCsvCharacters
                : handleExportCsvRoutes}
              className={cn(
                "flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-900/60",
              )}
              title="Download CSV export"
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Tab Content Panel */}
        <div
          role="tabpanel"
          id={`analytics-panel-${activeAnalyticsTab}`}
          aria-labelledby={`analytics-tab-${activeAnalyticsTab}`}
          className="flex-1 overflow-y-auto p-6 focus:outline-none"
          tabIndex={0}
        >
          {activeAnalyticsTab === "overview" && (
            <AnalyticsOverviewTab
              report={report}
              readingSpeedWpm={readingSpeedWpm}
              onHighlightRoute={handleHighlightRoute}
            />
          )}

          {activeAnalyticsTab === "endings" && (
            <AnalyticsEndingsTab
              report={report}
              onSetCustomEndingTag={setCustomEndingTag}
              onHighlightRoute={handleHighlightRoute}
              onSolveRoute={(nodeId) => {
                setRouteSolverTargetId(nodeId);
                setIsRouteSolverOpen(true);
              }}
            />
          )}

          {activeAnalyticsTab === "routes" && (
            <AnalyticsRoutesTab
              report={report}
              onHighlightRoute={handleHighlightRoute}
            />
          )}

          {activeAnalyticsTab === "pacing" && (
            <AnalyticsPacingTab report={report} />
          )}

          {activeAnalyticsTab === "characters" && (
            <AnalyticsCharactersTab report={report} />
          )}
        </div>
      </div>

      {isRouteSolverOpen && (
        <RouteSolverModal
          isOpen={isRouteSolverOpen}
          onClose={() => {
            setIsRouteSolverOpen(false);
            setRouteSolverTargetId(null);
          }}
          initialTargetNodeId={routeSolverTargetId || undefined}
          onFocusNode={onFocusNode}
        />
      )}
    </Modal>
  );
}
