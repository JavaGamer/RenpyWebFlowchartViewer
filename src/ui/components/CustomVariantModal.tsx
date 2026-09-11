import { useState } from "react";
import { AlertCircle, Plus, Trash2, X } from "lucide-react";
import {
  BUILTIN_PARSER_VARIANT_PLUGINS,
  type CustomVariantDefinition,
  type ScreenActionRule,
  type SerializableBranchStatementRule,
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
  const [branchStatements, setBranchStatements] = useState<
    SerializableBranchStatementRule[]
  >(initialDefinition?.branchStatements ?? []);
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

    // Validate branch statements
    const validatedBranchStatements: SerializableBranchStatementRule[] = [];
    for (let i = 0; i < branchStatements.length; i++) {
      const b = branchStatements[i];
      const pat = b.pattern.trim();
      if (!pat) continue;
      try {
        const compiled = validateSafeRegexPattern(pat);
        // Test group matching capability
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
      branchStatements: validatedBranchStatements.length > 0
        ? validatedBranchStatements
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
        "w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border shadow-xl overflow-hidden transition-colors duration-200",
        isDark
          ? "bg-slate-900 border-slate-700 text-slate-100"
          : "bg-white border-gray-200 text-gray-900",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-800">
        <h2
          id="custom-variant-modal-title"
          className="font-semibold text-sm sm:text-base"
        >
          {initialDefinition ? "Edit Custom Variant" : "Create Custom Variant"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 focus:outline-none"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable Form Body */}
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
                Boolean(initialDefinition) && "opacity-60 cursor-not-allowed",
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
            One-word staging/presentation statements that should not terminate
            or branch dialogue blocks.
          </p>
        </div>

        {/* Custom Branch Statements */}
        <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <span className="font-semibold block">
                Custom Branch Statements (CDS / Macros)
              </span>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">
                Regular expressions that match custom branch commands (e.g.
                &apos;warp&apos;, &apos;goto&apos;) and capture target labels.
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
              <span>Add</span>
            </button>
          </div>

          <div className="space-y-2">
            {branchStatements.length === 0 && (
              <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
                No custom branch statements defined.
              </p>
            )}

            {branchStatements.map((b, idx) => (
              <div
                key={`branch-stmt-${idx}`}
                className="flex flex-wrap items-center gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700"
              >
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
            ))}
          </div>
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

        {/* Auto-Detection Regex Signatures */}
        <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
          <label
            htmlFor="custom-variant-detection"
            className="block font-semibold mb-0.5"
          >
            Auto-Detection Signatures (Regex, one per line)
          </label>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-1.5">
            Unique script patterns used by auto-detect mode to identify this
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
