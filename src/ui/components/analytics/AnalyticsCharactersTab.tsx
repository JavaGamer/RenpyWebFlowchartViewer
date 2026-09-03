import type { ProjectNarrativeReport } from "../../../domain/index.ts";

export interface AnalyticsCharactersTabProps {
  report: ProjectNarrativeReport;
}

export function AnalyticsCharactersTab(
  { report }: AnalyticsCharactersTabProps,
) {
  return (
    <div className="space-y-6">
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Dialogue share and word count distribution across speaking characters:
      </div>

      {/* Character Dialogue Table */}
      <div className="border rounded-xl overflow-x-auto border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs border-collapse">
          <caption className="sr-only">
            Speaking character dialogue distribution
          </caption>
          <thead>
            <tr className="border-b bg-slate-100/70 dark:bg-slate-800/60 font-semibold text-slate-600 dark:text-slate-300">
              <th scope="col" className="p-3">Character / Speaker</th>
              <th scope="col" className="p-3">Line Count</th>
              <th scope="col" className="p-3">Word Count</th>
              <th scope="col" className="p-3">Line Share (%)</th>
              <th scope="col" className="p-3">Word Share (%)</th>
              <th scope="col" className="p-3">Visual Distribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {report.characterStats.map((char) => (
              <tr
                key={char.speaker}
                className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <td className="p-3 font-mono font-bold text-violet-600 dark:text-violet-400">
                  {char.speaker}
                </td>
                <td className="p-3 font-mono">
                  {char.lineCount.toLocaleString()}
                </td>
                <td className="p-3 font-mono text-slate-500">
                  ~{char.wordCount.toLocaleString()}
                </td>
                <td className="p-3 font-mono">
                  {char.percentageOfLines}%
                </td>
                <td className="p-3 font-mono font-semibold">
                  {char.percentageOfWords}%
                </td>
                <td className="p-3 w-48">
                  <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-violet-600 dark:bg-violet-400 rounded-full"
                      style={{
                        width: `${
                          Math.min(100, Math.max(2, char.percentageOfWords))
                        }%`,
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
