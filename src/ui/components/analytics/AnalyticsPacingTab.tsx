import { Flame } from "lucide-react";
import type { ProjectNarrativeReport } from "../../../domain/index.ts";

export interface AnalyticsPacingTabProps {
  report: ProjectNarrativeReport;
}

export function AnalyticsPacingTab({ report }: AnalyticsPacingTabProps) {
  const chapterEntries = Object.values(report.chapterPacing);
  const hasMonologues = chapterEntries.some((c) =>
    c.monologueSections.length > 0
  );

  return (
    <div className="space-y-6">
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Dialogue-to-choice ratios and linear monologue section detection per
        chapter:
      </div>

      {/* Chapter Pacing Table */}
      <div className="border rounded-xl overflow-x-auto border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs border-collapse">
          <caption className="sr-only">
            Chapter pacing and dialogue-to-choice ratios
          </caption>
          <thead>
            <tr className="border-b bg-slate-100/70 dark:bg-slate-800/60 font-semibold text-slate-600 dark:text-slate-300">
              <th scope="col" className="p-3">Chapter</th>
              <th scope="col" className="p-3">Dialogue Lines</th>
              <th scope="col" className="p-3">Word Count</th>
              <th scope="col" className="p-3">Choice Menus</th>
              <th scope="col" className="p-3">Lines per Choice</th>
              <th scope="col" className="p-3">Est. Reading Time</th>
              <th scope="col" className="p-3">Monologue Warning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {chapterEntries.map((pacing) => (
              <tr
                key={pacing.chapter}
                className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <td className="p-3 font-mono font-bold">{pacing.chapter}</td>
                <td className="p-3 font-mono">
                  {pacing.totalDialogueLines.toLocaleString()}
                </td>
                <td className="p-3 font-mono text-slate-500">
                  ~{pacing.totalWordCount.toLocaleString()}
                </td>
                <td className="p-3 font-mono">{pacing.totalMenus}</td>
                <td className="p-3 font-mono font-bold text-violet-600 dark:text-violet-400">
                  {pacing.dialogueToChoiceRatio} lines/menu
                </td>
                <td className="p-3 font-mono text-slate-500">
                  {pacing.formattedReadingTime}
                </td>
                <td className="p-3">
                  {pacing.monologueSections.length > 0
                    ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200">
                        ⚠️ {pacing.monologueSections.length} Long Monologue(s)
                      </span>
                    )
                    : (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                        ✓ Balanced
                      </span>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detected Linear Monologue Sections */}
      {hasMonologues && (
        <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1.5">
            <Flame size={15} className="text-amber-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Linear Monologue Bottlenecks (Sections with &ge; 30 lines or &ge;
              500 words without choices)
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {chapterEntries
              .flatMap((c) => c.monologueSections)
              .map((mono) => (
                <div
                  key={mono.id}
                  className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-amber-800 dark:text-amber-200">
                        {mono.chapter}
                      </span>
                      <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                        {mono.formattedReadingTime} (~
                        {mono.wordCount.toLocaleString()} words)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 font-mono">
                      From{" "}
                      <span className="font-bold">{mono.startNodeLabel}</span> →
                      {" "}
                      <span className="font-bold">{mono.endNodeLabel}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {mono.nodeCount} unbroken label nodes ·{" "}
                      {mono.dialogueLineCount} dialogue lines
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
