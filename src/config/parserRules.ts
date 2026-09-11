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

export type EndingType =
  | "good"
  | "bad"
  | "true"
  | "normal"
  | "dead_end"
  | "custom";

export type VariableValue = string | boolean | number | null;

export type MutationOperator =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "//=";

export interface ChoiceDirectiveRule {
  pattern: RegExp;
  targetGroup: number;
  captionGroup?: number;
  durationGroup?: number;
  isTimeout?: boolean;
}

export interface SerializableChoiceDirectiveRule {
  pattern: string;
  targetGroup: number;
  captionGroup?: number;
  durationGroup?: number;
  isTimeout?: boolean;
}

export interface VariableMutationRule {
  pattern: RegExp;
  variableGroup?: number;
  valueGroup?: number;
  operator?: MutationOperator;
  constantValue?: VariableValue;
  variableName?: string;
}

export interface SerializableVariableMutationRule {
  pattern: string;
  variableGroup?: number;
  valueGroup?: number;
  operator?: MutationOperator;
  constantValue?: VariableValue;
  variableName?: string;
}

export interface EndingClassificationRule {
  pattern: RegExp;
  endingType: EndingType;
}

export interface SerializableEndingClassificationRule {
  pattern: string;
  endingType: EndingType;
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
  choiceDirectives?: readonly ChoiceDirectiveRule[];
  variableMutations?: readonly VariableMutationRule[];
  endingRules?: readonly EndingClassificationRule[];
  utilityLabelPatterns?: readonly RegExp[];
  detectionSignatures?: readonly RegExp[];
  detectionFilePatterns?: readonly RegExp[];
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
  choiceDirectives?: SerializableChoiceDirectiveRule[];
  variableMutations?: SerializableVariableMutationRule[];
  endingRules?: SerializableEndingClassificationRule[];
  utilityLabelPatterns?: string[];
  detectionSignatures?: string[];
  detectionFilePatterns?: string[];
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
  choiceDirectives?: SerializableChoiceDirectiveRule[];
  variableMutations?: SerializableVariableMutationRule[];
  endingRules?: SerializableEndingClassificationRule[];
  utilityLabelPatterns?: string[];
  detectionFilePatterns?: string[];
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
  "mas",
  "renpy7",
  "nvl",
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
  // Check for quantified alternation groups with internal quantifiers e.g. (a+|b+)+
  if (
    /\((?:[^)|]*[*+][^)|]*\|)+[^)]*\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/.test(trimmed)
  ) {
    throw new Error(
      `Regex pattern "${trimmed}" contains quantified alternation branches with outer repetition, which causes catastrophic backtracking.`,
    );
  }
  // Check for identical or overlapping alternations with outer quantifiers e.g. (a|a)+, ([a-z]|\w)+, (x|[w-z])+
  if (
    /\(([a-zA-Z0-9_]+)\|\1\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/.test(trimmed) ||
    /\((?:\\w|\\d|\[[^\]]+\]|[a-zA-Z0-9_])\|(?:\\w|\\d|\[[^\]]+\]|[a-zA-Z0-9_])\)(?:\s*(?:[*+]|\{\d+,?\d*\}))/i
      .test(trimmed)
  ) {
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

  // Runtime benchmark probe against common and pattern-derived mismatch strings to detect exponential/high-polynomial backtracking
  const probeChars = new Set<string>(["a", " ", "0", "b", "x", "1", "_"]);
  const patternLiterals = trimmed.match(/[a-zA-Z0-9_]/g);
  if (patternLiterals) {
    for (const ch of patternLiterals.slice(0, 10)) {
      probeChars.add(ch);
    }
  }

  const probeStrings: string[] = [];
  for (const ch of probeChars) {
    probeStrings.push(ch.repeat(26) + "!");
    probeStrings.push(ch.repeat(13) + "\n" + ch.repeat(13) + "!");
  }

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
    detectionFilePatterns: [
      /\bscript-ch[0-9]+\.rpy$/i,
      /\bscript-ex[0-9]+\.rpy$/i,
    ],
  },
  {
    id: "mas",
    label: "Monika After Story",
    description:
      "Monika After Story framework with affection tracking, event topics, poem minigame, and custom MAS directives.",
    baseVariant: "ddlc",
    defaultScreenActionRules: [
      ...DDLC_DEFAULT_SCREEN_ACTION_RULES,
      { actionName: "mas_show_poem", actionKind: "call" },
      { actionName: "mas_display_ver", actionKind: "show" },
      { actionName: "mas_open_url", actionKind: "null_action" },
      { actionName: "mas_dialogue", actionKind: "call" },
    ],
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
      "m_talk",
      "m_idle",
      "mas_reaction",
      "mas_mood",
      "mas_drop_mood",
    ],
    stagingRegex:
      /^(?:updateconsole|hideconsole|tear|noise|vignette|wipe|s_kill|y_kill|glitch|m_talk|m_idle|mas_reaction|mas_mood|mas_drop_mood)\b/i,
    terminalStatements: [
      {
        pattern: DDLC_TERMINAL_REGEX,
        isTerminalOutcome: true,
        labelHasExplicitExit: true,
      },
    ],
    utilityLabelPatterns: [
      /^_mas_/i,
      /^mas_idle_/i,
      /^mas_topic_/i,
      /^mas_o31_/i,
    ],
    variableMutations: [
      {
        pattern: /^\s*\$\s*mas_gainAffection\(\s*([0-9.-]+)\s*\)/i,
        variableName: "mas_affection",
        valueGroup: 1,
        operator: "+=",
        constantValue: 1,
      },
      {
        pattern: /^\s*\$\s*mas_loseAffection\(\s*([0-9.-]+)\s*\)/i,
        variableName: "mas_affection",
        valueGroup: 1,
        operator: "-=",
        constantValue: 1,
      },
    ],
    detectionSignatures: [
      /\bMASPoemWordList\b/i,
      /mas_register_submod\b/i,
      /init\s+5\s+python\s+in\s+mas_/i,
      /\$\s*mas_display_ver\b/i,
      /define\s+mas_affection\b/i,
    ],
    detectionFilePatterns: [
      /\bmas_[A-Za-z0-9_-]+\.rpy$/i,
      /\bsubmods\/.*\.rpy$/i,
    ],
  },
  {
    id: "renpy7",
    label: "Ren'Py 7.x Legacy",
    description:
      "Legacy Ren'Py 7 syntax with Python 2 runtime conventions and Screen Language 1 compatibility.",
    baseVariant: "renpy",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "camera",
      "show",
      "hide",
      "pause",
      "window",
      "frame",
      "with",
      "nvl",
    ],
    stagingRegex:
      /^(?:camera|show|hide|pause|window|frame|with|nvl)\s+[A-Za-z_]/i,
    detectionSignatures: [
      /config\.renpy_version\s*=\s*['"]7\./i,
      /renpy\.version_tuple\s*(?:>=|==|>)\s*\(\s*7\b/i,
      /^\s*init\s+-?[0-9]*\s*python\s*:/m,
    ],
  },
  {
    id: "nvl",
    label: "NVL / Kinetic Novel",
    description:
      "NVL-mode and linear kinetic visual novels with nvl clear/show staging and chapter-focused progression.",
    baseVariant: "renpy",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "nvl",
      "nvl_clear",
      "nvl_show",
      "nvl_window",
      "page",
      "p",
    ],
    stagingRegex: /^(?:nvl|nvl_clear|nvl_show|nvl_window|page|p)\b/i,
    detectionSignatures: [
      /define\s+[A-Za-z0-9_]+\s*=\s*Character\([^)]*kind\s*=\s*nvl/i,
      /^\s*nvl\s+clear\b/im,
      /^\s*nvl\s+show\b/im,
    ],
    detectionFilePatterns: [
      /\bscreens_nvl\.rpy$/i,
      /\bnvl_screens\.rpy$/i,
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

  const validatedChoiceDirectives = plugin.choiceDirectives
    ? plugin.choiceDirectives.map((c) => ({
      ...c,
      pattern: typeof c.pattern === "string"
        ? validateSafeRegexPattern(c.pattern)
        : (validateSafeRegexPattern(c.pattern.source), c.pattern),
    }))
    : undefined;

  const validatedVariableMutations = plugin.variableMutations
    ? plugin.variableMutations.map((v) => ({
      ...v,
      pattern: typeof v.pattern === "string"
        ? validateSafeRegexPattern(v.pattern)
        : (validateSafeRegexPattern(v.pattern.source), v.pattern),
    }))
    : undefined;

  const validatedEndingRules = plugin.endingRules
    ? plugin.endingRules.map((e) => ({
      ...e,
      pattern: typeof e.pattern === "string"
        ? validateSafeRegexPattern(e.pattern)
        : (validateSafeRegexPattern(e.pattern.source), e.pattern),
    }))
    : undefined;

  const validatedUtilityLabelPatterns = plugin.utilityLabelPatterns
    ? plugin.utilityLabelPatterns.map((u) =>
      typeof u === "string"
        ? validateSafeRegexPattern(u)
        : (validateSafeRegexPattern(u.source), u)
    )
    : undefined;

  const validatedDetectionFilePatterns = plugin.detectionFilePatterns
    ? plugin.detectionFilePatterns.map((f) =>
      typeof f === "string"
        ? validateSafeRegexPattern(f)
        : (validateSafeRegexPattern(f.source), f)
    )
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
    choiceDirectives: validatedChoiceDirectives,
    variableMutations: validatedVariableMutations,
    endingRules: validatedEndingRules,
    utilityLabelPatterns: validatedUtilityLabelPatterns,
    detectionSignatures: plugin.detectionSignatures
      ? [...plugin.detectionSignatures]
      : undefined,
    detectionFilePatterns: validatedDetectionFilePatterns,
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
  if (!customRulesByVariant || typeof customRulesByVariant !== "object") {
    return [];
  }
  const variantRules = Object.hasOwn(customRulesByVariant, variant) &&
      Array.isArray(customRulesByVariant[variant])
    ? customRulesByVariant[variant]!
    : [];
  const autoRules = Object.hasOwn(customRulesByVariant, AUTO_PARSER_VARIANT) &&
      Array.isArray(customRulesByVariant[AUTO_PARSER_VARIANT])
    ? customRulesByVariant[AUTO_PARSER_VARIANT]!
    : [];
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

export interface VariantDetectionEvidence {
  signature: string;
  matchCount: number;
  sampleLocations: string[];
  weight: number;
}

export interface VariantCandidateScore {
  variantId: string;
  label: string;
  score: number;
  confidencePercent: number;
  evidence: VariantDetectionEvidence[];
}

export interface VariantDetectionEvidenceSummary {
  matchedPragma?: string;
  matchedPathPatterns: string[];
  matchedKeywords: string[];
}

export interface VariantCandidateScoreItem {
  variant: string;
  label: string;
  score: number;
  confidence?: number;
}

export interface VariantDetectionResult {
  variant: string;
  isAutoDetected: boolean;
  confidencePercent: number;
  confidence: number;
  matchedSignature?: string;
  evidenceSummary?: string;
  summary: string;
  candidates?: VariantCandidateScore[];
  scores: VariantCandidateScoreItem[];
  evidence: VariantDetectionEvidenceSummary;
  pragmaOverride?: boolean;
}

export type DetectVariantInput =
  | string
  | {
    name?: string;
    path?: string;
    content?: string;
    contentSample?: string;
  };

export function detectParserVariant(
  contents: Iterable<DetectVariantInput>,
  fallbackVariant: string = FALLBACK_PARSER_VARIANT,
): VariantDetectionResult {
  const plugins = getParserVariantPlugins();
  const normalizedInputs: Array<{ name: string; path: string; text: string }> =
    [];

  for (const item of contents) {
    if (!item) continue;
    if (typeof item === "string") {
      normalizedInputs.push({ name: "", path: "", text: item });
    } else {
      const rawPath = item.path ?? item.name ?? "";
      const rawName = item.name ?? "";
      normalizedInputs.push({
        name: rawName.replace(/\\/g, "/"),
        path: rawPath.replace(/\\/g, "/"),
        text: item.content ?? item.contentSample ?? "",
      });
    }
  }

  // 1. Sniff for explicit script pragma in first 2000 chars of each file
  const pragmaGlobalRegex =
    /^\s*#\s*(?:@flowchart-variant|@variant|renpy-variant)\s*:\s*([a-z0-9_-]+)/gim;
  for (const file of normalizedInputs) {
    const headerSample = file.text.slice(0, 2000);
    let match: RegExpExecArray | null;
    while ((match = pragmaGlobalRegex.exec(headerSample)) !== null) {
      const pragmaId = match[1]!.toLowerCase().trim();
      if (isParserVariant(pragmaId) && pragmaId !== AUTO_PARSER_VARIANT) {
        const plugin = getParserVariantPlugin(pragmaId);
        return {
          variant: pragmaId,
          isAutoDetected: true,
          confidencePercent: 100,
          confidence: 100,
          pragmaOverride: true,
          matchedSignature: match[0],
          evidenceSummary: `Explicit pragma override locked via ${
            file.name || "script"
          }: ${match[0]}`,
          summary: `Explicit pragma override locked via ${
            file.name || "script"
          }: ${match[0]}`,
          candidates: [
            {
              variantId: pragmaId,
              label: plugin.label,
              score: 1000,
              confidencePercent: 100,
              evidence: [
                {
                  signature: match[0],
                  matchCount: 1,
                  sampleLocations: [file.name ? `${file.name}:1` : "script:1"],
                  weight: 1000,
                },
              ],
            },
          ],
          scores: [
            {
              variant: pragmaId,
              label: plugin.label,
              score: 1000,
              confidence: 100,
            },
          ],
          evidence: {
            matchedPragma: pragmaId,
            matchedPathPatterns: [],
            matchedKeywords: [match[0]],
          },
        };
      }
    }
  }

  // 2. Multi-signal weighted scoring across candidate plugins
  const candidatePlugins = plugins.filter(
    (p) =>
      p.id !== fallbackVariant &&
      ((p.detectionSignatures && p.detectionSignatures.length > 0) ||
        (p.detectionFilePatterns && p.detectionFilePatterns.length > 0)),
  );

  const scores = new Map<
    string,
    {
      plugin: ParserVariantPlugin;
      score: number;
      evidenceMap: Map<string, VariantDetectionEvidence>;
    }
  >();

  for (const p of candidatePlugins) {
    scores.set(p.id, {
      plugin: p,
      score: 0,
      evidenceMap: new Map(),
    });
  }

  for (const file of normalizedInputs) {
    const { name, path, text } = file;
    const fileLabel = name || path || "script.rpy";

    // Path / filename patterns
    if (name || path) {
      for (const p of candidatePlugins) {
        if (!p.detectionFilePatterns) continue;
        for (const pattern of p.detectionFilePatterns) {
          pattern.lastIndex = 0;
          if (pattern.test(name) || pattern.test(path)) {
            const entry = scores.get(p.id)!;
            entry.score += 8;
            const key = `path:${pattern.source}`;
            const existing = entry.evidenceMap.get(key);
            if (existing) {
              existing.matchCount += 1;
              if (existing.sampleLocations.length < 3) {
                existing.sampleLocations.push(fileLabel);
              }
            } else {
              entry.evidenceMap.set(key, {
                signature: `File pattern: ${pattern.source}`,
                matchCount: 1,
                sampleLocations: [fileLabel],
                weight: 8,
              });
            }
          }
        }
      }
    }

    if (!text) continue;

    const fileLines = text.split("\n");

    // Content regex signatures
    for (const p of candidatePlugins) {
      if (!p.detectionSignatures) continue;
      for (const sig of p.detectionSignatures) {
        sig.lastIndex = 0;
        let count = 0;
        if (sig.global) {
          count = (text.match(sig) || []).length;
          if (count > 0) {
            const entry = scores.get(p.id)!;
            const weight = sig.source.length > 25 ? 8 : 3;
            entry.score += weight * Math.min(count, 5);
            const key = `sig:${sig.source}`;
            let ev = entry.evidenceMap.get(key);
            if (!ev) {
              ev = {
                signature: sig.source,
                matchCount: count,
                sampleLocations: [fileLabel],
                weight,
              };
              entry.evidenceMap.set(key, ev);
            } else {
              ev.matchCount += count;
            }
          }
        } else {
          for (let lIdx = 0; lIdx < fileLines.length && count < 10; lIdx++) {
            sig.lastIndex = 0;
            if (sig.test(fileLines[lIdx]!)) {
              count++;
              const entry = scores.get(p.id)!;
              const key = `sig:${sig.source}`;
              let ev = entry.evidenceMap.get(key);
              if (!ev) {
                const weight = sig.source.length > 25 ? 8 : 3;
                ev = {
                  signature: sig.source,
                  matchCount: 0,
                  sampleLocations: [],
                  weight,
                };
                entry.evidenceMap.set(key, ev);
              }
              ev.matchCount++;
              if (ev.sampleLocations.length < 3) {
                ev.sampleLocations.push(`${fileLabel}:${lIdx + 1}`);
              }
            }
          }

          if (count > 0) {
            const entry = scores.get(p.id)!;
            const ev = entry.evidenceMap.get(`sig:${sig.source}`);
            if (ev) {
              entry.score += ev.weight * Math.min(count, 5);
            }
          }
        }
      }
    }
  }

  // 3. Score calculation and ranking
  const activeCandidates: VariantCandidateScore[] = [];
  for (const [id, entry] of scores.entries()) {
    if (entry.score > 0) {
      activeCandidates.push({
        variantId: id,
        label: entry.plugin.label,
        score: entry.score,
        confidencePercent: 0,
        evidence: Array.from(entry.evidenceMap.values()),
      });
    }
  }

  activeCandidates.sort((a, b) => b.score - a.score);

  if (activeCandidates.length === 0) {
    return {
      variant: fallbackVariant,
      isAutoDetected: true,
      confidencePercent: 0,
      confidence: 0,
      evidenceSummary:
        "Default fallback (no distinct variant signatures found)",
      summary: "Default fallback (no distinct variant signatures found)",
      candidates: [],
      scores: [],
      evidence: {
        matchedPragma: undefined,
        matchedPathPatterns: [],
        matchedKeywords: [],
      },
    };
  }

  const winner = activeCandidates[0]!;
  const runnerUp = activeCandidates[1];

  const confidence = !runnerUp
    ? (winner.score >= 15 ? 98 : (winner.score >= 6 ? 92 : 80))
    : Math.min(
      99,
      Math.max(
        50,
        Math.round(
          60 +
            39 *
              ((winner.score - runnerUp.score) /
                (winner.score + runnerUp.score + 2)),
        ),
      ),
    );

  winner.confidencePercent = confidence;

  const topEvidence = winner.evidence
    .slice(0, 3)
    .map((e) => `${e.signature} (${e.matchCount}x)`)
    .join(", ");

  const summary =
    `Auto-detected ${winner.label} (${confidence}% confidence, score ${winner.score})${
      topEvidence ? `: ${topEvidence}` : ""
    }`;

  return {
    variant: winner.variantId,
    isAutoDetected: true,
    confidencePercent: confidence,
    confidence,
    matchedSignature: winner.evidence[0]?.signature,
    evidenceSummary: summary,
    summary,
    candidates: activeCandidates,
    scores: activeCandidates.map((c) => ({
      variant: c.variantId,
      label: c.label,
      score: c.score,
      confidence: c.confidencePercent,
    })),
    evidence: {
      matchedPragma: undefined,
      matchedPathPatterns: winner.evidence
        .filter((e) => e.signature.startsWith("File pattern:"))
        .map((e) => e.signature),
      matchedKeywords: winner.evidence
        .filter((e) => !e.signature.startsWith("File pattern:"))
        .map((e) => e.signature),
    },
  };
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
    choiceDirectives: plugin.choiceDirectives?.map((c) => ({
      pattern: c.pattern.source,
      targetGroup: c.targetGroup,
      captionGroup: c.captionGroup,
      durationGroup: c.durationGroup,
      isTimeout: c.isTimeout,
    })),
    variableMutations: plugin.variableMutations?.map((v) => ({
      pattern: v.pattern.source,
      variableGroup: v.variableGroup,
      valueGroup: v.valueGroup,
      operator: v.operator,
      constantValue: v.constantValue,
      variableName: v.variableName,
    })),
    endingRules: plugin.endingRules?.map((e) => ({
      pattern: e.pattern.source,
      endingType: e.endingType,
    })),
    utilityLabelPatterns: plugin.utilityLabelPatterns?.map((u) => u.source),
    detectionSignatures: plugin.detectionSignatures?.map((s) => s.source),
    detectionFilePatterns: plugin.detectionFilePatterns?.map((f) => f.source),
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
    choiceDirectives: serializable.choiceDirectives?.map((c) => ({
      pattern: validateSafeRegexPattern(c.pattern, "i"),
      targetGroup: c.targetGroup,
      captionGroup: c.captionGroup,
      durationGroup: c.durationGroup,
      isTimeout: c.isTimeout,
    })),
    variableMutations: serializable.variableMutations?.map((v) => ({
      pattern: validateSafeRegexPattern(v.pattern, "i"),
      variableGroup: v.variableGroup,
      valueGroup: v.valueGroup,
      operator: v.operator,
      constantValue: v.constantValue,
      variableName: v.variableName,
    })),
    endingRules: serializable.endingRules?.map((e) => ({
      pattern: validateSafeRegexPattern(e.pattern, "i"),
      endingType: e.endingType,
    })),
    utilityLabelPatterns: serializable.utilityLabelPatterns?.map((u) =>
      validateSafeRegexPattern(u, "i")
    ),
    detectionSignatures: serializable.detectionSignatures?.map(
      (s) => validateSafeRegexPattern(s, "im"),
    ),
    detectionFilePatterns: serializable.detectionFilePatterns?.map((f) =>
      validateSafeRegexPattern(f, "i")
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

  const choiceDirectives: ChoiceDirectiveRule[] = [
    ...(base.choiceDirectives ?? []),
  ];
  for (const c of def.choiceDirectives ?? []) {
    choiceDirectives.push({
      pattern: validateSafeRegexPattern(c.pattern, "i"),
      targetGroup: c.targetGroup,
      captionGroup: c.captionGroup,
      durationGroup: c.durationGroup,
      isTimeout: c.isTimeout,
    });
  }

  const variableMutations: VariableMutationRule[] = [
    ...(base.variableMutations ?? []),
  ];
  for (const v of def.variableMutations ?? []) {
    variableMutations.push({
      pattern: validateSafeRegexPattern(v.pattern, "i"),
      variableGroup: v.variableGroup,
      valueGroup: v.valueGroup,
      operator: v.operator,
      constantValue: v.constantValue,
      variableName: v.variableName,
    });
  }

  const endingRules: EndingClassificationRule[] = [
    ...(base.endingRules ?? []),
  ];
  for (const e of def.endingRules ?? []) {
    endingRules.push({
      pattern: validateSafeRegexPattern(e.pattern, "i"),
      endingType: e.endingType,
    });
  }

  const utilityLabelPatterns: RegExp[] = [
    ...(base.utilityLabelPatterns ?? []),
  ];
  for (const u of def.utilityLabelPatterns ?? []) {
    utilityLabelPatterns.push(validateSafeRegexPattern(u, "i"));
  }

  const detectionSignatures: RegExp[] = [
    ...(base.detectionSignatures ?? []),
  ];
  for (const det of def.detectionPatterns ?? []) {
    detectionSignatures.push(validateSafeRegexPattern(det, "im"));
  }

  const detectionFilePatterns: RegExp[] = [
    ...(base.detectionFilePatterns ?? []),
  ];
  for (const f of def.detectionFilePatterns ?? []) {
    detectionFilePatterns.push(validateSafeRegexPattern(f, "i"));
  }

  const ruleMap = new Map<string, ScreenActionRule>();
  for (const r of base.defaultScreenActionRules) {
    ruleMap.set(r.actionName.toLowerCase(), r);
  }
  if (def.screenActionRules) {
    for (const rule of def.screenActionRules) {
      const norm = normalizeScreenActionRule(rule);
      if (!norm) continue;
      ruleMap.set(norm.actionName.toLowerCase(), norm);
    }
  }
  const defaultScreenActionRules = Array.from(ruleMap.values());

  return {
    id: def.id.trim(),
    label: def.label.trim(),
    description: (def.description ?? "").trim(),
    isCustom: true,
    baseVariant: def.baseVariant ?? base.id,
    defaultScreenActionRules,
    stagingKeywords,
    stagingRegex: stagingKeywords && stagingKeywords.length > 0
      ? new RegExp(
        `^(?:${
          stagingKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")
        })\\b`,
        "i",
      )
      : undefined,
    terminalStatements,
    branchStatements,
    choiceDirectives: choiceDirectives.length > 0
      ? choiceDirectives
      : undefined,
    variableMutations: variableMutations.length > 0
      ? variableMutations
      : undefined,
    endingRules: endingRules.length > 0 ? endingRules : undefined,
    utilityLabelPatterns: utilityLabelPatterns.length > 0
      ? utilityLabelPatterns
      : undefined,
    detectionSignatures,
    detectionFilePatterns: detectionFilePatterns.length > 0
      ? detectionFilePatterns
      : undefined,
  };
}
