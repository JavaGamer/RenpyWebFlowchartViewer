import {
  DEFAULT_PARSER_VARIANT,
  getParserVariants,
  isParserVariant,
  normalizeScreenActionRule,
  type ParserVariant,
  type ScreenActionRule,
} from '../config/parserRules';
import { STORAGE_KEYS } from '../config/storageKeys';

export type RulesByVariant = Record<string, ScreenActionRule[]>;

export interface ParserRuleSettings {
  selectedVariant: ParserVariant;
  customRulesByVariant: RulesByVariant;
}

function createEmptyRulesByVariant(): RulesByVariant {
  return Object.fromEntries(getParserVariants().map((variant) => [variant, []] as const));
}

export const defaultParserRuleSettings: ParserRuleSettings = {
  selectedVariant: DEFAULT_PARSER_VARIANT,
  customRulesByVariant: createEmptyRulesByVariant(),
};

function normalizeRule(value: unknown): ScreenActionRule | null {
  if (!value || typeof value !== 'object') return null;
  const actionName = 'actionName' in value && typeof value.actionName === 'string'
    ? value.actionName.trim()
    : '';
  const actionKind = 'actionKind' in value && (value.actionKind === 'jump' || value.actionKind === 'call')
    ? value.actionKind
    : null;
  if (!actionName || !actionKind) return null;
  return normalizeScreenActionRule({ actionName, actionKind });
}

export function loadParserRuleSettings(): ParserRuleSettings {
  try {
    if (typeof globalThis.localStorage === 'undefined') return defaultParserRuleSettings;
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.parserSettings);
    if (!raw) return defaultParserRuleSettings;
    const parsed = JSON.parse(raw) as Partial<ParserRuleSettings>;
    const selectedVariant = isParserVariant(parsed.selectedVariant)
      ? parsed.selectedVariant
      : defaultParserRuleSettings.selectedVariant;
    const customRulesByVariant = createEmptyRulesByVariant();
    const entries = Object.entries(parsed.customRulesByVariant ?? {});
    for (const [variant, rules] of entries) {
      if (!isParserVariant(variant) || !Array.isArray(rules)) continue;
      customRulesByVariant[variant] = rules
        .map(normalizeRule)
        .filter((rule): rule is ScreenActionRule => rule !== null);
    }
    return {
      selectedVariant,
      customRulesByVariant,
    };
  } catch {
    return defaultParserRuleSettings;
  }
}

export function saveParserRuleSettings(settings: ParserRuleSettings): void {
  try {
    if (typeof globalThis.localStorage === 'undefined') return;
    globalThis.localStorage.setItem(STORAGE_KEYS.parserSettings, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures in restricted browsing modes.
  }
}
