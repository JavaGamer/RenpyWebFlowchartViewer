export const PARSER_VARIANTS = ['renpy', 'st'] as const;

export type ParserVariant = (typeof PARSER_VARIANTS)[number];
export type ScreenActionKind = 'jump' | 'call';

export interface ScreenActionRule {
  actionName: string;
  actionKind: ScreenActionKind;
}

const RENPY_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  { actionName: 'Jump', actionKind: 'jump' },
  { actionName: 'Call', actionKind: 'call' },
];

const ST_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  { actionName: 'timedchoice', actionKind: 'call' },
  { actionName: 'gameover', actionKind: 'jump' },
  { actionName: 'title', actionKind: 'jump' },
  { actionName: 'placeholder', actionKind: 'jump' },
  { actionName: 'routename', actionKind: 'jump' },
];

function normalizeRule(rule: ScreenActionRule): ScreenActionRule | null {
  const actionName = rule.actionName.trim();
  if (!actionName) return null;
  if (rule.actionKind !== 'jump' && rule.actionKind !== 'call') return null;
  return { actionName, actionKind: rule.actionKind };
}

export function getPredefinedScreenActionRules(variant: ParserVariant): ScreenActionRule[] {
  if (variant === 'st') {
    return [...RENPY_DEFAULT_SCREEN_ACTION_RULES, ...ST_DEFAULT_SCREEN_ACTION_RULES];
  }
  return [...RENPY_DEFAULT_SCREEN_ACTION_RULES];
}

export function mergeScreenActionRules(
  variant: ParserVariant,
  customRules: ScreenActionRule[] | undefined,
): ScreenActionRule[] {
  const merged = new Map<string, ScreenActionRule>();
  for (const rule of getPredefinedScreenActionRules(variant)) {
    merged.set(rule.actionName.toLowerCase(), rule);
  }
  for (const rule of customRules ?? []) {
    const normalized = normalizeRule(rule);
    if (!normalized) continue;
    merged.set(normalized.actionName.toLowerCase(), normalized);
  }
  return Array.from(merged.values());
}

export function toScreenActionRuleMap(
  variant: ParserVariant | undefined,
  customRules: ScreenActionRule[] | undefined,
): Map<string, ScreenActionKind> {
  const effectiveVariant = variant ?? 'renpy';
  const ruleMap = new Map<string, ScreenActionKind>();
  for (const rule of mergeScreenActionRules(effectiveVariant, customRules)) {
    ruleMap.set(rule.actionName.toLowerCase(), rule.actionKind);
  }
  return ruleMap;
}
