import { BookOpen, Compass, Sparkles } from "lucide-react";
import type {
  ProjectNarrativeReport,
  StoryRoute,
} from "../../../domain/index.ts";

export interface AnalyticsOverviewTabProps {
  report: ProjectNarrativeReport;
  readingSpeedWpm: number;
  onHighlightRoute: (route: StoryRoute) => void;
}

export function AnalyticsOverviewTab({
  report,
  readingSpeedWpm,
  onHighlightRoute,
}: AnalyticsOverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Key Metric Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Endings
          </span>
          <span className="text-2xl font-bold font-mono text-violet-600 dark:text-violet-400 mt-1">
            {report.totalEndings}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            {report.reachableEndings.length} reachable ·{" "}
            {report.unreachableEndings.length} orphan
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Story Routes
          </span>
          <span className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
            {report.totalRoutes}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            Distinct narrative paths
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Unique Words
          </span>
          <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
            ~{report.totalUniqueStoryWords.toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            {report.formattedTotalUniqueReadingTime} total script
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Avg Playthrough
          </span>
          <span className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
            {report.formattedAverageReadingTime}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            At {readingSpeedWpm} WPM speed
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Points of No Return
          </span>
          <span className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">
            {report.pointsOfNoReturn.length}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            Branch lockout choices
          </span>
        </div>
      </div>

      {/* Route Extremes Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {report.shortestRoute && (
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <Compass size={14} /> Shortest Playthrough Route
                </span>
                <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                  {report.shortestRoute.formattedReadingTime}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 font-medium">
                Ending:{" "}
                <span className="font-bold font-mono">
                  {report.shortestRoute.terminalEnding.label}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {report.shortestRoute.nodeIds.length} steps ·{" "}
                {report.shortestRoute.choices.length}{" "}
                choices · ~{report.shortestRoute.wordCount.toLocaleString()}
                {" "}
                words
              </p>
            </div>
            <button
              type="button"
              onClick={() => onHighlightRoute(report.shortestRoute!)}
              className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 transition-colors w-fit cursor-pointer"
            >
              Highlight Shortest Route
            </button>
          </div>
        )}

        {report.longestRoute && (
          <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                  <BookOpen size={14} /> Longest / Completionist Route
                </span>
                <span className="font-mono font-bold text-sm text-blue-600 dark:text-blue-400">
                  {report.longestRoute.formattedReadingTime}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 font-medium">
                Ending:{" "}
                <span className="font-bold font-mono">
                  {report.longestRoute.terminalEnding.label}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {report.longestRoute.nodeIds.length} steps ·{" "}
                {report.longestRoute.choices.length}{" "}
                choices · ~{report.longestRoute.wordCount.toLocaleString()}{" "}
                words
              </p>
            </div>
            <button
              type="button"
              onClick={() => onHighlightRoute(report.longestRoute!)}
              className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 hover:bg-blue-100 transition-colors w-fit cursor-pointer"
            >
              Highlight Longest Route
            </button>
          </div>
        )}
      </div>

      {/* Insights & Metrics Breakdown */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/20 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Sparkles size={14} className="text-violet-500" />{" "}
          Structure & Pacing Dynamics
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80">
            <span className="text-slate-500 font-medium">
              Dialogue to Choice Ratio
            </span>
            <div className="text-lg font-bold font-mono text-slate-800 dark:text-slate-200 mt-0.5">
              {report.globalDialogueToChoiceRatio}{" "}
              <span className="text-xs font-normal text-slate-500">
                lines per menu
              </span>
            </div>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80">
            <span className="text-slate-500 font-medium">
              Average Branching Factor
            </span>
            <div className="text-lg font-bold font-mono text-slate-800 dark:text-slate-200 mt-0.5">
              {report.globalBranchingFactor}{" "}
              <span className="text-xs font-normal text-slate-500">
                options per choice
              </span>
            </div>
          </div>
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80">
            <span className="text-slate-500 font-medium">
              Ending Reachability Health
            </span>
            <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
              {report.totalEndings > 0
                ? Math.round(
                  (report.reachableEndings.length / report.totalEndings) * 100,
                )
                : 0}%{" "}
              <span className="text-xs font-normal text-slate-500">
                reachable
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
