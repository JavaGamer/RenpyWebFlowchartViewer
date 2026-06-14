

import type {
  ParserVariant,
  ScreenActionKind,
  ParserVariantPlugin,
  ScreenActionRule,
} from '../config/parserRules';
import { useViewerStore } from '../application';
import { cn } from './utils/cn';

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
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === 'dark';

  return (
    <section className={cn(
      "mt-4 rounded-xl border p-4 text-xs transition-colors duration-200",
      isDark
        ? "border-slate-800 bg-slate-900 text-slate-300"
        : "border-gray-200 bg-white text-gray-700"
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="parser-variant" className={cn("font-semibold", isDark ? "text-slate-100" : "text-gray-900")}>
          Parser variant
        </label>
        <select
          id="parser-variant"
          aria-label="Parser variant"
          value={selectedVariant}
          onChange={(event) => setSelectedVariant(event.target.value as ParserVariant)}
          className={cn(
            "rounded-md border px-2 py-1 text-xs transition-colors duration-200",
            isDark
              ? "border-slate-700 bg-slate-800 text-slate-100 focus:ring-violet-400"
              : "border-gray-300 bg-white text-gray-900 focus:ring-violet-500"
          )}
        >
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
            isDark ? "text-slate-400 hover:text-slate-200" : "text-gray-500 hover:text-gray-700"
          )}
          onClick={resetParserRuleSettings}
        >
          Reset variant + custom rules
        </button>
      </div>
      <p className={cn("mt-2 text-[11px]", isDark ? "text-slate-450" : "text-gray-505")}>
        Custom screen-action rules are stored in your browser and reused across project imports.
      </p>
      <div className="mt-3 space-y-2" aria-label="Custom screen action rules">
        {selectedVariantCustomRules.map((rule, idx) => (
          <div key={`${selectedVariant}-rule-${idx}`} className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`Custom rule action ${idx + 1}`}
              value={rule.actionName}
              onChange={(event) => updateCustomRule(idx, { actionName: event.target.value })}
              className={cn(
                "min-w-36 flex-1 rounded-md border px-2 py-1 text-xs transition-colors duration-200",
                isDark
                  ? "border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 focus:ring-violet-400"
                  : "border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:ring-violet-500"
              )}
              placeholder="action name"
            />
            <select
              aria-label={`Custom rule action type ${idx + 1}`}
              value={rule.actionKind}
              onChange={(event) =>
                updateCustomRule(idx, { actionKind: event.target.value as ScreenActionKind })
              }
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors duration-200",
                isDark
                  ? "border-slate-700 bg-slate-800 text-slate-100 focus:ring-violet-400"
                  : "border-gray-300 bg-white text-gray-900 focus:ring-violet-500"
              )}
            >
              <option value="jump">jump</option>
              <option value="call">call</option>
            </select>
            <button
              type="button"
              aria-label={`Remove custom rule ${idx + 1}`}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition-colors duration-200",
                isDark
                  ? "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  : "border-gray-300 bg-white text-gray-650 hover:bg-gray-50"
              )}
              onClick={() => removeCustomRule(idx)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addCustomRule}
        className={cn(
          "mt-3 rounded-md border px-2 py-1 text-[11px] transition-colors duration-205",
          isDark
            ? "border-violet-800 bg-slate-800 text-violet-300 hover:bg-slate-750"
            : "border-violet-300 bg-white text-violet-750 hover:bg-violet-50"
        )}
      >
        Add custom rule
      </button>
    </section>
  );
}
