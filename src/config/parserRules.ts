export type ParserVariant = string;
export type ScreenActionKind = 'jump' | 'call';

export interface ScreenActionRule {
  actionName: string;
  actionKind: ScreenActionKind;
}

export interface ParserVariantPlugin {
  id: string;
  label: string;
  defaultScreenActionRules: ScreenActionRule[];
  normalizeCustomRule?: (rule: ScreenActionRule) => ScreenActionRule | null;
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

export const BUILTIN_PARSER_VARIANT_PLUGINS: readonly ParserVariantPlugin[] = [
  {
    id: 'renpy',
    label: "Ren'Py",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
  },
  {
    id: 'st',
    label: 'ST',
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES, ...ST_DEFAULT_SCREEN_ACTION_RULES],
  },
] as const;

export const DEFAULT_PARSER_VARIANT = 'renpy' as const;
const parserVariantPluginMap = new Map(BUILTIN_PARSER_VARIANT_PLUGINS.map((plugin) => [plugin.id, plugin] as const));

export function getParserVariantPlugins(): ParserVariantPlugin[] {
  return Array.from(parserVariantPluginMap.values());
}

export function getParserVariants(): string[] {
  return getParserVariantPlugins().map((plugin) => plugin.id);
}

export function registerParserVariantPlugin(plugin: ParserVariantPlugin): void {
  const normalizedId = plugin.id.trim();
  if (!normalizedId) {
    throw new Error('Parser variant plugin ID must be a non-empty string.');
  }
  const normalizedLabel = plugin.label.trim();
  if (!normalizedLabel) {
    throw new Error(`Parser variant plugin "${normalizedId}" must have a non-empty label.`);
  }
  const validatedRules: ScreenActionRule[] = [];
  for (const rule of plugin.defaultScreenActionRules) {
    const normalized = normalizeScreenActionRule(rule);
    if (!normalized) {
      throw new Error(
        `Invalid defaultScreenActionRule in plugin "${normalizedId}": actionName must be non-empty and actionKind must be "jump" or "call". Got: ${JSON.stringify(rule)}`,
      );
    }
    validatedRules.push(normalized);
  }
  parserVariantPluginMap.set(normalizedId, {
    ...plugin,
    id: normalizedId,
    label: normalizedLabel,
    defaultScreenActionRules: validatedRules,
  });
}

export function normalizeScreenActionRule(rule: ScreenActionRule): ScreenActionRule | null {
  const actionName = rule.actionName.trim();
  if (!actionName) return null;
  if (rule.actionKind !== 'jump' && rule.actionKind !== 'call') return null;
  return { actionName, actionKind: rule.actionKind };
}

export function getParserVariantPlugin(variant: ParserVariant | undefined): ParserVariantPlugin {
  const selected = parserVariantPluginMap.get(variant ?? '');
  if (selected) return selected;
  const defaultPlugin = parserVariantPluginMap.get(DEFAULT_PARSER_VARIANT);
  if (!defaultPlugin) {
    throw new Error(`Default parser variant "${DEFAULT_PARSER_VARIANT}" is not registered.`);
  }
  return defaultPlugin;
}

export function isParserVariant(value: unknown): value is ParserVariant {
  return typeof value === 'string' && parserVariantPluginMap.has(value);
}

export function getPredefinedScreenActionRules(variant: ParserVariant): ScreenActionRule[] {
  return [...getParserVariantPlugin(variant).defaultScreenActionRules];
}

export function mergeScreenActionRules(
  variant: ParserVariant,
  customRules: ScreenActionRule[] | undefined,
): ScreenActionRule[] {
  const plugin = getParserVariantPlugin(variant);
  const normalizeRule = plugin.normalizeCustomRule ?? normalizeScreenActionRule;
  const merged = new Map<string, ScreenActionRule>();
  for (const rule of plugin.defaultScreenActionRules) {
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
  const effectiveVariant = getParserVariantPlugin(variant).id;
  const ruleMap = new Map<string, ScreenActionKind>();
  for (const rule of mergeScreenActionRules(effectiveVariant, customRules)) {
    ruleMap.set(rule.actionName.toLowerCase(), rule.actionKind);
  }
  return ruleMap;
}
