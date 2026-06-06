

import type {
  ParserVariant,
  ScreenActionKind,
  ParserVariantPlugin,
  ScreenActionRule,
} from '../config/parserRules';

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
  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="parser-variant" className="font-semibold text-gray-900">
          Parser variant
        </label>
        <select
          id="parser-variant"
          aria-label="Parser variant"
          value={selectedVariant}
          onChange={(event) => setSelectedVariant(event.target.value as ParserVariant)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs bg-white"
        >
          {parserVariantPlugins.map((variantPlugin) => (
            <option key={variantPlugin.id} value={variantPlugin.id}>
              {variantPlugin.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ml-auto text-[11px] underline text-gray-500 hover:text-gray-700"
          onClick={resetParserRuleSettings}
        >
          Reset variant + custom rules
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Custom screen-action rules are stored in your browser and reused across project imports.
      </p>
      <div className="mt-3 space-y-2" aria-label="Custom screen action rules">
        {selectedVariantCustomRules.map((rule, idx) => (
          <div key={`${selectedVariant}-rule-${idx}`} className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`Custom rule action ${idx + 1}`}
              value={rule.actionName}
              onChange={(event) => updateCustomRule(idx, { actionName: event.target.value })}
              className="min-w-36 flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
              placeholder="action name"
            />
            <select
              aria-label={`Custom rule action type ${idx + 1}`}
              value={rule.actionKind}
              onChange={(event) =>
                updateCustomRule(idx, { actionKind: event.target.value as ScreenActionKind })
              }
              className="rounded-md border border-gray-300 px-2 py-1 text-xs bg-white"
            >
              <option value="jump">jump</option>
              <option value="call">call</option>
            </select>
            <button
              type="button"
              aria-label={`Remove custom rule ${idx + 1}`}
              className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
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
        className="mt-3 rounded-md border border-violet-300 px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-50"
      >
        Add custom rule
      </button>
    </section>
  );
}
