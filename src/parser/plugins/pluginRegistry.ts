import type {
  BranchStatementRule,
  ChoiceDirectiveRule,
  CustomVariantDefinition,
  EndingClassificationRule,
  ParserVariant,
  ParserVariantPlugin,
  ScreenActionKind,
  ScreenActionRule,
  SerializableParserVariantPlugin,
  TerminalStatementRule,
  VariableMutationRule,
} from "./types.ts";
import { RESERVED_VARIANT_IDS } from "./types.ts";
import { validateSafeRegexPattern } from "./regexValidator.ts";
import { normalizeScreenActionRule } from "./screenActionRules.ts";
import { BUILTIN_PARSER_VARIANT_PLUGINS } from "./builtinPlugins.ts";

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

export function clearCustomParserVariantPlugins(): void {
  for (const plugin of getParserVariantPlugins()) {
    if (plugin.isCustom) {
      parserVariantPluginMap.delete(plugin.id);
    }
  }
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
