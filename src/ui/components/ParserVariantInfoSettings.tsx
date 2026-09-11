import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  downloadBlob,
  hasUploadedFilesCache,
  reparseUploadedFiles,
  useAppStore,
  useParserRuleSettingsStore,
  useViewerStore,
} from "../../application/index.ts";
import {
  type CustomVariantDefinition,
  FALLBACK_PARSER_VARIANT,
  getParserVariantPlugin,
  getParserVariantPlugins,
  mergeScreenActionRules,
  type ParserVariant,
  resolveCustomRulesForVariant,
  type ScreenActionKind,
} from "../../config/parserRules.ts";
import type { UnmappedScreenActionParseDiagnosticPayload } from "../../infrastructure/index.ts";
import { SectionHeader } from "../primitives/index.ts";
import { ParserRuleEditor } from "./ParserRuleEditor.tsx";
import { CustomVariantModal } from "./CustomVariantModal.tsx";
import { cn } from "../utils/cn.ts";

const ACTION_KIND_STYLES: Record<ScreenActionKind, string> = {
  jump:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  call:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  show:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  hide:
    "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  show_menu:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  set_variable:
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
  toggle_variable:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  confirm:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800",
  null_action:
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
};

interface UnmappedActionSummary {
  actionName: string;
  count: number;
  locations: string[];
}

export function ParserVariantInfoSettings() {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const {
    parsedVariant,
    isVariantAutoDetected,
    parseDiagnostics,
    isReparsing,
  } = useAppStore(
    useShallow((s) => ({
      parsedVariant: s.parsedVariant,
      isVariantAutoDetected: s.isVariantAutoDetected,
      parseDiagnostics: s.parseDiagnostics,
      isReparsing: s.isReparsing,
    })),
  );

  const {
    selectedVariant,
    setSelectedVariant,
    customRulesByVariant,
    customVariants,
    addCustomRule,
    updateCustomRule,
    removeCustomRule,
    addCustomVariant,
    updateCustomVariant,
    removeCustomVariant,
    exportCustomVariant,
    importCustomVariant,
  } = useParserRuleSettingsStore();

  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<
    CustomVariantDefinition | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveVariant = selectedVariant !== "auto"
    ? selectedVariant
    : (parsedVariant ?? FALLBACK_PARSER_VARIANT);
  const plugin = getParserVariantPlugin(effectiveVariant);
  const isCustomVariant = Boolean(plugin.isCustom);

  const allPlugins = getParserVariantPlugins();
  const builtinPlugins = allPlugins.filter((p) => !p.isCustom);
  const customPlugins = allPlugins.filter((p) => p.isCustom);

  const effectiveCustomRules = useMemo(
    () => resolveCustomRulesForVariant(effectiveVariant, customRulesByVariant),
    [effectiveVariant, customRulesByVariant],
  );

  const activeVariantRules = useMemo(
    () => customRulesByVariant[effectiveVariant] ?? [],
    [customRulesByVariant, effectiveVariant],
  );

  const mergedRules = useMemo(
    () => mergeScreenActionRules(effectiveVariant, effectiveCustomRules),
    [effectiveVariant, effectiveCustomRules],
  );

  const defaultRuleNames = useMemo(
    () =>
      new Set(
        plugin.defaultScreenActionRules.map((r) => r.actionName.toLowerCase()),
      ),
    [plugin],
  );

  // Group unmapped screen actions from parse diagnostics
  const unmappedActions = useMemo<UnmappedActionSummary[]>(() => {
    const map = new Map<string, UnmappedActionSummary>();
    for (const diag of parseDiagnostics) {
      if (diag.code === "unmapped_screen_action") {
        const payload =
          diag as unknown as UnmappedScreenActionParseDiagnosticPayload;
        const locObj = payload.location;
        const name = locObj?.actionName?.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const loc = locObj?.chapter
          ? `${locObj.chapter}${locObj.lineNum ? `:${locObj.lineNum}` : ""}`
          : "";
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
          if (
            loc && !existing.locations.includes(loc) &&
            existing.locations.length < 3
          ) {
            existing.locations.push(loc);
          }
        } else {
          map.set(key, {
            actionName: name,
            count: 1,
            locations: loc ? [loc] : [],
          });
        }
      }
    }
    return Array.from(map.values());
  }, [parseDiagnostics]);

  const handleVariantChange = async (newVariant: string) => {
    setSelectedVariant(newVariant as ParserVariant);
    if (hasUploadedFilesCache()) {
      await reparseUploadedFiles({ preserveSession: true });
    }
  };

  const handleQuickMapAction = async (
    actionName: string,
    kind: ScreenActionKind,
  ) => {
    if (isReparsing || !hasUploadedFilesCache()) return;
    const variantKey = effectiveVariant;
    const existingRules = customRulesByVariant[variantKey] ?? [];
    const existingIdx = existingRules.findIndex(
      (r) => r.actionName.toLowerCase() === actionName.toLowerCase(),
    );

    if (existingIdx >= 0) {
      updateCustomRule(existingIdx, { actionKind: kind }, variantKey);
    } else {
      // Add new rule
      useParserRuleSettingsStore.setState((state) => {
        if (!state.customRulesByVariant[variantKey]) {
          state.customRulesByVariant[variantKey] = [];
        }
        state.customRulesByVariant[variantKey].push({
          actionName,
          actionKind: kind,
        });
      });
    }

    if (hasUploadedFilesCache()) {
      await reparseUploadedFiles({ preserveSession: true });
    }
  };

  const handleReparse = async () => {
    await reparseUploadedFiles({ preserveSession: true });
  };

  const handleOpenNewModal = () => {
    setEditingVariant(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = () => {
    const found = customVariants.find((v) => v.id === effectiveVariant);
    if (found) {
      setEditingVariant(found);
      setIsModalOpen(true);
    }
  };

  const handleSaveModal = async (def: CustomVariantDefinition) => {
    if (editingVariant) {
      updateCustomVariant(def.id, def);
    } else {
      addCustomVariant(def);
      setSelectedVariant(def.id);
    }
    if (hasUploadedFilesCache()) {
      await reparseUploadedFiles({ preserveSession: true });
    }
  };

  const handleExport = () => {
    try {
      const json = exportCustomVariant(effectiveVariant);
      const blob = new Blob([json], { type: "application/json" });
      downloadBlob(blob, `${effectiveVariant}.variant.json`);
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (
      confirm(
        `Are you sure you want to delete custom variant "${plugin.label}"?`,
      )
    ) {
      removeCustomVariant(effectiveVariant);
      if (hasUploadedFilesCache()) {
        await reparseUploadedFiles({ preserveSession: true });
      }
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
        if (hasUploadedFilesCache()) {
          await reparseUploadedFiles({ preserveSession: true });
        }
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

  const isOverriding = (ruleName: string) => {
    const name = ruleName.trim().toLowerCase();
    if (!name) return false;
    return plugin.defaultScreenActionRules.some(
      (r) => r.actionName.toLowerCase() === name,
    );
  };

  const canReparse = hasUploadedFilesCache();

  return (
    <div
      className="flex flex-col gap-3"
      role="group"
      aria-label="Parser variant and rules information"
    >
      <SectionHeader title="Parser Variant & Rules" isDark={isDark} />

      {/* Detached In-Memory Cache Warning Banner */}
      {!canReparse && (
        <div
          data-testid="detached-cache-banner"
          className={cn(
            "p-2.5 rounded-md border text-[11px] flex items-start gap-2",
            isDark
              ? "bg-slate-800/60 border-slate-700 text-slate-300"
              : "bg-slate-50 border-slate-200 text-slate-600",
          )}
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-slate-400" />
          <span>
            In-memory project files are unavailable (e.g. after a page reload or
            sample project). Re-upload your project folder to enable instant
            variant switching and action mapping.
          </span>
        </div>
      )}

      {/* Unmapped Screen Actions Discovery Card */}
      {unmappedActions.length > 0 && (
        <div
          data-testid="unmapped-actions-alert-card"
          className={cn(
            "p-3 rounded-lg border text-xs space-y-2.5",
            isDark
              ? "bg-amber-950/40 border-amber-800/80 text-amber-200"
              : "bg-amber-50 border-amber-200 text-amber-900",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={15} className="text-amber-500 shrink-0" />
              <span>
                {unmappedActions.length} Unmapped Screen Action
                {unmappedActions.length === 1 ? "" : "s"} Discovered
              </span>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-200/50 dark:bg-amber-900/60">
              Smart Discovery
            </span>
          </div>

          <p className="text-[11px] leading-relaxed opacity-90">
            The parser detected unrecognized screen actions. Map them with
            1-click to connect missing flowchart branches instantly:
          </p>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {unmappedActions.map((unmapped) => (
              <div
                key={unmapped.actionName}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 p-2 rounded border text-xs",
                  isDark
                    ? "bg-slate-900/80 border-amber-900/60"
                    : "bg-white border-amber-200 shadow-sm",
                )}
              >
                <div className="flex flex-col min-w-32">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-violet-600 dark:text-violet-400">
                      {unmapped.actionName}
                    </span>
                    <span className="text-[10px] opacity-75">
                      ({unmapped.count}x)
                    </span>
                  </div>
                  {unmapped.locations.length > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-slate-400 font-mono truncate">
                      {unmapped.locations.join(", ")}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 ml-auto">
                  <button
                    type="button"
                    disabled={isReparsing || !canReparse}
                    onClick={() =>
                      handleQuickMapAction(unmapped.actionName, "jump")}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] font-semibold border transition-colors",
                      isReparsing || !canReparse
                        ? "opacity-50 cursor-not-allowed border-gray-300 text-gray-400 dark:border-slate-700 dark:text-slate-600"
                        : isDark
                        ? "bg-blue-950 border-blue-800 text-blue-300 hover:bg-blue-900"
                        : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100",
                    )}
                    title={`Map "${unmapped.actionName}" as a jump edge and re-parse`}
                  >
                    + Jump
                  </button>

                  <button
                    type="button"
                    disabled={isReparsing || !canReparse}
                    onClick={() =>
                      handleQuickMapAction(unmapped.actionName, "call")}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] font-semibold border transition-colors",
                      isReparsing || !canReparse
                        ? "opacity-50 cursor-not-allowed border-gray-300 text-gray-400 dark:border-slate-700 dark:text-slate-600"
                        : isDark
                        ? "bg-purple-950 border-purple-800 text-purple-300 hover:bg-purple-900"
                        : "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100",
                    )}
                    title={`Map "${unmapped.actionName}" as a subroutine call and re-parse`}
                  >
                    + Call
                  </button>

                  <button
                    type="button"
                    disabled={isReparsing || !canReparse}
                    onClick={() =>
                      handleQuickMapAction(unmapped.actionName, "null_action")}
                    className={cn(
                      "px-2 py-1 rounded text-[11px] border transition-colors",
                      isReparsing || !canReparse
                        ? "opacity-50 cursor-not-allowed border-gray-300 text-gray-400 dark:border-slate-700 dark:text-slate-600"
                        : isDark
                        ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                        : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200",
                    )}
                    title={`Ignore "${unmapped.actionName}" as a null action`}
                  >
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Settings Box */}
      <div
        className={cn(
          "flex flex-col gap-3 p-3 rounded-lg border text-xs",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        {/* Interactive Variant Selector & Management */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="viewer-parser-variant-select"
              className={cn(
                "font-semibold text-xs",
                isDark ? "text-slate-200" : "text-gray-800",
              )}
            >
              Dialect:
            </label>
            <select
              id="viewer-parser-variant-select"
              aria-label="Switch parser variant"
              disabled={isReparsing}
              value={selectedVariant}
              onChange={(e) => handleVariantChange(e.target.value)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                isDark
                  ? "border-slate-700 bg-slate-800 text-slate-100 focus:ring-violet-400"
                  : "border-gray-300 bg-white text-gray-900 focus:ring-violet-500",
              )}
            >
              <option value="auto">Auto-detect</option>
              <optgroup label="Built-in Presets">
                {builtinPlugins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              {customPlugins.length > 0 && (
                <optgroup label="Custom Variants">
                  {customPlugins.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} (Custom)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-medium border",
                isVariantAutoDetected
                  ? isDark
                    ? "bg-indigo-950/60 border-indigo-700 text-indigo-300"
                    : "bg-indigo-50 border-indigo-200 text-indigo-700"
                  : isDark
                  ? "bg-slate-700/60 border-slate-600 text-slate-300"
                  : "bg-gray-100 border-gray-200 text-gray-700",
              )}
            >
              {isVariantAutoDetected ? "Auto" : "Manual"}
            </span>
          </div>

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
              title="Create custom variant"
            >
              <Plus size={11} />
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
              title="Import variant JSON"
            >
              <Upload size={11} />
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
                    "p-1 rounded border text-[11px] transition-colors",
                    isDark
                      ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                      : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100",
                  )}
                  title="Edit custom variant"
                >
                  <Edit2 size={11} />
                </button>

                <button
                  type="button"
                  onClick={handleExport}
                  className={cn(
                    "p-1 rounded border text-[11px] transition-colors",
                    isDark
                      ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                      : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100",
                  )}
                  title="Export variant JSON"
                >
                  <Download size={11} />
                </button>

                <button
                  type="button"
                  onClick={handleDelete}
                  className={cn(
                    "p-1 rounded border text-[11px] transition-colors",
                    isDark
                      ? "border-slate-700 bg-slate-800 text-rose-400 hover:bg-slate-700"
                      : "border-gray-300 bg-white text-rose-600 hover:bg-gray-100",
                  )}
                  title="Delete custom variant"
                >
                  <Trash2 size={11} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Variant Description */}
        {plugin.description && (
          <p
            className={cn(
              "text-[11px] leading-relaxed",
              isDark ? "text-slate-400" : "text-gray-500",
            )}
          >
            {plugin.description}
          </p>
        )}

        {/* Staging Directives */}
        {plugin.stagingKeywords && plugin.stagingKeywords.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1 border-t border-dashed border-gray-200 dark:border-slate-700">
            <span
              className={cn(
                "text-[10px] uppercase font-bold tracking-wider",
                isDark ? "text-slate-400" : "text-gray-500",
              )}
            >
              Staging Directives
            </span>
            <div className="flex flex-wrap gap-1">
              {plugin.stagingKeywords.map((kw) => (
                <span
                  key={kw}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[11px] font-mono border",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-300"
                      : "bg-gray-100 border-gray-200 text-gray-700",
                  )}
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Apply & Re-parse Button */}
        <div className="pt-2 border-t border-dashed border-gray-200 dark:border-slate-700">
          <button
            type="button"
            disabled={!canReparse || isReparsing}
            onClick={handleReparse}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-medium text-xs shadow-sm transition-all duration-200",
              canReparse && !isReparsing
                ? "bg-violet-600 hover:bg-violet-700 text-white active:scale-[0.99]"
                : "bg-gray-200 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed",
            )}
          >
            {isReparsing
              ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Re-parsing Flowchart...</span>
                </>
              )
              : (
                <>
                  <RefreshCw size={14} />
                  <span>Apply & Re-parse Flowchart</span>
                </>
              )}
          </button>
          <p className="mt-1 text-[10px] text-center text-gray-400 dark:text-slate-500">
            {canReparse
              ? "Re-parses in memory instantly without re-uploading files."
              : "Upload a project folder to enable instant re-parse."}
          </p>
        </div>

        {/* Custom Rules In-Viewer Editor Collapsible */}
        <div className="pt-2 border-t border-dashed border-gray-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setEditorExpanded((prev) => !prev)}
            className={cn(
              "flex items-center justify-between w-full text-[11px] font-semibold text-left focus:outline-none",
              isDark
                ? "text-slate-300 hover:text-slate-100"
                : "text-gray-700 hover:text-gray-900",
            )}
          >
            <span>Edit Custom Rules ({activeVariantRules.length})</span>
            {editorExpanded
              ? <ChevronUp size={12} />
              : <ChevronDown size={12} />}
          </button>

          {editorExpanded && (
            <div className="mt-2.5">
              <ParserRuleEditor
                rules={activeVariantRules}
                onAddRule={() => addCustomRule(effectiveVariant)}
                onUpdateRule={(idx, patch) =>
                  updateCustomRule(idx, patch, effectiveVariant)}
                onRemoveRule={(idx) => removeCustomRule(idx, effectiveVariant)}
                isOverriding={isOverriding}
                isDark={isDark}
                description="Custom rules for this variant. Click 'Apply & Re-parse' above after making edits."
              />
            </div>
          )}
        </div>

        {/* Active Screen Action Rules Collapsible */}
        <div className="pt-2 border-t border-dashed border-gray-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setRulesExpanded((prev) => !prev)}
            className={cn(
              "flex items-center justify-between w-full text-[11px] font-semibold text-left focus:outline-none",
              isDark
                ? "text-slate-300 hover:text-slate-100"
                : "text-gray-700 hover:text-gray-900",
            )}
          >
            <span>View All Active Rules ({mergedRules.length})</span>
            {rulesExpanded
              ? <ChevronUp size={12} />
              : <ChevronDown size={12} />}
          </button>

          {rulesExpanded && (
            <div
              id="active-screen-action-rules-content"
              className="mt-2 flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1"
            >
              {mergedRules.map((rule) => {
                const isCustom = effectiveCustomRules.some(
                  (cr) =>
                    cr.actionName.toLowerCase() ===
                      rule.actionName.toLowerCase(),
                );
                const isOverride = isCustom &&
                  defaultRuleNames.has(rule.actionName.toLowerCase());
                const kindClass = ACTION_KIND_STYLES[rule.actionKind] ??
                  ACTION_KIND_STYLES.jump;

                return (
                  <div
                    key={rule.actionName}
                    className={cn(
                      "flex items-center justify-between gap-1.5 py-1 px-2 rounded border text-xs",
                      isDark
                        ? "bg-slate-800/80 border-slate-700/60"
                        : "bg-white border-gray-200/80",
                    )}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className={cn(
                          "font-mono font-medium truncate",
                          isDark ? "text-slate-200" : "text-gray-800",
                        )}
                        title={rule.actionName}
                      >
                        {rule.actionName}
                      </span>
                      {isOverride
                        ? (
                          <span className="px-1 py-0.2 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                            override
                          </span>
                        )
                        : isCustom
                        ? (
                          <span className="px-1 py-0.2 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                            custom
                          </span>
                        )
                        : null}
                    </div>
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border shrink-0",
                        kindClass,
                      )}
                    >
                      {rule.actionKind}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <CustomVariantModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveModal}
        initialDefinition={editingVariant}
        isDark={isDark}
      />
    </div>
  );
}
