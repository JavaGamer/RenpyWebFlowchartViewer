import { useState } from "react";
import { AlertCircle, Play, Sliders, X } from "lucide-react";
import {
  BUILTIN_PARSER_VARIANT_PLUGINS,
  type CustomVariantDefinition,
  type ScreenActionRule,
  type SerializableBranchStatementRule,
  type SerializableChoiceDirectiveRule,
  type SerializableEndingClassificationRule,
  type SerializableVariableMutationRule,
  validateSafeRegexPattern,
} from "../../../config/parserRules.ts";
import { ParserRuleEditor } from "../ParserRuleEditor.tsx";
import { cn } from "../../utils/cn.ts";
import { LiveRuleSandbox } from "./LiveRuleSandbox.tsx";
import {
  BranchRulesSection,
  ChoiceDirectivesSection,
  EndingRulesSection,
  VariableMutationsSection,
} from "./RuleCategorySections.tsx";

export interface CustomVariantFormContentProps {
  initialDefinition?: CustomVariantDefinition | null;
  onClose: () => void;
  onSave: (def: CustomVariantDefinition) => void;
  isDark?: boolean;
}

export function CustomVariantFormContent({
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
      const b = branchStatements[i]!;
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
      const c = choiceDirectives[i]!;
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
      const m = variableMutations[i]!;
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
      const r = endingRules[i]!;
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

            {/* Custom Branch Statements */}
            <BranchRulesSection
              branchStatements={branchStatements}
              onAdd={handleAddBranchStatement}
              onInsertTemplate={handleInsertBranchTemplate}
              onUpdate={handleUpdateBranchStatement}
              onRemove={handleRemoveBranchStatement}
              isDark={isDark}
            />

            {/* Timed & Custom Choice Directives */}
            <ChoiceDirectivesSection
              choiceDirectives={choiceDirectives}
              onAdd={handleAddChoiceDirective}
              onUpdate={handleUpdateChoiceDirective}
              onRemove={handleRemoveChoiceDirective}
              isDark={isDark}
            />

            {/* Custom Variable Mutation Macros */}
            <VariableMutationsSection
              variableMutations={variableMutations}
              onAdd={handleAddVariableMutation}
              onUpdate={handleUpdateVariableMutation}
              onRemove={handleRemoveVariableMutation}
              isDark={isDark}
            />

            {/* Ending Classification Rules */}
            <EndingRulesSection
              endingRules={endingRules}
              onAdd={handleAddEndingRule}
              onUpdate={handleUpdateEndingRule}
              onRemove={handleRemoveEndingRule}
              isDark={isDark}
            />

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
