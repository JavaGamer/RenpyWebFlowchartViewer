import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type {
  ProjectNarrativeReport,
  StoryRoute,
} from "../../../domain/index.ts";

export interface AnalyticsRoutesTabProps {
  report: ProjectNarrativeReport;
  onHighlightRoute: (route: StoryRoute) => void;
}

export function AnalyticsRoutesTab({
  report,
  onHighlightRoute,
}: AnalyticsRoutesTabProps) {
  const [routeSearch, setRouteSearch] = useState("");

  const filteredRoutes = useMemo(() => {
    if (!routeSearch.trim()) return report.routes;
    const q = routeSearch.toLowerCase();
    return report.routes.filter(
      (r) =>
        r.routeId.toLowerCase().includes(q) ||
        r.terminalEnding.label.toLowerCase().includes(q) ||
        r.choices.some((c) => (c.choiceText ?? "").toLowerCase().includes(q)),
    );
  }, [report.routes, routeSearch]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          aria-label="Filter routes by ending or decision text"
          value={routeSearch}
          onChange={(e) => setRouteSearch(e.target.value)}
          placeholder="Filter routes by ending or decision text..."
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 w-full sm:w-80 focus-visible:ring-2 focus-visible:ring-violet-500"
        />
        <span className="text-xs text-slate-500">
          Showing {filteredRoutes.length} of {report.totalRoutes}{" "}
          distinct routes
        </span>
      </div>

      {/* Routes Table */}
      <div className="border rounded-xl overflow-x-auto border-slate-200 dark:border-slate-800 max-h-[380px] overflow-y-auto">
        <table className="w-full text-left text-xs border-collapse">
          <caption className="sr-only">
            Enumerated narrative story routes
          </caption>
          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 font-semibold text-slate-600 dark:text-slate-300 z-10">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="p-3">Route ID</th>
              <th scope="col" className="p-3">Terminal Ending</th>
              <th scope="col" className="p-3">Duration & Words</th>
              <th scope="col" className="p-3">Key Choices Traversed</th>
              <th scope="col" className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredRoutes.map((route) => (
              <tr
                key={route.routeId}
                className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                <td className="p-3 font-mono font-bold text-slate-500">
                  {route.routeId}
                  {route.hasCycle && (
                    <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                      Loop
                    </span>
                  )}
                </td>
                <td className="p-3 font-mono font-semibold">
                  <span className="text-violet-600 dark:text-violet-400">
                    {route.terminalEnding.label}
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    {route.nodeIds.length} nodes ·{" "}
                    {route.chaptersTraversed.join(", ")}
                  </span>
                </td>
                <td className="p-3 font-mono">
                  <span className="font-semibold">
                    {route.formattedReadingTime}
                  </span>
                  <span className="text-slate-400 text-[11px] block">
                    ~{route.wordCount.toLocaleString()} words
                  </span>
                </td>
                <td
                  className="p-3 text-slate-600 dark:text-slate-300 max-w-sm"
                  title={route.choices.map((c) =>
                    `${c.menuLabel}: "${c.choiceText ?? "Choice"}"`
                  ).join(" → ")}
                >
                  {route.choices.length === 0
                    ? (
                      <span className="text-slate-400 italic">
                        Linear (0 choices)
                      </span>
                    )
                    : (
                      <div className="flex flex-wrap gap-1">
                        {route.choices.map((c, i) => (
                          <span
                            key={i}
                            className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 max-w-[180px] truncate"
                          >
                            {c.choiceText ?? c.menuLabel}
                          </span>
                        ))}
                      </div>
                    )}
                </td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    onClick={() => onHighlightRoute(route)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 hover:bg-violet-100 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    Highlight
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Points of No Return Section */}
      {report.pointsOfNoReturn.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-rose-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Points of No Return ({report.pointsOfNoReturn.length}{" "}
              Decision Lockouts)
            </h3>
          </div>
          <p className="text-xs text-slate-500">
            Choices or branch decisions that permanently eliminate specific
            story outcomes:
          </p>

          <div className="border rounded-xl overflow-x-auto border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <caption className="sr-only">
                Points of No Return decision lockouts
              </caption>
              <thead>
                <tr className="border-b bg-slate-100/70 dark:bg-slate-800/60 font-semibold text-slate-600 dark:text-slate-300">
                  <th scope="col" className="p-3">Decision Origin</th>
                  <th scope="col" className="p-3">Choice / Branch</th>
                  <th scope="col" className="p-3">Target Node</th>
                  <th scope="col" className="p-3">Eliminated Endings</th>
                  <th scope="col" className="p-3">Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {report.pointsOfNoReturn.map((ponr, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="p-3 font-mono font-bold">
                      {ponr.sourceNodeLabel}
                    </td>
                    <td className="p-3 text-violet-600 dark:text-violet-400 font-semibold">
                      {ponr.choiceText ? `"${ponr.choiceText}"` : "Branch"}
                    </td>
                    <td className="p-3 font-mono">{ponr.targetNodeLabel}</td>
                    <td className="p-3 font-mono text-rose-500 font-semibold">
                      {ponr.eliminatedEndingIds.join(", ")}
                    </td>
                    <td className="p-3">
                      {ponr.isEndingLockIn
                        ? (
                          <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
                            Final Lock-in (1 Ending)
                          </span>
                        )
                        : (
                          <span className="text-[10px] px-2 py-0.5 rounded font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800">
                            Locks out {ponr.eliminatedEndingIds.length}{" "}
                            ending(s)
                          </span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
