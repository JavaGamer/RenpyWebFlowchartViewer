const ST_PLACEHOLDER_REGEX = /^\s*placeholder(?:\s+wip)?\s*(?:#.*)?$/i;
const DDLC_TERMINAL_REGEX =
  /^\s*(?:call\s+(?:endgame|gameover)|\$\s*delete_character\b)/i;

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

export interface SerializableTerminalStatementRule {
  pattern: string;
  isTerminalOutcome?: boolean;
  labelHasExplicitExit?: boolean;
}

export interface BranchStatementRule {
  pattern: RegExp;
  branchKind: "jump" | "call";
  targetGroup?: number;
  suppressFallthrough?: boolean;
}

export interface SerializableBranchStatementRule {
  pattern: string;
  branchKind: "jump" | "call";
  targetGroup?: number;
  suppressFallthrough?: boolean;
}

export interface ParserVariantPlugin {
  id: string;
  label: string;
  description?: string;
  isCustom?: boolean;
  baseVariant?: string;
  defaultScreenActionRules: ScreenActionRule[];
  stagingKeywords?: readonly string[];
  stagingRegex?: RegExp;
  terminalStatements?: readonly TerminalStatementRule[];
  branchStatements?: readonly BranchStatementRule[];
  detectionSignatures?: readonly RegExp[];
  normalizeCustomRule?: (rule: ScreenActionRule) => ScreenActionRule | null;
}

export interface SerializableParserVariantPlugin {
  id: string;
  label: string;
  description?: string;
  isCustom?: boolean;
  baseVariant?: string;
  defaultScreenActionRules: ScreenActionRule[];
  stagingKeywords?: string[];
  stagingRegex?: string;
  terminalStatements?: SerializableTerminalStatementRule[];
  branchStatements?: SerializableBranchStatementRule[];
  detectionSignatures?: string[];
}

export interface CustomVariantDefinition {
  id: string;
  label: string;
  description?: string;
  baseVariant?: string;
  screenActionRules?: ScreenActionRule[];
  stagingKeywords?: string[];
  terminalPatterns?: string[];
  detectionPatterns?: string[];
  branchStatements?: SerializableBranchStatementRule[];
}

export const RESERVED_VARIANT_IDS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "tostring",
  "valueof",
  "auto",
  "renpy",
  "renpy8",
  "st",
  "ddlc",
]);

export function validateSafeRegexPattern(
  patternStr: string,
  flags = "i",
): RegExp {
  const trimmed = patternStr.trim();
  if (!trimmed) {
    throw new Error("Regex pattern must not be empty.");
  }
  if (trimmed.length > 300) {
    throw new Error(
      `Regex pattern exceeds maximum length of 300 characters (${trimmed.length}).`,
    );
  }
  // Check for nested quantifiers (e.g. (a+)+, (\w*)*, (a{1,})+) which cause exponential ReDoS
  if (
    /\([^)]*(?:[*+]|\{\d+,?\d*\})\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/.test(trimmed)
  ) {
    throw new Error(
      `Regex pattern "${trimmed}" contains nested quantifiers, which may cause catastrophic backtracking.`,
    );
  }
  // Check for identical or overlapping alternations with outer quantifiers e.g. (a|a)+
  if (/\(([a-zA-Z0-9_]+)\|\1\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/.test(trimmed)) {
    throw new Error(
      `Regex pattern "${trimmed}" contains overlapping alternations with quantifiers, which may cause catastrophic backtracking.`,
    );
  }
  // Strip stateful /g and /y flags
  const safeFlags = flags.replace(/[gy]/g, "");
  let regex: RegExp;
  try {
    regex = new RegExp(trimmed, safeFlags);
  } catch (err) {
    throw new Error(
      `Invalid regular expression "${trimmed}": ${(err as Error).message}`,
      { cause: err },
    );
  }
  if (regex.test("")) {
    throw new Error(
      `Regex pattern "${trimmed}" must not match an empty string.`,
    );
  }
  if (regex.test("   ")) {
    throw new Error(
      `Regex pattern "${trimmed}" must not match pure whitespace.`,
    );
  }

  // Runtime benchmark probe against common mismatch strings to detect exponential/high-polynomial backtracking
  const probeStrings = [
    "a".repeat(25) + "!",
    " ".repeat(25) + "!",
    "0".repeat(25) + "!",
    "a".repeat(12) + "\n" + "b".repeat(12) + "!",
  ];
  for (const probe of probeStrings) {
    const start = typeof performance !== "undefined"
      ? performance.now()
      : Date.now();
    regex.test(probe);
    const elapsed =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      start;
    if (elapsed > 10) {
      throw new Error(
        `Regex pattern "${trimmed}" exhibited excessive execution time on benchmark probe (${
          elapsed.toFixed(1)
        }ms).`,
      );
    }
  }

  return regex;
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

const RENPY8_EXTENDED_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  ...RENPY_DEFAULT_SCREEN_ACTION_RULES,
  { actionName: "Start", actionKind: "jump" },
  { actionName: "Replay", actionKind: "call" },
  { actionName: "EndReplay", actionKind: "jump" },
  { actionName: "MainMenu", actionKind: "jump" },
  { actionName: "ToggleScreen", actionKind: "show" },
  { actionName: "ShowTransient", actionKind: "show" },
  { actionName: "SetField", actionKind: "set_variable" },
  { actionName: "ToggleField", actionKind: "toggle_variable" },
  { actionName: "SetDict", actionKind: "set_variable" },
  { actionName: "ToggleDict", actionKind: "toggle_variable" },
  { actionName: "SetScreenVariable", actionKind: "set_variable" },
  { actionName: "ToggleScreenVariable", actionKind: "toggle_variable" },
  { actionName: "SetLocalVariable", actionKind: "set_variable" },
  { actionName: "ToggleLocalVariable", actionKind: "toggle_variable" },
];

const ST_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  { actionName: "timedchoice", actionKind: "call" },
  { actionName: "gameover", actionKind: "jump" },
  { actionName: "title", actionKind: "jump" },
  { actionName: "placeholder", actionKind: "jump" },
  { actionName: "routename", actionKind: "jump" },
];

const DDLC_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  ...RENPY_DEFAULT_SCREEN_ACTION_RULES,
  { actionName: "MainMenu", actionKind: "jump" },
  { actionName: "Quit", actionKind: "null_action" },
  { actionName: "Start", actionKind: "jump" },
  { actionName: "showpoem", actionKind: "call" },
  { actionName: "poemgame", actionKind: "call" },
];

export const BUILTIN_PARSER_VARIANT_PLUGINS: readonly ParserVariantPlugin[] = [
  {
    id: "renpy",
    label: "Ren'Py",
    description: "Standard Ren'Py statement and screen-action flow handling.",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
  },
  {
    id: "renpy8",
    label: "Ren'Py 8.x",
    description:
      "Modern Ren'Py 8.x syntax with Python 3 statements, match/case branching, layered images, and extended screen actions.",
    defaultScreenActionRules: [...RENPY8_EXTENDED_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "camera",
      "matrixcolor",
      "gl_color",
      "transform",
      "layeredimage",
      "pause",
      "window",
      "frame",
      "voice",
    ],
    stagingRegex:
      /^(?:camera|matrixcolor|gl_color|transform|layeredimage|pause|window|frame|voice)\s+[A-Za-z_]/i,
    detectionSignatures: [
      /^\s*match\s+[A-Za-z0-9_().]+(?:\s+as\s+[A-Za-z0-9_]+)?\s*:/m,
      /renpy\.version_tuple\s*(?:>=|==|>)\s*\(\s*8\b/,
      /config\.renpy_version\s*=\s*['"]8\./,
      /^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*:[^)]*\)\s*->\s*[A-Za-z_]:/m,
    ],
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
  {
    id: "ddlc",
    label: "DDLC / DDLC Mods",
    description:
      "Doki Doki Literature Club and DDLC modding framework syntax, poem mini-game calls, console manipulation, and glitch staging.",
    defaultScreenActionRules: [...DDLC_DEFAULT_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "updateconsole",
      "hideconsole",
      "tear",
      "noise",
      "vignette",
      "wipe",
      "s_kill",
      "y_kill",
      "glitch",
    ],
    stagingRegex:
      /^(?:updateconsole|hideconsole|tear|noise|vignette|wipe|s_kill|y_kill|glitch)\b/i,
    terminalStatements: [
      {
        pattern: DDLC_TERMINAL_REGEX,
        isTerminalOutcome: true,
        labelHasExplicitExit: true,
      },
    ],
    detectionSignatures: [
      /^\s*(?:default|define|\$)\s+persistent\.playthrough\b/im,
      /^\s*define\s+audio\.t1\s*=/im,
      /^\s*call\s+updateconsole\b/im,
      /^\s*(?:call\s+poemgame\b|\$\s*mas_wordlist\b|\bMASPoemWordList\b)/im,
      /^\s*\$\s*delete_character\s*\(/im,
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
  if (!/^[a-z0-9_-]{1,64}$/.test(normalizedId)) {
    throw new Error(
      `Parser variant plugin ID "${normalizedId}" must contain only lowercase letters, numbers, hyphens, and underscores (max 64 chars).`,
    );
  }
  if (
    normalizedId === "__proto__" ||
    normalizedId === "prototype" ||
    normalizedId === "constructor" ||
    normalizedId === "tostring" ||
    normalizedId === "valueof" ||
    (plugin.isCustom && RESERVED_VARIANT_IDS.has(normalizedId.toLowerCase()))
  ) {
    throw new Error(
      `Cannot register custom variant with reserved or built-in ID "${normalizedId}".`,
    );
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
      ? new RegExp(
        `^(?:${
          stagingKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")
        })\\b`,
      )
      : undefined
  );

  const validatedBranchStatements = plugin.branchStatements
    ? plugin.branchStatements.map((b) => ({
      ...b,
      pattern: typeof b.pattern === "string"
        ? validateSafeRegexPattern(b.pattern)
        : (validateSafeRegexPattern(b.pattern.source), b.pattern),
    }))
    : undefined;

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
    branchStatements: validatedBranchStatements,
    detectionSignatures: plugin.detectionSignatures
      ? [...plugin.detectionSignatures]
      : undefined,
  });
}

export function unregisterParserVariantPlugin(id: string): boolean {
  if (BUILTIN_PARSER_VARIANT_PLUGINS.some((p) => p.id === id)) {
    return false; // cannot delete builtin plugins
  }
  return parserVariantPluginMap.delete(id);
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

export function serializeVariantPlugin(
  plugin: ParserVariantPlugin,
): SerializableParserVariantPlugin {
  return {
    id: plugin.id,
    label: plugin.label,
    description: plugin.description,
    isCustom: plugin.isCustom,
    baseVariant: plugin.baseVariant,
    defaultScreenActionRules: [...plugin.defaultScreenActionRules],
    stagingKeywords: plugin.stagingKeywords
      ? [...plugin.stagingKeywords]
      : undefined,
    stagingRegex: plugin.stagingRegex?.source,
    terminalStatements: plugin.terminalStatements?.map((t) => ({
      pattern: t.pattern.source,
      isTerminalOutcome: t.isTerminalOutcome,
      labelHasExplicitExit: t.labelHasExplicitExit,
    })),
    branchStatements: plugin.branchStatements?.map((b) => ({
      pattern: b.pattern.source,
      branchKind: b.branchKind,
      targetGroup: b.targetGroup,
      suppressFallthrough: b.suppressFallthrough,
    })),
    detectionSignatures: plugin.detectionSignatures?.map((s) => s.source),
  };
}

export function deserializeVariantPlugin(
  serializable: SerializableParserVariantPlugin,
): ParserVariantPlugin {
  return {
    id: serializable.id,
    label: serializable.label,
    description: serializable.description,
    isCustom: serializable.isCustom,
    baseVariant: serializable.baseVariant,
    defaultScreenActionRules: serializable.defaultScreenActionRules,
    stagingKeywords: serializable.stagingKeywords,
    stagingRegex: serializable.stagingRegex
      ? validateSafeRegexPattern(serializable.stagingRegex, "i")
      : undefined,
    terminalStatements: serializable.terminalStatements?.map((t) => ({
      pattern: validateSafeRegexPattern(t.pattern, "i"),
      isTerminalOutcome: t.isTerminalOutcome,
      labelHasExplicitExit: t.labelHasExplicitExit,
    })),
    branchStatements: serializable.branchStatements?.map((b) => ({
      pattern: validateSafeRegexPattern(b.pattern, "i"),
      branchKind: b.branchKind,
      targetGroup: b.targetGroup,
      suppressFallthrough: b.suppressFallthrough,
    })),
    detectionSignatures: serializable.detectionSignatures?.map(
      (s) => validateSafeRegexPattern(s, "im"),
    ),
  };
}

export function compileCustomVariant(
  def: CustomVariantDefinition,
): ParserVariantPlugin {
  const base = getParserVariantPlugin(
    def.baseVariant ?? FALLBACK_PARSER_VARIANT,
  );
  const stagingKeywords = def.stagingKeywords && def.stagingKeywords.length > 0
    ? Array.from(
      new Set([...(base.stagingKeywords ?? []), ...def.stagingKeywords]),
    )
    : base.stagingKeywords
    ? [...base.stagingKeywords]
    : undefined;

  const terminalStatements: TerminalStatementRule[] = [
    ...(base.terminalStatements ?? []),
  ];
  for (const patStr of def.terminalPatterns ?? []) {
    terminalStatements.push({
      pattern: validateSafeRegexPattern(patStr, "i"),
      isTerminalOutcome: true,
      labelHasExplicitExit: true,
    });
  }

  const branchStatements: BranchStatementRule[] = [
    ...(base.branchStatements ?? []),
  ];
  for (const b of def.branchStatements ?? []) {
    branchStatements.push({
      pattern: validateSafeRegexPattern(b.pattern, "i"),
      branchKind: b.branchKind,
      targetGroup: b.targetGroup,
      suppressFallthrough: b.suppressFallthrough,
    });
  }

  const detectionSignatures: RegExp[] = [
    ...(base.detectionSignatures ?? []),
  ];
  for (const det of def.detectionPatterns ?? []) {
    detectionSignatures.push(validateSafeRegexPattern(det, "im"));
  }

  const defaultScreenActionRules: ScreenActionRule[] = [
    ...base.defaultScreenActionRules,
  ];
  if (def.screenActionRules) {
    const existingNames = new Set(
      defaultScreenActionRules.map((r) => r.actionName.toLowerCase()),
    );
    for (const rule of def.screenActionRules) {
      const norm = normalizeScreenActionRule(rule);
      if (!norm) continue;
      if (!existingNames.has(norm.actionName.toLowerCase())) {
        defaultScreenActionRules.push(norm);
        existingNames.add(norm.actionName.toLowerCase());
      }
    }
  }

  return {
    id: def.id.trim(),
    label: def.label.trim(),
    description: (def.description ?? "").trim(),
    isCustom: true,
    baseVariant: def.baseVariant ?? base.id,
    defaultScreenActionRules,
    stagingKeywords,
    stagingRegex: stagingKeywords && stagingKeywords.length > 0
      ? new RegExp(`^(?:${stagingKeywords.join("|")})\\s+[A-Za-z_]`, "i")
      : undefined,
    terminalStatements,
    branchStatements,
    detectionSignatures,
  };
}
