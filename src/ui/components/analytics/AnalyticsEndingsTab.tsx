import { AlertTriangle, Award } from "lucide-react";
import type {
  EndingType,
  ProjectNarrativeReport,
  StoryRoute,
} from "../../../domain/index.ts";

export interface AnalyticsEndingsTabProps {
  report: ProjectNarrativeReport;
  onSetCustomEndingTag: (nodeId: string, tag: EndingType) => void;
  onHighlightRoute: (route: StoryRoute) => void;
}

const ENDING_TAG_OPTIONS: Array<{ value: EndingType; label: string }> = [
  { value: "good", label: "Good Ending" },
  { value: "bad", label: "Bad Ending" },
  { value: "true", label: "True Ending" },
  { value: "normal", label: "Normal Ending" },
  { value: "dead_end", label: "Dead-End" },
  { value: "custom", label: "Custom Tag" },
];

export function AnalyticsEndingsTab({
  report,
  onSetCustomEndingTag,
  onHighlightRoute,
}: AnalyticsEndingsTabProps) {
  const allEndings = [...report.reachableEndings, ...report.unreachableEndings];

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Terminal story outcomes discovered in the Ren'Py scripts. You can
        customize the classification tag for each ending below:
      </div>

      <div className="border rounded-xl overflow-x-auto border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs border-collapse">
          <caption className="sr-only">
            Discovered story endings and reachability matrix
          </caption>
          <thead>
            <tr className="border-b bg-slate-100/70 dark:bg-slate-800/60 font-semibold text-slate-600 dark:text-slate-300">
              <th scope="col" className="p-3">Ending Label</th>
              <th scope="col" className="p-3">Chapter</th>
              <th scope="col" className="p-3">Classification</th>
              <th scope="col" className="p-3">Reachable Routes</th>
              <th scope="col" className="p-3">Word Volume</th>
              <th scope="col" className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {allEndings.map((ending) => {
              const primaryRoute = report.routes.find(
                (r) => r.terminalEnding.nodeId === ending.nodeId,
              );
              return (
                <tr
                  key={ending.nodeId}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="p-3 font-mono font-bold">
                    <div className="flex items-center gap-1.5">
                      {ending.isOrphan
                        ? (
                          <span title="Orphan node: unreachable from entry points">
                            <AlertTriangle
                              size={14}
                              className="text-rose-500 shrink-0"
                            />
                          </span>
                        )
                        : (
                          <Award
                            size={14}
                            className="text-violet-500 shrink-0"
                          />
                        )}
                      <span>{ending.label}</span>
                    </div>
                  </td>
                  <td className="p-3 text-slate-500 font-mono text-[11px]">
                    {ending.chapter ?? "Uncategorized"}
                  </td>
                  <td className="p-3">
                    <select
                      value={ending.endingType}
                      aria-label={`Classification for ${ending.label}`}
                      onChange={(e) =>
                        onSetCustomEndingTag(
                          ending.nodeId,
                          e.target.value as EndingType,
                        )}
                      className="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500"
                    >
                      {ENDING_TAG_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3 font-mono">
                    {ending.isOrphan
                      ? (
                        <span className="text-rose-500 font-semibold">
                          0 (Unreachable)
                        </span>
                      )
                      : (
                        <span className="font-semibold">
                          {ending.totalReachableRoutes} routes
                        </span>
                      )}
                  </td>
                  <td className="p-3 font-mono text-slate-500">
                    ~{ending.wordCount.toLocaleString()} words ·{" "}
                    {ending.dialogueCount} lines
                  </td>
                  <td className="p-3 text-right">
                    {primaryRoute
                      ? (
                        <button
                          type="button"
                          onClick={() => onHighlightRoute(primaryRoute)}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 hover:bg-violet-100 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500"
                        >
                          Highlight Route
                        </button>
                      )
                      : (
                        <span className="text-[11px] text-slate-400 italic">
                          No route
                        </span>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
