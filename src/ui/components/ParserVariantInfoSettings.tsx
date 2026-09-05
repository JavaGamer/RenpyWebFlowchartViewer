import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useAppStore,
  useParserRuleSettingsStore,
  useViewerStore,
} from "../../application/index.ts";
import {
  FALLBACK_PARSER_VARIANT,
  getParserVariantPlugin,
  mergeScreenActionRules,
  resolveCustomRulesForVariant,
  type ScreenActionKind,
} from "../../config/parserRules.ts";
import { SectionHeader } from "../primitives/index.ts";
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

export function ParserVariantInfoSettings() {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === "dark";

  const { parsedVariant, isVariantAutoDetected } = useAppStore(
    useShallow((s) => ({
      parsedVariant: s.parsedVariant,
      isVariantAutoDetected: s.isVariantAutoDetected,
    })),
  );

  const customRulesByVariant = useParserRuleSettingsStore(
    (s) => s.customRulesByVariant,
  );

  const [rulesExpanded, setRulesExpanded] = useState(false);

  const effectiveVariant = parsedVariant ?? FALLBACK_PARSER_VARIANT;
  const plugin = getParserVariantPlugin(effectiveVariant);

  const effectiveCustomRules = useMemo(
    () => resolveCustomRulesForVariant(effectiveVariant, customRulesByVariant),
    [effectiveVariant, customRulesByVariant],
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

  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Parser variant and rules information"
    >
      <SectionHeader title="Parser Variant & Rules" isDark={isDark} />
      <div
        className={cn(
          "flex flex-col gap-3 p-3 rounded-lg border text-xs",
          isDark
            ? "bg-slate-800/40 border-slate-700/60"
            : "bg-gray-50/50 border-gray-100",
        )}
      >
        {/* Variant Info Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-semibold text-sm",
                isDark ? "text-slate-100" : "text-gray-900",
              )}
            >
              {plugin.label}
            </span>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-medium border",
                isVariantAutoDetected
                  ? isDark
                    ? "bg-indigo-950/60 border-indigo-700 text-indigo-300"
                    : "bg-indigo-50 border-indigo-200 text-indigo-700"
                  : isDark
                  ? "bg-slate-700/60 border-slate-600 text-slate-300"
                  : "bg-gray-100 border-gray-200 text-gray-700",
              )}
            >
              {isVariantAutoDetected ? "Auto-detected" : "Configured"}
            </span>
          </div>
          <span
            className={cn(
              "text-[11px]",
              isDark ? "text-slate-400" : "text-gray-500",
            )}
          >
            {mergedRules.length} rules active
          </span>
        </div>

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

        {/* Staging Directives if any */}
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

        {/* Screen Action Rules Collapsible */}
        <div className="flex flex-col gap-2 pt-1 border-t border-dashed border-gray-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setRulesExpanded((prev) => !prev)}
            className={cn(
              "flex items-center justify-between text-[11px] font-semibold text-left focus-visible:outline-none focus-visible:ring-1 rounded",
              isDark
                ? "text-slate-300 hover:text-slate-100"
                : "text-gray-700 hover:text-gray-900",
            )}
            aria-expanded={rulesExpanded}
            aria-controls="active-screen-action-rules-content"
          >
            <span>Active Screen-Action Rules</span>
            <span className="text-xs font-mono">
              {rulesExpanded ? "−" : "+"}
            </span>
          </button>

          {rulesExpanded && (
            <div
              id="active-screen-action-rules-content"
              className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1"
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
    </div>
  );
}
