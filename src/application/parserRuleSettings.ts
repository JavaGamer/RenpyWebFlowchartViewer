import { PARSER_VARIANTS, type ParserVariant, type ScreenActionRule } from '../config/parserRules';
import { STORAGE_KEYS } from '../config/storageKeys';

export type RulesByVariant = Record<ParserVariant, ScreenActionRule[]>;

export interface ParserRuleSettings {
  selectedVariant: ParserVariant;
  customRulesByVariant: RulesByVariant;
}

export const defaultParserRuleSettings: ParserRuleSettings = {
  selectedVariant: 'renpy',
  customRulesByVariant: {
    renpy: [],
    st: [],
  },
};

function isParserVariant(value: unknown): value is ParserVariant {
  return typeof value === 'string' && PARSER_VARIANTS.includes(value as ParserVariant);
}

function normalizeRule(value: unknown): ScreenActionRule | null {
  if (!value || typeof value !== 'object') return null;
  const actionName = 'actionName' in value && typeof value.actionName === 'string'
    ? value.actionName.trim()
    : '';
  const actionKind = 'actionKind' in value && (value.actionKind === 'jump' || value.actionKind === 'call')
    ? value.actionKind
    : null;
  if (!actionName || !actionKind) return null;
  return { actionName, actionKind };
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
    const renpyRules = (parsed.customRulesByVariant?.renpy ?? [])
      .map(normalizeRule)
      .filter((rule): rule is ScreenActionRule => rule !== null);
    const stRules = (parsed.customRulesByVariant?.st ?? [])
      .map(normalizeRule)
      .filter((rule): rule is ScreenActionRule => rule !== null);
    return {
      selectedVariant,
      customRulesByVariant: {
        renpy: renpyRules,
        st: stRules,
      },
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
