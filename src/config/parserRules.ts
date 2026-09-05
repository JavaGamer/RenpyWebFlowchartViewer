const ST_PLACEHOLDER_REGEX = /^\s*placeholder(?:\s+wip)?\s*(?:#.*)?$/i;

export type ParserVariant = string;
export type ScreenActionKind =
  | "jump"
  | "call"
  | "show"
  | "hide"
  | "set_variable"
  | "toggle_variable"
  | "confirm"
  | "null_action"
  | "show_menu";

export interface ScreenActionRule {
  actionName: string;
  actionKind: ScreenActionKind;
}

export interface TerminalStatementRule {
  pattern: RegExp;
  isTerminalOutcome?: boolean;
  labelHasExplicitExit?: boolean;
}

export interface ParserVariantPlugin {
  id: string;
  label: string;
  description?: string;
  defaultScreenActionRules: ScreenActionRule[];
  stagingKeywords?: readonly string[];
  stagingRegex?: RegExp;
  terminalStatements?: readonly TerminalStatementRule[];
  detectionSignatures?: readonly RegExp[];
  normalizeCustomRule?: (rule: ScreenActionRule) => ScreenActionRule | null;
}

const RENPY_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  { actionName: "Jump", actionKind: "jump" },
  { actionName: "Call", actionKind: "call" },
  { actionName: "Show", actionKind: "show" },
  { actionName: "Hide", actionKind: "hide" },
  { actionName: "ShowMenu", actionKind: "show_menu" },
  { actionName: "SetVariable", actionKind: "set_variable" },
  { actionName: "ToggleVariable", actionKind: "toggle_variable" },
  { actionName: "Confirm", actionKind: "confirm" },
  { actionName: "NullAction", actionKind: "null_action" },
];

const ST_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  { actionName: "timedchoice", actionKind: "call" },
  { actionName: "gameover", actionKind: "jump" },
  { actionName: "title", actionKind: "jump" },
  { actionName: "placeholder", actionKind: "jump" },
  { actionName: "routename", actionKind: "jump" },
];

export const BUILTIN_PARSER_VARIANT_PLUGINS: readonly ParserVariantPlugin[] = [
  {
    id: "renpy",
    label: "Ren'Py",
    description: "Standard Ren'Py statement and screen-action flow handling.",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
  },
  {
    id: "st",
    label: "ST",
    description:
      "Extended variant with timed choices, placeholder WIP endpoints, and custom staging directives.",
    defaultScreenActionRules: [
      ...RENPY_DEFAULT_SCREEN_ACTION_RULES,
      ...ST_DEFAULT_SCREEN_ACTION_RULES,
    ],
    stagingKeywords: [
      "swap",
      "morph",
      "clone",
      "body",
      "exspirit",
      "possess",
      "scry",
    ],
    stagingRegex:
      /^(?:swap|morph|clone|body|exspirit|possess|scry)\s+[A-Za-z_]/i,
    terminalStatements: [
      {
        pattern: ST_PLACEHOLDER_REGEX,
        isTerminalOutcome: true,
        labelHasExplicitExit: true,
      },
    ],
    detectionSignatures: [
      /^\s*(?:\$\s*)?timedchoice\b/im,
      new RegExp(ST_PLACEHOLDER_REGEX.source, "im"),
      /^\s*(?:swap|morph|clone|body|exspirit|possess|scry)\s+[A-Za-z_][A-Za-z0-9_]*/im,
    ],
  },
] as const;

export const AUTO_PARSER_VARIANT = "auto" as const;
export const FALLBACK_PARSER_VARIANT = "renpy" as const;
export const DEFAULT_PARSER_VARIANT = AUTO_PARSER_VARIANT;

const parserVariantPluginMap = new Map<string, ParserVariantPlugin>(
  BUILTIN_PARSER_VARIANT_PLUGINS.map((plugin) => [plugin.id, plugin] as const),
);

export function getParserVariantPlugins(): ParserVariantPlugin[] {
  return Array.from(parserVariantPluginMap.values());
}

export function getParserVariants(): string[] {
  return getParserVariantPlugins().map((plugin) => plugin.id);
}

export function registerParserVariantPlugin(plugin: ParserVariantPlugin): void {
  const normalizedId = plugin.id.trim();
  if (!normalizedId) {
    throw new Error("Parser variant plugin ID must be a non-empty string.");
  }
  const normalizedLabel = plugin.label.trim();
  if (!normalizedLabel) {
    throw new Error(
      `Parser variant plugin "${normalizedId}" must have a non-empty label.`,
    );
  }
  const validatedRules: ScreenActionRule[] = [];
  for (const rule of plugin.defaultScreenActionRules) {
    const normalized = normalizeScreenActionRule(rule);
    if (!normalized) {
      throw new Error(
        `Invalid defaultScreenActionRule in plugin "${normalizedId}": actionName must be non-empty and actionKind must be valid. Got: ${
          JSON.stringify(rule)
        }`,
      );
    }
    validatedRules.push(normalized);
  }

  const stagingKeywords = plugin.stagingKeywords
    ? [...plugin.stagingKeywords]
    : undefined;
  const stagingRegex = plugin.stagingRegex ?? (
    stagingKeywords && stagingKeywords.length > 0
      ? new RegExp(`^(?:${stagingKeywords.join("|")})\\s+[A-Za-z_]`, "i")
      : undefined
  );

  parserVariantPluginMap.set(normalizedId, {
    ...plugin,
    id: normalizedId,
    label: normalizedLabel,
    description: (plugin.description ?? "").trim(),
    defaultScreenActionRules: validatedRules,
    stagingKeywords,
    stagingRegex,
    terminalStatements: plugin.terminalStatements
      ? [...plugin.terminalStatements]
      : undefined,
    detectionSignatures: plugin.detectionSignatures
      ? [...plugin.detectionSignatures]
      : undefined,
  });
}

export const VALID_SCREEN_ACTION_KINDS = new Set<ScreenActionKind>([
  "jump",
  "call",
  "show",
  "hide",
  "set_variable",
  "toggle_variable",
  "confirm",
  "null_action",
  "show_menu",
]);

export function normalizeScreenActionRule(
  rule: ScreenActionRule,
): ScreenActionRule | null {
  const actionName = rule.actionName.trim();
  if (!actionName) return null;
  if (!VALID_SCREEN_ACTION_KINDS.has(rule.actionKind)) return null;
  return { actionName, actionKind: rule.actionKind };
}

export function getParserVariantPlugin(
  variant: ParserVariant | undefined,
): ParserVariantPlugin {
  const selected = parserVariantPluginMap.get(variant ?? "");
  if (selected) return selected;
  const defaultPlugin = parserVariantPluginMap.get(FALLBACK_PARSER_VARIANT);
  if (!defaultPlugin) {
    throw new Error(
      `Default parser variant "${FALLBACK_PARSER_VARIANT}" is not registered.`,
    );
  }
  return defaultPlugin;
}

export function isParserVariant(value: unknown): value is ParserVariant {
  return typeof value === "string" &&
    (value === AUTO_PARSER_VARIANT || parserVariantPluginMap.has(value));
}

export function getPredefinedScreenActionRules(
  variant: ParserVariant,
): ScreenActionRule[] {
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

export type RulesByVariant = Record<string, ScreenActionRule[]>;

export function resolveCustomRulesForVariant(
  variant: string,
  customRulesByVariant: RulesByVariant | undefined,
): ScreenActionRule[] {
  if (!customRulesByVariant) return [];
  const variantRules = customRulesByVariant[variant] ?? [];
  const autoRules = customRulesByVariant[AUTO_PARSER_VARIANT] ?? [];
  if (variant === AUTO_PARSER_VARIANT) {
    return [...autoRules];
  }
  const merged = new Map<string, ScreenActionRule>();
  for (const r of autoRules) {
    merged.set(r.actionName.toLowerCase(), r);
  }
  for (const r of variantRules) {
    merged.set(r.actionName.toLowerCase(), r);
  }
  return Array.from(merged.values());
}

export interface VariantDetectionResult {
  variant: string;
  matchedSignature?: string;
}

export function detectParserVariant(
  contents: Iterable<string>,
  fallbackVariant: string = FALLBACK_PARSER_VARIANT,
): VariantDetectionResult {
  const plugins = getParserVariantPlugins();
  const candidatePlugins = plugins.filter(
    (p) =>
      p.id !== fallbackVariant &&
      p.detectionSignatures &&
      p.detectionSignatures.length > 0,
  );

  for (const text of contents) {
    if (!text) continue;
    for (const plugin of candidatePlugins) {
      for (const sig of plugin.detectionSignatures!) {
        sig.lastIndex = 0;
        if (sig.test(text)) {
          return { variant: plugin.id, matchedSignature: sig.source };
        }
      }
    }
  }

  return { variant: fallbackVariant };
}
