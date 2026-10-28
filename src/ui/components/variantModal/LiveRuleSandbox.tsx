import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  type SerializableBranchStatementRule,
  type SerializableChoiceDirectiveRule,
  type SerializableEndingClassificationRule,
  type SerializableVariableMutationRule,
  validateSafeRegexPattern,
} from "../../../config/parserRules.ts";
import { cn } from "../../utils/cn.ts";

export const DEFAULT_SANDBOX_SCRIPT =
  `# Sample Ren'Py script to test your custom variant rules
label story_start:
    "Welcome to the adventure."
    $ karma = 10
    gain_karma 5
    warp chapter_2

label chapter_2:
    timedchoice (5, "bad_timeout"):
        "Explore forest":
            jump forest_path
        "Stay in town":
            jump ending_neutral

label bad_timeout:
    $ end_game()

label ending_good:
    "You unlocked the good ending!"
    return

label ending_neutral:
    "A quiet resolution."
    return

label util_helper_routine:
    $ debug_counter += 1
    return
`;

export interface LiveRuleSandboxProps {
  branchStatements: SerializableBranchStatementRule[];
  choiceDirectives: SerializableChoiceDirectiveRule[];
  variableMutations: SerializableVariableMutationRule[];
  endingRules: SerializableEndingClassificationRule[];
  utilityLabelPatterns: string[];
  terminalPatterns: string[];
  isDark?: boolean;
}

export function LiveRuleSandbox({
  branchStatements,
  choiceDirectives,
  variableMutations,
  endingRules,
  utilityLabelPatterns,
  terminalPatterns,
  isDark = false,
}: LiveRuleSandboxProps) {
  const [script, setScript] = useState(DEFAULT_SANDBOX_SCRIPT);

  const lines = useMemo(() => script.split("\n"), [script]);

  const compiledRegexes = useMemo(() => {
    const compileSafe = (pat: string) => {
      try {
        return validateSafeRegexPattern(pat);
      } catch {
        return null;
      }
    };

    return {
      branches: branchStatements.map((b) => ({
        ...b,
        regex: b.pattern.trim() ? compileSafe(b.pattern.trim()) : null,
      })),
      choiceDirectives: choiceDirectives.map((c) => ({
        ...c,
        regex: c.pattern.trim() ? compileSafe(c.pattern.trim()) : null,
      })),
      mutations: variableMutations.map((m) => ({
        ...m,
        regex: m.pattern.trim() ? compileSafe(m.pattern.trim()) : null,
      })),
      endings: endingRules.map((e) => ({
        ...e,
        regex: e.pattern.trim() ? compileSafe(e.pattern.trim()) : null,
      })),
      utilityLabels: utilityLabelPatterns
        .map((p) => (p.trim() ? compileSafe(p.trim()) : null))
        .filter((r): r is RegExp => r !== null),
      terminals: terminalPatterns
        .map((p) => (p.trim() ? compileSafe(p.trim()) : null))
        .filter((r): r is RegExp => r !== null),
    };
  }, [
    branchStatements,
    choiceDirectives,
    variableMutations,
    endingRules,
    utilityLabelPatterns,
    terminalPatterns,
  ]);

  const evaluation = useMemo(() => {
    let totalBranches = 0;
    let totalDirectives = 0;
    let totalMutations = 0;
    let totalEndings = 0;
    let totalUtility = 0;
    let totalTerminals = 0;

    const lineResults = lines.map((rawLine, idx) => {
      const lineNum = idx + 1;
      const trimmed = rawLine.trim();
      const findings: Array<{ badge: string; color: string; detail: string }> =
        [];

      if (!trimmed || trimmed.startsWith("#")) {
        return { lineNum, rawLine, findings };
      }

      // Check terminals
      for (const tRegex of compiledRegexes.terminals) {
        if (tRegex.test(rawLine)) {
          totalTerminals++;
          findings.push({
            badge: "Terminal",
            color:
              "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800",
            detail: "Exits storyline without fallthrough",
          });
          break;
        }
      }

      // Check label definitions
      const labelMatch = rawLine.match(/^\s*label\s+([A-Za-z0-9_]+)\s*:/);
      if (labelMatch) {
        const labelName = labelMatch[1];
        let isUtil = false;
        for (const uRegex of compiledRegexes.utilityLabels) {
          if (uRegex.test(labelName)) {
            isUtil = true;
            totalUtility++;
            findings.push({
              badge: "Utility Label",
              color:
                "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600",
              detail: `Excluded from terminal story endings (${labelName})`,
            });
            break;
          }
        }

        if (!isUtil) {
          for (const ending of compiledRegexes.endings) {
            if (
              ending.regex &&
              (ending.regex.test(labelName) || ending.regex.test(rawLine))
            ) {
              totalEndings++;
              findings.push({
                badge: `Ending: ${ending.endingType.toUpperCase()}`,
                color:
                  ending.endingType === "good" || ending.endingType === "true"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                    : ending.endingType === "bad"
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
                detail: `Classified ending via '${labelName}'`,
              });
              break;
            }
          }
        }
      }

      // Check custom branch statements
      for (const branch of compiledRegexes.branches) {
        if (!branch.regex) continue;
        const match = rawLine.match(branch.regex);
        if (match) {
          const target = match[branch.targetGroup ?? 1] ?? "(unresolved)";
          totalBranches++;
          findings.push({
            badge: `Branch: ${branch.branchKind}`,
            color:
              "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800",
            detail: `-> ${target}`,
          });
        }
      }

      // Check choice directives
      for (const directive of compiledRegexes.choiceDirectives) {
        if (!directive.regex) continue;
        const dMatch = directive.regex.exec(rawLine);
        if (dMatch) {
          totalDirectives++;
          const target = dMatch[directive.targetGroup]?.trim() || "target";
          const dur = directive.durationGroup && dMatch[directive.durationGroup]
            ? ` (${dMatch[directive.durationGroup]}s)`
            : "";
          findings.push({
            badge: `Choice Directive`,
            color:
              "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800",
            detail: `-> ${target}${dur}${
              directive.isTimeout ? " [timeout]" : ""
            }`,
          });
        }
      }

      // Check variable mutations
      for (const mut of compiledRegexes.mutations) {
        if (!mut.regex) continue;
        const mMatch = mut.regex.exec(rawLine);
        if (mMatch) {
          totalMutations++;
          const varName = mut.variableName ||
            (mut.variableGroup ? mMatch[mut.variableGroup]?.trim() : "var");
          const val = mut.valueGroup && mMatch[mut.valueGroup]
            ? ` ${mMatch[mut.valueGroup]}`
            : (mut.constantValue !== undefined ? ` ${mut.constantValue}` : "");
          findings.push({
            badge: `Mutation: ${varName}`,
            color:
              "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
            detail: `${mut.operator ?? "="}${val}`,
          });
        }
      }

      return { lineNum, rawLine, findings };
    });

    return {
      lineResults,
      stats: {
        totalBranches,
        totalDirectives,
        totalMutations,
        totalEndings,
        totalUtility,
        totalTerminals,
      },
    };
  }, [lines, compiledRegexes]);

  return (
    <div className="flex flex-col gap-3">
      {/* Sandbox Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold block text-xs">
            Interactive Rule Evaluation Sandbox
          </span>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Paste Ren&apos;Py code snippets below to test your custom branch,
            mutation, and ending rules in real time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setScript(DEFAULT_SANDBOX_SCRIPT)}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
            isDark
              ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
          )}
        >
          <Sparkles size={11} />
          <span>Reset Sample</span>
        </button>
      </div>

      {/* Metrics Bar */}
      <div className="flex flex-wrap gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700 text-[11px]">
        <div className="flex items-center gap-1 font-medium">
          <span className="opacity-75">Branches:</span>
          <span className="font-bold text-purple-600 dark:text-purple-400">
            {evaluation.stats.totalBranches}
          </span>
        </div>
        <div className="flex items-center gap-1 font-medium">
          <span className="opacity-75">Directives:</span>
          <span className="font-bold text-amber-600 dark:text-amber-400">
            {evaluation.stats.totalDirectives}
          </span>
        </div>
        <div className="flex items-center gap-1 font-medium">
          <span className="opacity-75">Mutations:</span>
          <span className="font-bold text-cyan-600 dark:text-cyan-400">
            {evaluation.stats.totalMutations}
          </span>
        </div>
        <div className="flex items-center gap-1 font-medium">
          <span className="opacity-75">Endings:</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">
            {evaluation.stats.totalEndings}
          </span>
        </div>
        <div className="flex items-center gap-1 font-medium">
          <span className="opacity-75">Utility:</span>
          <span className="font-bold text-slate-600 dark:text-slate-300">
            {evaluation.stats.totalUtility}
          </span>
        </div>
        <div className="flex items-center gap-1 font-medium">
          <span className="opacity-75">Terminals:</span>
          <span className="font-bold text-rose-600 dark:text-rose-400">
            {evaluation.stats.totalTerminals}
          </span>
        </div>
      </div>

      {/* Editor & Live Inspector Stack */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-h-[300px]">
        {/* Code Input */}
        <div className="flex flex-col">
          <label
            htmlFor="sandbox-script-input"
            className="font-semibold text-xs mb-1"
          >
            Test Script (.rpy)
          </label>
          <textarea
            id="sandbox-script-input"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={14}
            className={cn(
              "w-full flex-1 rounded-md border p-2.5 font-mono text-xs leading-relaxed resize-none",
              isDark
                ? "bg-slate-950 border-slate-700 text-slate-200"
                : "bg-white border-gray-300 text-gray-900",
            )}
            placeholder="Paste Ren'Py script lines..."
          />
        </div>

        {/* Live Evaluation Output */}
        <div className="flex flex-col">
          <span className="font-semibold text-xs mb-1">
            Live Matches & Parsing Tokens
          </span>
          <div
            className={cn(
              "flex-1 overflow-y-auto max-h-[350px] p-2 rounded-md border space-y-1.5 font-mono text-xs",
              isDark
                ? "bg-slate-950 border-slate-700 text-slate-200"
                : "bg-gray-50 border-gray-200 text-gray-800",
            )}
          >
            {evaluation.lineResults.map((res) => {
              const hasFindings = res.findings.length > 0;
              return (
                <div
                  key={`sandbox-line-${res.lineNum}`}
                  className={cn(
                    "p-1.5 rounded transition-colors text-[11px]",
                    hasFindings
                      ? isDark
                        ? "bg-slate-900 border border-slate-800"
                        : "bg-white border border-gray-200 shadow-xs"
                      : "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-gray-400 dark:text-slate-500 shrink-0 select-none w-5 text-right font-mono text-[10px]">
                      {res.lineNum}
                    </span>
                    <span className="flex-1 font-mono truncate">
                      {res.rawLine}
                    </span>
                  </div>
                  {hasFindings && (
                    <div className="flex flex-wrap gap-1 mt-1 pl-7">
                      {res.findings.map((f, fIdx) => (
                        <span
                          key={`finding-${res.lineNum}-${fIdx}`}
                          className={cn(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium border",
                            f.color,
                          )}
                        >
                          <strong>{f.badge}:</strong> {f.detail}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
