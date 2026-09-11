import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Play,
  Plus,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  BUILTIN_PARSER_VARIANT_PLUGINS,
  type CustomVariantDefinition,
  type EndingType,
  type MutationOperator,
  type ScreenActionRule,
  type SerializableBranchStatementRule,
  type SerializableChoiceDirectiveRule,
  type SerializableEndingClassificationRule,
  type SerializableVariableMutationRule,
  validateSafeRegexPattern,
} from "../../config/parserRules.ts";
import { ParserRuleEditor } from "./ParserRuleEditor.tsx";
import { cn } from "../utils/cn.ts";

export interface CustomVariantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (def: CustomVariantDefinition) => void;
  initialDefinition?: CustomVariantDefinition | null;
  isDark?: boolean;
}

const RENPY_CORE_KEYWORDS = [
  "jump",
  "call",
  "return",
  "menu",
  "label",
  "scene",
  "show",
  "hide",
  "play",
  "queue",
  "stop",
  "pause",
  "with",
  "python",
  "init",
  "define",
  "default",
] as const;

const KEYWORD_COLLISION_REGEXES = RENPY_CORE_KEYWORDS.map((kw) => ({
  keyword: kw,
  regex: new RegExp(`^(?:\\\\s\\*\\\\b|\\^\\\\s\\*|\\^)${kw}\\b`, "i"),
}));

function checkKeywordCollision(pattern: string): string | null {
  const trimmed = pattern.trim();
  for (const { keyword, regex } of KEYWORD_COLLISION_REGEXES) {
    if (regex.test(trimmed)) {
      return keyword;
    }
  }
  return null;
}

const DEFAULT_SANDBOX_SCRIPT =
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

interface LiveRuleSandboxProps {
  branchStatements: SerializableBranchStatementRule[];
  choiceDirectives: SerializableChoiceDirectiveRule[];
  variableMutations: SerializableVariableMutationRule[];
  endingRules: SerializableEndingClassificationRule[];
  utilityLabelPatterns: string[];
  terminalPatterns: string[];
  isDark?: boolean;
}

function LiveRuleSandbox({
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

interface CustomVariantFormContentProps {
  initialDefinition?: CustomVariantDefinition | null;
  onClose: () => void;
  onSave: (def: CustomVariantDefinition) => void;
  isDark?: boolean;
}

function CustomVariantFormContent({
  initialDefinition,
  onClose,
  onSave,
  isDark = false,
}: CustomVariantFormContentProps) {
  const [id, setId] = useState(initialDefinition?.id ?? "");
  const [label, setLabel] = useState(initialDefinition?.label ?? "");
  const [description, setDescription] = useState(
    initialDefinition?.description ?? "",
  );
  const [baseVariant, setBaseVariant] = useState(
    initialDefinition?.baseVariant ?? "renpy",
  );
  const [stagingKeywordsStr, setStagingKeywordsStr] = useState(
    (initialDefinition?.stagingKeywords ?? []).join(", "),
  );
  const [terminalPatternsStr, setTerminalPatternsStr] = useState(
    (initialDefinition?.terminalPatterns ?? []).join("\n"),
  );
  const [detectionPatternsStr, setDetectionPatternsStr] = useState(
    (initialDefinition?.detectionPatterns ?? []).join("\n"),
  );
  const [activeTab, setActiveTab] = useState<"rules" | "sandbox">("rules");
  const [branchStatements, setBranchStatements] = useState<
    SerializableBranchStatementRule[]
  >(initialDefinition?.branchStatements ?? []);
  const [choiceDirectives, setChoiceDirectives] = useState<
    SerializableChoiceDirectiveRule[]
  >(initialDefinition?.choiceDirectives ?? []);
  const [variableMutations, setVariableMutations] = useState<
    SerializableVariableMutationRule[]
  >(initialDefinition?.variableMutations ?? []);
  const [endingRules, setEndingRules] = useState<
    SerializableEndingClassificationRule[]
  >(initialDefinition?.endingRules ?? []);
  const [utilityLabelPatternsStr, setUtilityLabelPatternsStr] = useState(
    (initialDefinition?.utilityLabelPatterns ?? []).join("\n"),
  );
  const [detectionFilePatternsStr, setDetectionFilePatternsStr] = useState(
    (initialDefinition?.detectionFilePatterns ?? []).join("\n"),
  );
  const [screenActionRules, setScreenActionRules] = useState<
    ScreenActionRule[]
  >(initialDefinition?.screenActionRules ?? []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAddBranchStatement = () => {
    setBranchStatements((prev) => [
      ...prev,
      { pattern: "", branchKind: "jump", targetGroup: 1 },
    ]);
  };

  const handleInsertBranchTemplate = (
    template: "keyword" | "python_jump" | "python_call" | "dynamic",
  ) => {
    const templates: Record<
      string,
      { pattern: string; branchKind: "jump" | "call"; targetGroup: number }
    > = {
      keyword: {
        pattern: "^\\s*(?:warp|goto)\\s+([A-Za-z0-9_]+)",
        branchKind: "jump",
        targetGroup: 1,
      },
      python_jump: {
        pattern:
          "^\\s*\\$\\s*renpy\\.jump\\(\\s*[\"']([A-Za-z0-9_]+)[\"']\\s*\\)",
        branchKind: "jump",
        targetGroup: 1,
      },
      python_call: {
        pattern:
          "^\\s*\\$\\s*renpy\\.call_in_new_context\\(\\s*[\"']([A-Za-z0-9_]+)[\"']\\s*\\)",
        branchKind: "call",
        targetGroup: 1,
      },
      dynamic: {
        pattern: "^\\s*jump\\s+expression\\s+[\"']?([A-Za-z0-9_]+)",
        branchKind: "jump",
        targetGroup: 1,
      },
    };
    const t = templates[template];
    if (t) {
      setBranchStatements((prev) => [...prev, { ...t }]);
    }
  };

  const handleUpdateBranchStatement = (
    index: number,
    patch: Partial<SerializableBranchStatementRule>,
  ) => {
    setBranchStatements((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b))
    );
  };

  const handleRemoveBranchStatement = (index: number) => {
    setBranchStatements((prev) => prev.filter((_, i) => i !== index));
  };

  // Choice Directives Handlers
  const handleAddChoiceDirective = () => {
    setChoiceDirectives((prev) => [
      ...prev,
      { pattern: "", targetGroup: 1, durationGroup: 2, isTimeout: true },
    ]);
  };

  const handleUpdateChoiceDirective = (
    index: number,
    patch: Partial<SerializableChoiceDirectiveRule>,
  ) => {
    setChoiceDirectives((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );
  };

  const handleRemoveChoiceDirective = (index: number) => {
    setChoiceDirectives((prev) => prev.filter((_, i) => i !== index));
  };

  // Variable Mutations Handlers
  const handleAddVariableMutation = () => {
    setVariableMutations((prev) => [
      ...prev,
      {
        pattern: "",
        variableName: "",
        operator: "=",
        valueGroup: 1,
      },
    ]);
  };

  const handleUpdateVariableMutation = (
    index: number,
    patch: Partial<SerializableVariableMutationRule>,
  ) => {
    setVariableMutations((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m))
    );
  };

  const handleRemoveVariableMutation = (index: number) => {
    setVariableMutations((prev) => prev.filter((_, i) => i !== index));
  };

  // Ending Rules Handlers
  const handleAddEndingRule = () => {
    setEndingRules((prev) => [
      ...prev,
      {
        pattern: "",
        endingType: "normal",
      },
    ]);
  };

  const handleUpdateEndingRule = (
    index: number,
    patch: Partial<SerializableEndingClassificationRule>,
  ) => {
    setEndingRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  };

  const handleRemoveEndingRule = (index: number) => {
    setEndingRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddScreenActionRule = () => {
    setScreenActionRules((prev) => [
      ...prev,
      { actionName: "", actionKind: "jump" },
    ]);
  };

  const handleUpdateScreenActionRule = (
    index: number,
    patch: Partial<ScreenActionRule>,
  ) => {
    setScreenActionRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  };

  const handleRemoveScreenActionRule = (index: number) => {
    setScreenActionRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    setErrorMsg(null);
    const trimmedId = id.trim().toLowerCase();
    const trimmedLabel = label.trim();

    if (!trimmedId) {
      setErrorMsg("Variant ID is required.");
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(trimmedId)) {
      setErrorMsg(
        "Variant ID can only contain lowercase letters, numbers, hyphens, and underscores.",
      );
      return;
    }
    if (!trimmedLabel) {
      setErrorMsg("Variant display label is required.");
      return;
    }

    // Split keywords
    const stagingKeywords = stagingKeywordsStr
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter(Boolean);

    // Validate terminal patterns
    const terminalPatterns = terminalPatternsStr
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    for (const pat of terminalPatterns) {
      try {
        validateSafeRegexPattern(pat);
      } catch (err) {
        setErrorMsg(
          `Terminal Pattern Error: ${(err as Error).message}`,
        );
        return;
      }
    }

    // Validate detection patterns
    const detectionPatterns = detectionPatternsStr
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    for (const pat of detectionPatterns) {
      try {
        validateSafeRegexPattern(pat);
      } catch (err) {
        setErrorMsg(
          `Detection Signature Error: ${(err as Error).message}`,
        );
        return;
      }
    }

    // Validate detection file patterns
    const detectionFilePatterns = detectionFilePatternsStr
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    for (const pat of detectionFilePatterns) {
      try {
        validateSafeRegexPattern(pat);
      } catch (err) {
        setErrorMsg(
          `File Heuristic Regex Error: ${(err as Error).message}`,
        );
        return;
      }
    }

    // Validate utility label patterns
    const utilityLabelPatterns = utilityLabelPatternsStr
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    for (const pat of utilityLabelPatterns) {
      try {
        validateSafeRegexPattern(pat);
      } catch (err) {
        setErrorMsg(
          `Utility Label Pattern Error: ${(err as Error).message}`,
        );
        return;
      }
    }

    // Validate branch statements
    const validatedBranchStatements: SerializableBranchStatementRule[] = [];
    for (let i = 0; i < branchStatements.length; i++) {
      const b = branchStatements[i];
      const pat = b.pattern.trim();
      if (!pat) continue;
      try {
        const compiled = validateSafeRegexPattern(pat);
        const dummyGroupMatch = "".match(compiled);
        if (dummyGroupMatch === null && b.targetGroup && b.targetGroup > 9) {
          setErrorMsg(
            `Branch rule ${i + 1}: target group index out of bounds.`,
          );
          return;
        }
        validatedBranchStatements.push({
          pattern: pat,
          branchKind: b.branchKind,
          targetGroup: b.targetGroup ?? 1,
        });
      } catch (err) {
        setErrorMsg(
          `Branch Rule ${i + 1} ("${pat}"): ${(err as Error).message}`,
        );
        return;
      }
    }

    // Validate choice directives
    const validatedChoiceDirectives: SerializableChoiceDirectiveRule[] = [];
    for (let i = 0; i < choiceDirectives.length; i++) {
      const c = choiceDirectives[i];
      const pat = c.pattern.trim();
      if (!pat) continue;
      try {
        validateSafeRegexPattern(pat);
        validatedChoiceDirectives.push({
          pattern: pat,
          targetGroup: Number(c.targetGroup) || 1,
          captionGroup: c.captionGroup ? Number(c.captionGroup) : undefined,
          durationGroup: c.durationGroup ? Number(c.durationGroup) : undefined,
          isTimeout: c.isTimeout ?? true,
        });
      } catch (err) {
        setErrorMsg(
          `Choice Directive ${i + 1}: ${(err as Error).message}`,
        );
        return;
      }
    }

    // Validate variable mutations
    const validatedVariableMutations: SerializableVariableMutationRule[] = [];
    for (let i = 0; i < variableMutations.length; i++) {
      const m = variableMutations[i];
      const pat = m.pattern.trim();
      if (!pat) continue;
      try {
        validateSafeRegexPattern(pat);
        validatedVariableMutations.push({
          pattern: pat,
          variableName: m.variableName?.trim() || undefined,
          variableGroup: m.variableGroup ? Number(m.variableGroup) : undefined,
          operator: m.operator ?? "=",
          valueGroup: m.valueGroup ? Number(m.valueGroup) : undefined,
          constantValue: m.constantValue,
        });
      } catch (err) {
        setErrorMsg(
          `Variable Mutation ${i + 1}: ${(err as Error).message}`,
        );
        return;
      }
    }

    // Validate ending rules
    const validatedEndingRules: SerializableEndingClassificationRule[] = [];
    for (let i = 0; i < endingRules.length; i++) {
      const r = endingRules[i];
      const pat = r.pattern.trim();
      if (!pat) continue;
      try {
        validateSafeRegexPattern(pat);
        validatedEndingRules.push({
          pattern: pat,
          endingType: r.endingType,
        });
      } catch (err) {
        setErrorMsg(
          `Ending Rule ${i + 1}: ${(err as Error).message}`,
        );
        return;
      }
    }

    const validScreenRules = screenActionRules
      .filter((r) => r.actionName.trim().length > 0)
      .map((r) => ({
        actionName: r.actionName.trim(),
        actionKind: r.actionKind,
      }));

    const definition: CustomVariantDefinition = {
      id: trimmedId,
      label: trimmedLabel,
      description: description.trim() || undefined,
      baseVariant,
      stagingKeywords: stagingKeywords.length > 0 ? stagingKeywords : undefined,
      terminalPatterns: terminalPatterns.length > 0
        ? terminalPatterns
        : undefined,
      detectionPatterns: detectionPatterns.length > 0
        ? detectionPatterns
        : undefined,
      detectionFilePatterns: detectionFilePatterns.length > 0
        ? detectionFilePatterns
        : undefined,
      branchStatements: validatedBranchStatements.length > 0
        ? validatedBranchStatements
        : undefined,
      choiceDirectives: validatedChoiceDirectives.length > 0
        ? validatedChoiceDirectives
        : undefined,
      variableMutations: validatedVariableMutations.length > 0
        ? validatedVariableMutations
        : undefined,
      endingRules: validatedEndingRules.length > 0
        ? validatedEndingRules
        : undefined,
      utilityLabelPatterns: utilityLabelPatterns.length > 0
        ? utilityLabelPatterns
        : undefined,
      screenActionRules: validScreenRules.length > 0
        ? validScreenRules
        : undefined,
    };

    try {
      onSave(definition);
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <div
      className={cn(
        "w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border shadow-xl overflow-hidden transition-colors duration-200",
        isDark
          ? "bg-slate-900 border-slate-700 text-slate-100"
          : "bg-white border-gray-200 text-gray-900",
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-gray-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <h2
            id="custom-variant-modal-title"
            className="font-semibold text-sm sm:text-base"
          >
            {initialDefinition
              ? "Edit Custom Variant"
              : "Create Custom Variant"}
          </h2>

          {/* Tab Switcher */}
          <div className="flex items-center p-0.5 rounded-lg border bg-gray-100 dark:bg-slate-800 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setActiveTab("rules")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                activeTab === "rules"
                  ? isDark
                    ? "bg-slate-700 text-white shadow-sm"
                    : "bg-white text-gray-900 shadow-sm"
                  : isDark
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <Sliders size={13} />
              <span>Settings & Rules</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("sandbox")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                activeTab === "sandbox"
                  ? isDark
                    ? "bg-slate-700 text-white shadow-sm"
                    : "bg-white text-gray-900 shadow-sm"
                  : isDark
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-gray-600 hover:text-gray-900",
              )}
            >
              <Play size={13} />
              <span>Live Rule Sandbox</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 focus:outline-none"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      {/* Main Body */}
      {activeTab === "sandbox"
        ? (
          <div className="flex-1 overflow-y-auto p-5 text-xs">
            <LiveRuleSandbox
              branchStatements={branchStatements}
              choiceDirectives={choiceDirectives}
              variableMutations={variableMutations}
              endingRules={endingRules}
              utilityLabelPatterns={utilityLabelPatternsStr
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)}
              terminalPatterns={terminalPatternsStr
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)}
              isDark={isDark}
            />
          </div>
        )
        : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 rounded-lg flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="custom-variant-id"
                  className="block font-medium mb-1"
                >
                  Variant ID (Slug) *
                </label>
                <input
                  id="custom-variant-id"
                  disabled={Boolean(initialDefinition)}
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="e.g. my-novel-variant"
                  className={cn(
                    "w-full rounded-md border px-2.5 py-1.5 font-mono text-xs",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-100"
                      : "bg-white border-gray-300 text-gray-900",
                    Boolean(initialDefinition) &&
                      "opacity-60 cursor-not-allowed",
                  )}
                />
              </div>
              <div>
                <label
                  htmlFor="custom-variant-label"
                  className="block font-medium mb-1"
                >
                  Display Label *
                </label>
                <input
                  id="custom-variant-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. My Custom VN Engine"
                  className={cn(
                    "w-full rounded-md border px-2.5 py-1.5 text-xs",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-100"
                      : "bg-white border-gray-300 text-gray-900",
                  )}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="custom-variant-desc"
                className="block font-medium mb-1"
              >
                Description
              </label>
              <input
                id="custom-variant-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Ren'Py with custom warp/goto statements and minigame macros."
                className={cn(
                  "w-full rounded-md border px-2.5 py-1.5 text-xs",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
            </div>

            <div>
              <label
                htmlFor="custom-variant-base"
                className="block font-medium mb-1"
              >
                Base Preset
              </label>
              <select
                id="custom-variant-base"
                value={baseVariant}
                onChange={(e) => setBaseVariant(e.target.value)}
                className={cn(
                  "w-full rounded-md border px-2.5 py-1.5 text-xs",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              >
                {BUILTIN_PARSER_VARIANT_PLUGINS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} ({b.id})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                Inherits all rules and staging directives from this base preset.
              </p>
            </div>

            <div>
              <label
                htmlFor="custom-variant-staging"
                className="block font-medium mb-1"
              >
                Staging Directives (Keywords, comma-separated)
              </label>
              <input
                id="custom-variant-staging"
                value={stagingKeywordsStr}
                onChange={(e) => setStagingKeywordsStr(e.target.value)}
                placeholder="camera, matrixcolor, glitch, flash"
                className={cn(
                  "w-full rounded-md border px-2.5 py-1.5 text-xs font-mono",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
              <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                One-word staging/presentation statements that should not
                terminate or branch dialogue blocks.
              </p>
            </div>

            {/* Custom Branch Statements & Pattern Builder */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div>
                  <span className="font-semibold block">
                    Custom Branch Statements (CDS / Macros)
                  </span>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">
                    Regular expressions that match custom branch commands (e.g.
                    &apos;warp&apos;, &apos;goto&apos;) and capture target
                    labels.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddBranchStatement}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
                    isDark
                      ? "border-violet-800 bg-slate-800 text-violet-300 hover:bg-slate-700"
                      : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50",
                  )}
                >
                  <Plus size={11} />
                  <span>Add Rule</span>
                </button>
              </div>

              {/* Pattern Builder Templates */}
              <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border bg-gray-50/80 dark:bg-slate-800/40 dark:border-slate-800 mb-2">
                <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400">
                  Pattern Builder Templates:
                </span>
                <button
                  type="button"
                  onClick={() => handleInsertBranchTemplate("keyword")}
                  className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  + Warp / Goto Keyword
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertBranchTemplate("python_jump")}
                  className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  + renpy.jump()
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertBranchTemplate("python_call")}
                  className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  + Subroutine Call
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertBranchTemplate("dynamic")}
                  className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  + Dynamic Jump
                </button>
              </div>

              <div className="space-y-2">
                {branchStatements.length === 0 && (
                  <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
                    No custom branch statements defined.
                  </p>
                )}

                {branchStatements.map((b, idx) => {
                  const collision = checkKeywordCollision(b.pattern);
                  return (
                    <div
                      key={`branch-stmt-${idx}`}
                      className="flex flex-col gap-1.5 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          aria-label={`Branch pattern ${idx + 1}`}
                          value={b.pattern}
                          onChange={(e) =>
                            handleUpdateBranchStatement(idx, {
                              pattern: e.target.value,
                            })}
                          placeholder="Regex: ^\\s*warp\\s+([A-Za-z0-9_]+)"
                          className={cn(
                            "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                            isDark
                              ? "bg-slate-900 border-slate-700 text-slate-100"
                              : "bg-white border-gray-300 text-gray-900",
                          )}
                        />
                        <select
                          aria-label={`Branch kind ${idx + 1}`}
                          value={b.branchKind}
                          onChange={(e) =>
                            handleUpdateBranchStatement(idx, {
                              branchKind: e.target.value as "jump" | "call",
                            })}
                          className={cn(
                            "rounded border px-2 py-1 text-xs",
                            isDark
                              ? "bg-slate-900 border-slate-700 text-slate-100"
                              : "bg-white border-gray-300 text-gray-900",
                          )}
                        >
                          <option value="jump">jump</option>
                          <option value="call">call</option>
                        </select>
                        <label
                          htmlFor={`branch-target-group-${idx}`}
                          className="flex items-center gap-1 text-[11px]"
                        >
                          <span>Grp:</span>
                          <input
                            id={`branch-target-group-${idx}`}
                            aria-label={`Branch target group ${idx + 1}`}
                            type="number"
                            min={1}
                            max={9}
                            value={b.targetGroup ?? 1}
                            onChange={(e) =>
                              handleUpdateBranchStatement(idx, {
                                targetGroup: parseInt(e.target.value, 10) || 1,
                              })}
                            className={cn(
                              "w-12 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                              isDark
                                ? "bg-slate-900 border-slate-700 text-slate-100"
                                : "bg-white border-gray-300 text-gray-900",
                            )}
                          />
                        </label>
                        <button
                          type="button"
                          aria-label={`Remove branch statement ${idx + 1}`}
                          onClick={() => handleRemoveBranchStatement(idx)}
                          className="p-1 text-gray-400 hover:text-rose-500"
                          title="Remove branch statement"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {collision && (
                        <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                          <AlertTriangle size={12} className="shrink-0" />
                          <span>
                            Notice: Pattern matches core Ren&apos;Py keyword
                            &apos;{collision}&apos;. Ensure this does not
                            unintentionally shadow native syntax.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Timed & Custom Choice Directives */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div>
                  <span className="font-semibold block">
                    Timed & Custom Choice Directives
                  </span>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">
                    Special choice directives (e.g. timedchoice, timed_menu)
                    that present choices with optional timer expiration targets.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddChoiceDirective}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
                    isDark
                      ? "border-amber-800 bg-slate-800 text-amber-300 hover:bg-slate-700"
                      : "border-amber-300 bg-white text-amber-700 hover:bg-amber-50",
                  )}
                >
                  <Plus size={11} />
                  <span>Add Directive</span>
                </button>
              </div>

              <div className="space-y-2">
                {choiceDirectives.length === 0 && (
                  <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
                    No custom choice directives defined.
                  </p>
                )}
                {choiceDirectives.map((c, idx) => (
                  <div
                    key={`choice-dir-${idx}`}
                    className="flex flex-col gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        placeholder={"Trigger Regex (e.g. ^\\s*custom_timer\\s*\\(\\s*([0-9.]+)\\s*,\\s*['\"]([A-Za-z0-9_]+)['\"]\\s*\\))"}
                        value={c.pattern}
                        onChange={(e) =>
                          handleUpdateChoiceDirective(idx, {
                            pattern: e.target.value,
                          })}
                        className={cn(
                          "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                          isDark
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-900",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveChoiceDirective(idx)}
                        className="p-1 text-gray-400 hover:text-rose-500"
                        title="Remove directive"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-gray-500 dark:text-slate-400">
                        Target Group:
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={c.targetGroup ?? 1}
                        onChange={(e) =>
                          handleUpdateChoiceDirective(idx, {
                            targetGroup: parseInt(e.target.value, 10) || 1,
                          })}
                        className={cn(
                          "w-14 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                          isDark
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-900",
                        )}
                      />
                      <span className="text-gray-500 dark:text-slate-400">
                        Duration Group:
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={c.durationGroup ?? ""}
                        onChange={(e) =>
                          handleUpdateChoiceDirective(idx, {
                            durationGroup: e.target.value
                              ? parseInt(e.target.value, 10)
                              : undefined,
                          })}
                        placeholder="opt"
                        className={cn(
                          "w-14 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                          isDark
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-900",
                        )}
                      />
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={c.isTimeout ?? true}
                          onChange={(e) =>
                            handleUpdateChoiceDirective(idx, {
                              isTimeout: e.target.checked,
                            })}
                          className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span className="text-gray-600 dark:text-slate-300">
                          Timeout Edge
                        </span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Variable Mutation Macros */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div>
                  <span className="font-semibold block">
                    Custom Variable Mutation Macros
                  </span>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">
                    Statements that alter state/variables (e.g. gain_karma 5,
                    flag_toggle).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddVariableMutation}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
                    isDark
                      ? "border-cyan-800 bg-slate-800 text-cyan-300 hover:bg-slate-700"
                      : "border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50",
                  )}
                >
                  <Plus size={11} />
                  <span>Add Mutation</span>
                </button>
              </div>

              <div className="space-y-2">
                {variableMutations.length === 0 && (
                  <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
                    No custom variable mutations defined.
                  </p>
                )}

                {variableMutations.map((m, idx) => (
                  <div
                    key={`var-mut-${idx}`}
                    className="flex flex-col gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        placeholder="Regex (e.g. ^\s*gain_affinity\s+([A-Za-z0-9_]+)\s+(\d+))"
                        value={m.pattern}
                        onChange={(e) =>
                          handleUpdateVariableMutation(idx, {
                            pattern: e.target.value,
                          })}
                        className={cn(
                          "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                          isDark
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-900",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveVariableMutation(idx)}
                        className="p-1 text-gray-400 hover:text-rose-500"
                        title="Remove mutation"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-gray-500 dark:text-slate-400">
                        Target Var:
                      </span>
                      <input
                        placeholder="e.g. affinity"
                        value={m.variableName ?? ""}
                        onChange={(e) =>
                          handleUpdateVariableMutation(idx, {
                            variableName: e.target.value,
                          })}
                        className={cn(
                          "w-28 rounded border px-2 py-0.5 text-xs font-mono",
                          isDark
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-900",
                        )}
                      />
                      <span className="text-gray-500 dark:text-slate-400">
                        Operator:
                      </span>
                      <select
                        value={m.operator ?? "="}
                        onChange={(e) =>
                          handleUpdateVariableMutation(idx, {
                            operator: e.target.value as MutationOperator,
                          })}
                        className={cn(
                          "rounded border px-2 py-0.5 text-xs font-mono",
                          isDark
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-900",
                        )}
                      >
                        <option value="=">= (assign)</option>
                        <option value="+=">+= (add)</option>
                        <option value="-=">-= (subtract)</option>
                        <option value="*=">*= (multiply)</option>
                        <option value="/=">/= (divide)</option>
                        <option value="%=">%= (modulo)</option>
                      </select>
                      <span className="text-gray-500 dark:text-slate-400">
                        Value Group:
                      </span>
                      <input
                        type="number"
                        min={0}
                        placeholder="e.g. 2"
                        value={m.valueGroup ?? ""}
                        onChange={(e) =>
                          handleUpdateVariableMutation(idx, {
                            valueGroup: e.target.value
                              ? parseInt(e.target.value, 10)
                              : undefined,
                          })}
                        className={cn(
                          "w-14 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                          isDark
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-900",
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Ending Classification Rules */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div>
                  <span className="font-semibold block">
                    Ending Classification Rules
                  </span>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">
                    Explicitly tag endpoints as Good, Bad, True, Normal, Dead
                    End, or Custom endings based on label naming or patterns.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddEndingRule}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
                    isDark
                      ? "border-emerald-800 bg-slate-800 text-emerald-300 hover:bg-slate-700"
                      : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50",
                  )}
                >
                  <Plus size={11} />
                  <span>Add Ending Rule</span>
                </button>
              </div>

              <div className="space-y-2">
                {endingRules.length === 0 && (
                  <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
                    No ending classification rules defined.
                  </p>
                )}

                {endingRules.map((r, idx) => (
                  <div
                    key={`ending-rule-${idx}`}
                    className="flex flex-wrap items-center gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700 text-[11px]"
                  >
                    <select
                      value={r.endingType}
                      onChange={(e) =>
                        handleUpdateEndingRule(idx, {
                          endingType: e.target.value as EndingType,
                        })}
                      className={cn(
                        "rounded border px-2 py-1 text-xs font-semibold",
                        isDark
                          ? "bg-slate-900 border-slate-700 text-slate-100"
                          : "bg-white border-gray-300 text-gray-900",
                      )}
                    >
                      <option value="good">Good Ending</option>
                      <option value="bad">Bad Ending</option>
                      <option value="true">True Ending</option>
                      <option value="normal">Normal Ending</option>
                      <option value="dead_end">Dead End</option>
                      <option value="custom">Custom Ending</option>
                    </select>
                    <input
                      placeholder="Regex Pattern (e.g. _good$|_happy$)"
                      value={r.pattern}
                      onChange={(e) =>
                        handleUpdateEndingRule(idx, {
                          pattern: e.target.value,
                        })}
                      className={cn(
                        "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                        isDark
                          ? "bg-slate-900 border-slate-700 text-slate-100"
                          : "bg-white border-gray-300 text-gray-900",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEndingRule(idx)}
                      className="p-1 text-gray-400 hover:text-rose-500"
                      title="Remove ending rule"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Utility Label Patterns */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <label
                htmlFor="custom-variant-utility-labels"
                className="block font-semibold mb-0.5"
              >
                Utility Label Patterns (Regex, one per line)
              </label>
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-1.5">
                Labels matching these expressions (e.g. ^lb_util_,
                ^common_setup, _screen$) will be classified as utility/support
                functions and excluded from story endings.
              </p>
              <textarea
                id="custom-variant-utility-labels"
                rows={2}
                value={utilityLabelPatternsStr}
                onChange={(e) => setUtilityLabelPatternsStr(e.target.value)}
                placeholder="^lb_util_&#10;^minigame_helper"
                className={cn(
                  "w-full rounded-md border px-2.5 py-1.5 text-xs font-mono",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
            </div>

            {/* Terminal Statement Regexes */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <label
                htmlFor="custom-variant-terminal"
                className="block font-semibold mb-0.5"
              >
                Custom Terminal Patterns (Regex, one per line)
              </label>
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-1.5">
                Statements that permanently exit a scene/story path without
                fallthrough.
              </p>
              <textarea
                id="custom-variant-terminal"
                rows={2}
                value={terminalPatternsStr}
                onChange={(e) => setTerminalPatternsStr(e.target.value)}
                placeholder="^\\s*\\$\\s*end_game\\(\\)"
                className={cn(
                  "w-full rounded-md border px-2.5 py-1.5 text-xs font-mono",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
            </div>

            {/* Auto-Detection Regex Signatures & File Heuristics */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800 space-y-3">
              <div>
                <label
                  htmlFor="custom-variant-detection"
                  className="block font-semibold mb-0.5"
                >
                  Auto-Detection Signatures (Regex, one per line)
                </label>
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-1.5">
                  Script patterns used by auto-detect mode to identify this
                  project variant.
                </p>
                <textarea
                  id="custom-variant-detection"
                  rows={2}
                  value={detectionPatternsStr}
                  onChange={(e) => setDetectionPatternsStr(e.target.value)}
                  placeholder="^\\s*\\$\\s*custom_engine_version\\b"
                  className={cn(
                    "w-full rounded-md border px-2.5 py-1.5 text-xs font-mono",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-100"
                      : "bg-white border-gray-300 text-gray-900",
                  )}
                />
              </div>

              <div>
                <label
                  htmlFor="custom-variant-file-detection"
                  className="block font-semibold mb-0.5"
                >
                  Detection File Path Heuristics (Regex, one per line)
                </label>
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-1.5">
                  File paths that indicate this variant (e.g.
                  ^game/mas_.*\\.rpy$).
                </p>
                <textarea
                  id="custom-variant-file-detection"
                  rows={2}
                  value={detectionFilePatternsStr}
                  onChange={(e) => setDetectionFilePatternsStr(e.target.value)}
                  placeholder="^game/mas_.*\\.rpy$"
                  className={cn(
                    "w-full rounded-md border px-2.5 py-1.5 text-xs font-mono",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-100"
                      : "bg-white border-gray-300 text-gray-900",
                  )}
                />
              </div>
            </div>

            {/* Screen Action Rules */}
            <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
              <ParserRuleEditor
                rules={screenActionRules}
                onAddRule={handleAddScreenActionRule}
                onUpdateRule={handleUpdateScreenActionRule}
                onRemoveRule={handleRemoveScreenActionRule}
                title="Screen Action Rules"
                description="Actions triggered by screen buttons, hotspots, or timer bars."
                isDark={isDark}
              />
            </div>
          </div>
        )}

      {/* Footer Buttons */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
            isDark
              ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm transition-colors"
        >
          Save Variant
        </button>
      </div>
    </div>
  );
}

export function CustomVariantModal({
  isOpen,
  onClose,
  onSave,
  initialDefinition,
  isDark = false,
}: CustomVariantModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-variant-modal-title"
    >
      <CustomVariantFormContent
        key={initialDefinition?.id ?? "new"}
        initialDefinition={initialDefinition}
        onClose={onClose}
        onSave={onSave}
        isDark={isDark}
      />
    </div>
  );
}
