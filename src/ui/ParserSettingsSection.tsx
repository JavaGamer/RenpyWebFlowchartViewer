import { useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Edit2,
  Info,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  CustomVariantDefinition,
  ParserVariant,
  ParserVariantPlugin,
  ScreenActionRule,
} from "../config/parserRules.ts";
import {
  downloadBlob,
  useParserRuleSettingsStore,
  useViewerStore,
} from "../application/index.ts";
import { ParserRuleEditor } from "./components/ParserRuleEditor.tsx";
import { CustomVariantModal } from "./components/CustomVariantModal.tsx";
import { cn } from "./utils/cn.ts";

export interface ParserSettingsSectionProps {
  selectedVariant: ParserVariant;
  setSelectedVariant: (variant: ParserVariant) => void;
  parserVariantPlugins: ParserVariantPlugin[];
  resetParserRuleSettings: () => void;
  selectedVariantCustomRules: ScreenActionRule[];
  updateCustomRule: (index: number, patch: Partial<ScreenActionRule>) => void;
  removeCustomRule: (index: number) => void;
  addCustomRule: () => void;
}

export default function ParserSettingsSection({
  selectedVariant,
  setSelectedVariant,
  parserVariantPlugins,
  resetParserRuleSettings,
  selectedVariantCustomRules,
  updateCustomRule,
  removeCustomRule,
  addCustomRule,
}: ParserSettingsSectionProps) {
  const [showBuiltinRules, setShowBuiltinRules] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<
    CustomVariantDefinition | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const {
    customVariants,
    addCustomVariant,
    updateCustomVariant,
    removeCustomVariant,
    exportCustomVariant,
    importCustomVariant,
  } = useParserRuleSettingsStore();

  const currentPlugin = parserVariantPlugins.find(
    (p) => p.id === selectedVariant,
  );
  const activePlugin = selectedVariant === "auto"
    ? parserVariantPlugins.find((p) => p.id === "renpy")
    : currentPlugin;

  const isCustomVariant = Boolean(currentPlugin?.isCustom);

  const variantDescription = selectedVariant === "auto"
    ? "Automatically sniffs project files for statements (timedchoice, staging keywords, DDLC minigames, Ren'Py 8.x idioms) to pick the best dialect."
    : currentPlugin?.description || "Standard syntax and screen-action rules.";

  const isOverriding = (ruleName: string) => {
    const name = ruleName.trim().toLowerCase();
    if (!name || !activePlugin) return false;
    return activePlugin.defaultScreenActionRules.some(
      (r) => r.actionName.toLowerCase() === name,
    );
  };

  const handleOpenNewModal = () => {
    setEditingVariant(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = () => {
    const found = customVariants.find((v) => v.id === selectedVariant);
    if (found) {
      setEditingVariant(found);
      setIsModalOpen(true);
    }
  };

  const handleSaveModal = (def: CustomVariantDefinition) => {
    if (editingVariant) {
      updateCustomVariant(def.id, def);
    } else {
      addCustomVariant(def);
      setSelectedVariant(def.id);
    }
  };

  const handleExport = () => {
    try {
      const json = exportCustomVariant(selectedVariant);
      const blob = new Blob([json], { type: "application/json" });
      downloadBlob(blob, `${selectedVariant}.variant.json`);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = () => {
    if (
      confirm(
        `Are you sure you want to delete custom variant "${currentPlugin?.label}"?`,
      )
    ) {
      removeCustomVariant(selectedVariant);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = importCustomVariant(text);
      if (res.success && res.id) {
        setSelectedVariant(res.id);
      } else {
        alert(`Import failed: ${res.error}`);
      }
    } catch (err) {
      alert(`Could not read file: ${(err as Error).message}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const builtinPlugins = parserVariantPlugins.filter((p) => !p.isCustom);
  const customPlugins = parserVariantPlugins.filter((p) => p.isCustom);

  return (
    <section
      className={cn(
        "mt-4 rounded-xl border p-4 text-xs transition-colors duration-200",
        isDark
          ? "border-slate-800 bg-slate-900 text-slate-300"
          : "border-gray-200 bg-white text-gray-700",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="parser-variant"
          className={cn(
            "font-semibold",
            isDark ? "text-slate-100" : "text-gray-900",
          )}
        >
          Parser variant
        </label>
        <select
          id="parser-variant"
          aria-label="Parser variant"
          value={selectedVariant}
          onChange={(event) =>
            setSelectedVariant(event.target.value as ParserVariant)}
          className={cn(
            "rounded-md border px-2 py-1 text-xs transition-colors duration-200",
            isDark
              ? "border-slate-700 bg-slate-800 text-slate-100 focus:ring-violet-400"
              : "border-gray-300 bg-white text-gray-900 focus:ring-violet-500",
          )}
        >
          <option value="auto">Auto-detect (Recommended)</option>
          <optgroup label="Built-in Presets">
            {builtinPlugins.map((variantPlugin) => (
              <option key={variantPlugin.id} value={variantPlugin.id}>
                {variantPlugin.label}
              </option>
            ))}
          </optgroup>
          {customPlugins.length > 0 && (
            <optgroup label="Custom Variants">
              {customPlugins.map((variantPlugin) => (
                <option key={variantPlugin.id} value={variantPlugin.id}>
                  {variantPlugin.label} (Custom)
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {/* Variant Action Buttons */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={handleOpenNewModal}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
              isDark
                ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
            )}
            title="Create a custom variant preset"
          >
            <Plus size={12} />
            <span>New</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
              isDark
                ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
            )}
            title="Import custom variant from .variant.json"
          >
            <Upload size={12} />
            <span>Import</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
            aria-label="Import variant JSON file"
          />

          {isCustomVariant && (
            <>
              <button
                type="button"
                onClick={handleOpenEditModal}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
                  isDark
                    ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                )}
                title="Edit this custom variant"
              >
                <Edit2 size={11} />
                <span>Edit</span>
              </button>

              <button
                type="button"
                onClick={handleExport}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
                  isDark
                    ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                )}
                title="Export this custom variant as JSON"
              >
                <Download size={11} />
                <span>Export</span>
              </button>

              <button
                type="button"
                onClick={handleDelete}
                className={cn(
                  "p-1 rounded border text-[11px] transition-colors",
                  isDark
                    ? "border-slate-700 bg-slate-800 text-rose-400 hover:bg-slate-700"
                    : "border-gray-300 bg-white text-rose-600 hover:bg-gray-50",
                )}
                title="Delete this custom variant"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}

          <button
            type="button"
            className={cn(
              "text-[11px] underline ml-1 transition-colors duration-200",
              isDark
                ? "text-slate-400 hover:text-slate-200"
                : "text-gray-500 hover:text-gray-700",
            )}
            onClick={resetParserRuleSettings}
          >
            Reset
          </button>
        </div>
      </div>

      <p
        className={cn(
          "mt-2 text-[11px] flex items-start gap-1.5",
          isDark ? "text-slate-400" : "text-gray-600",
        )}
      >
        <Info size={13} className="shrink-0 mt-0.5 text-violet-500" />
        <span>{variantDescription}</span>
      </p>

      {/* Built-in rules disclosure */}
      {activePlugin && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowBuiltinRules((prev) => !prev)}
            className={cn(
              "text-[11px] font-medium flex items-center gap-1 hover:underline focus:outline-none",
              isDark ? "text-violet-400" : "text-violet-600",
            )}
            aria-expanded={showBuiltinRules}
            aria-controls="builtin-rules-content"
          >
            <span>
              {showBuiltinRules ? "Hide" : "View"}{" "}
              rules & directives ({activePlugin.label})
            </span>
            {showBuiltinRules
              ? <ChevronUp size={12} />
              : <ChevronDown size={12} />}
          </button>

          {showBuiltinRules && (
            <div
              id="builtin-rules-content"
              className={cn(
                "mt-2 p-2.5 rounded-lg border text-[11px] space-y-2",
                isDark
                  ? "bg-slate-800/60 border-slate-700/80 text-slate-300"
                  : "bg-slate-50 border-slate-200 text-slate-700",
              )}
            >
              <div>
                <span className="font-semibold block mb-1">
                  Default Screen Actions:
                </span>
                <div className="flex flex-wrap gap-1">
                  {activePlugin.defaultScreenActionRules.map((rule) => (
                    <span
                      key={rule.actionName}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-mono border",
                        isDark
                          ? "bg-slate-700/60 border-slate-600 text-slate-200"
                          : "bg-white border-slate-300 text-slate-800",
                      )}
                    >
                      {rule.actionName} → {rule.actionKind}
                    </span>
                  ))}
                </div>
              </div>

              {activePlugin.stagingKeywords &&
                activePlugin.stagingKeywords.length > 0 && (
                <div>
                  <span className="font-semibold block mb-1">
                    Staging Directives (Non-branching):
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {activePlugin.stagingKeywords.map((kw) => (
                      <span
                        key={kw}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-mono border",
                          isDark
                            ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                            : "bg-emerald-50 border-emerald-200 text-emerald-800",
                        )}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {activePlugin.branchStatements &&
                activePlugin.branchStatements.length > 0 && (
                <div>
                  <span className="font-semibold block mb-1">
                    Branch Statements (CDS):
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {activePlugin.branchStatements.map((b, bIdx) => (
                      <span
                        key={`bstmt-${bIdx}`}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-mono border",
                          isDark
                            ? "bg-purple-950/40 border-purple-800 text-purple-300"
                            : "bg-purple-50 border-purple-200 text-purple-800",
                        )}
                      >
                        {b.branchKind} (Group {b.targetGroup ?? 1})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Custom Rules Editor */}
      <div className="mt-4 pt-3 border-t border-slate-700/40">
        <ParserRuleEditor
          rules={selectedVariantCustomRules}
          onAddRule={addCustomRule}
          onUpdateRule={updateCustomRule}
          onRemoveRule={removeCustomRule}
          isOverriding={isOverriding}
          isDark={isDark}
          title={`Custom Screen-Action Rules (${selectedVariant})`}
          description="Rules defined here apply on top of the built-in rules and persist in your browser."
        />
      </div>

      {/* Modal */}
      <CustomVariantModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveModal}
        initialDefinition={editingVariant}
        isDark={isDark}
      />
    </section>
  );
}
