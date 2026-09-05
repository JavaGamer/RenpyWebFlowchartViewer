import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import type {
  ParserVariant,
  ParserVariantPlugin,
  ScreenActionKind,
  ScreenActionRule,
} from "../config/parserRules.ts";
import { useViewerStore } from "../application/index.ts";
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

const ALL_SCREEN_ACTION_KINDS: ScreenActionKind[] = [
  "jump",
  "call",
  "show",
  "hide",
  "set_variable",
  "toggle_variable",
  "confirm",
  "null_action",
  "show_menu",
];

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
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const currentPlugin = parserVariantPlugins.find(
    (p) => p.id === selectedVariant,
  );
  const activePlugin = selectedVariant === "auto"
    ? parserVariantPlugins.find((p) => p.id === "renpy")
    : currentPlugin;

  const variantDescription = selectedVariant === "auto"
    ? "Automatically detects script dialect (ST or Ren'Py) based on statements like timed choices, placeholders, and staging directives."
    : currentPlugin?.description || "Standard syntax and screen-action rules.";

  const isOverriding = (ruleName: string) => {
    const name = ruleName.trim().toLowerCase();
    if (!name || !activePlugin) return false;
    return activePlugin.defaultScreenActionRules.some(
      (r) => r.actionName.toLowerCase() === name,
    );
  };

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
          {parserVariantPlugins.map((variantPlugin) => (
            <option key={variantPlugin.id} value={variantPlugin.id}>
              {variantPlugin.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={cn(
            "ml-auto text-[11px] underline transition-colors duration-200",
            isDark
              ? "text-slate-400 hover:text-slate-200"
              : "text-gray-500 hover:text-gray-700",
          )}
          onClick={resetParserRuleSettings}
        >
          Reset variant + custom rules
        </button>
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
              built-in rules & directives ({activePlugin.label})
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
            </div>
          )}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-700/40">
        <span
          className={cn(
            "font-semibold block mb-1",
            isDark ? "text-slate-200" : "text-gray-800",
          )}
        >
          Custom Screen-Action Rules ({selectedVariant})
        </span>
        <p
          className={cn(
            "text-[11px] mb-2",
            isDark ? "text-slate-400" : "text-gray-500",
          )}
        >
          Rules defined here apply on top of the built-in rules and persist in
          your browser.
        </p>

        <div
          className="space-y-2"
          role="group"
          aria-label="Custom screen action rules"
        >
          {selectedVariantCustomRules.length === 0 && (
            <p
              className={cn(
                "text-[11px] italic",
                isDark ? "text-slate-500" : "text-gray-400",
              )}
            >
              No custom rules for this variant yet. Click below to add one.
            </p>
          )}

          {selectedVariantCustomRules.map((rule, idx) => {
            const overriding = isOverriding(rule.actionName);
            return (
              <div
                key={`${selectedVariant}-rule-${idx}`}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  aria-label={`Custom rule action ${idx + 1}`}
                  value={rule.actionName}
                  onChange={(event) =>
                    updateCustomRule(idx, { actionName: event.target.value })}
                  className={cn(
                    "min-w-36 flex-1 rounded-md border px-2 py-1 text-xs transition-colors duration-200",
                    isDark
                      ? "border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 focus:ring-violet-400"
                      : "border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:ring-violet-500",
                  )}
                  placeholder="action name"
                />
                <select
                  aria-label={`Custom rule action type ${idx + 1}`}
                  value={rule.actionKind}
                  onChange={(event) =>
                    updateCustomRule(idx, {
                      actionKind: event.target.value as ScreenActionKind,
                    })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors duration-200",
                    isDark
                      ? "border-slate-700 bg-slate-800 text-slate-100 focus:ring-violet-400"
                      : "border-gray-300 bg-white text-gray-900 focus:ring-violet-500",
                  )}
                >
                  {ALL_SCREEN_ACTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>

                {overriding && (
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium",
                      isDark
                        ? "bg-amber-950/60 border border-amber-800 text-amber-300"
                        : "bg-amber-100 border border-amber-200 text-amber-800",
                    )}
                    title="Overrides built-in screen-action rule"
                  >
                    Overrides default
                  </span>
                )}

                <button
                  type="button"
                  aria-label={`Remove custom rule ${idx + 1}`}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] transition-colors duration-200",
                    isDark
                      ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                  )}
                  onClick={() => removeCustomRule(idx)}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addCustomRule}
          className={cn(
            "mt-3 rounded-md border px-2 py-1 text-[11px] transition-colors duration-200",
            isDark
              ? "border-violet-800 bg-slate-800 text-violet-300 hover:bg-slate-700"
              : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50",
          )}
        >
          Add custom rule
        </button>
      </div>
    </section>
  );
}
