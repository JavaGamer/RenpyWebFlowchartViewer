import { afterEach, describe, expect, it } from "vitest";
import {
  AUTO_PARSER_VARIANT,
  clearCustomParserVariantPlugins,
  compileCustomVariant,
  deserializeVariantPlugin,
  FALLBACK_PARSER_VARIANT,
  getParserVariantPlugin,
  getParserVariantPlugins,
  getParserVariants,
  getPredefinedScreenActionRules,
  isParserVariant,
  mergeScreenActionRules,
  registerParserVariantPlugin,
  resolveCustomRulesForVariant,
  serializeVariantPlugin,
  toScreenActionRuleMap,
  unregisterParserVariantPlugin,
} from "../../src/parser/plugins/pluginRegistry.ts";
import type {
  ParserVariantPlugin,
  ScreenActionRule,
  SerializableParserVariantPlugin,
} from "../../src/parser/plugins/types.ts";

describe("pluginRegistry", () => {
  afterEach(() => {
    clearCustomParserVariantPlugins();
  });

  it("lists variants and plugins", () => {
    const plugins = getParserVariantPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    const variants = getParserVariants();
    expect(variants).toContain(FALLBACK_PARSER_VARIANT);
    expect(isParserVariant(AUTO_PARSER_VARIANT)).toBe(true);
    expect(isParserVariant(FALLBACK_PARSER_VARIANT)).toBe(true);
    expect(isParserVariant("unknown_xyz")).toBe(false);
    expect(isParserVariant(123)).toBe(false);
  });

  it("retrieves parser plugins with fallback", () => {
    const defaultPlugin = getParserVariantPlugin(FALLBACK_PARSER_VARIANT);
    expect(defaultPlugin.id).toBe(FALLBACK_PARSER_VARIANT);
    const fallbackPlugin = getParserVariantPlugin("non_existent_variant");
    expect(fallbackPlugin.id).toBe(FALLBACK_PARSER_VARIANT);
    const undefinedPlugin = getParserVariantPlugin(undefined);
    expect(undefinedPlugin.id).toBe(FALLBACK_PARSER_VARIANT);
  });

  it("registers, retrieves, and unregisters custom plugins", () => {
    const customPlugin: ParserVariantPlugin = {
      id: "my_custom_vn",
      label: "My Custom VN",
      description: "Custom engine plugin",
      isCustom: true,
      defaultScreenActionRules: [
        { actionName: "CustomJump", actionKind: "jump" },
      ],
      stagingKeywords: ["stage_in", "stage_out"],
      branchStatements: [
        {
          pattern: "custom_branch\\s+([a-zA-Z0-9_]+)",
          branchKind: "jump",
          targetGroup: 1,
        },
      ],
      choiceDirectives: [
        {
          pattern: 'custom_choice\\s+"([^"]+)"',
          captionGroup: 1,
        },
      ],
      variableMutations: [
        {
          pattern: "\\$?\\s*set_flag\\s+([a-zA-Z0-9_]+)",
          variableGroup: 1,
        },
      ],
      endingRules: [
        {
          pattern: "reach_end",
          endingType: "good",
        },
      ],
      utilityLabelPatterns: ["util_[a-zA-Z0-9_]+"],
      detectionFilePatterns: ["script_custom\\.rpy"],
      detectionSignatures: [/custom_marker/],
    };

    registerParserVariantPlugin(customPlugin);
    expect(isParserVariant("my_custom_vn")).toBe(true);
    const retrieved = getParserVariantPlugin("my_custom_vn");
    expect(retrieved.label).toBe("My Custom VN");
    expect(retrieved.stagingRegex).toBeDefined();

    // Cannot unregister builtin plugins
    expect(unregisterParserVariantPlugin(FALLBACK_PARSER_VARIANT)).toBe(false);

    // Can unregister custom plugin
    expect(unregisterParserVariantPlugin("my_custom_vn")).toBe(true);
    expect(isParserVariant("my_custom_vn")).toBe(false);
  });

  it("validates registerParserVariantPlugin arguments", () => {
    expect(() =>
      registerParserVariantPlugin({
        id: "",
        label: "Empty",
        defaultScreenActionRules: [],
      })
    ).toThrow("must be a non-empty string");

    expect(() =>
      registerParserVariantPlugin({
        id: "Invalid ID with spaces",
        label: "Invalid",
        defaultScreenActionRules: [],
      })
    ).toThrow("must contain only lowercase letters");

    expect(() =>
      registerParserVariantPlugin({
        id: "__proto__",
        label: "Proto",
        defaultScreenActionRules: [],
      })
    ).toThrow("Cannot register custom variant with reserved or built-in ID");

    expect(() =>
      registerParserVariantPlugin({
        id: "renpy",
        label: "Renpy Override",
        isCustom: true,
        defaultScreenActionRules: [],
      })
    ).toThrow("Cannot register custom variant with reserved or built-in ID");

    expect(() =>
      registerParserVariantPlugin({
        id: "valid_id",
        label: "   ",
        defaultScreenActionRules: [],
      })
    ).toThrow("must have a non-empty label");

    expect(() =>
      registerParserVariantPlugin({
        id: "valid_id",
        label: "Valid",
        defaultScreenActionRules: [
          { actionName: "", actionKind: "jump" },
        ],
      })
    ).toThrow("Invalid defaultScreenActionRule");
  });

  it("handles screen action rules merging and mapping", () => {
    const rules = getPredefinedScreenActionRules(FALLBACK_PARSER_VARIANT);
    expect(rules.length).toBeGreaterThan(0);

    const customRules: ScreenActionRule[] = [
      { actionName: "jump", actionKind: "call" }, // overrides jump
      { actionName: "customAction", actionKind: "show" },
      { actionName: "", actionKind: "jump" }, // invalid, skipped
    ];

    const merged = mergeScreenActionRules(FALLBACK_PARSER_VARIANT, customRules);
    expect(merged.length).toBeGreaterThan(0);
    const ruleMap = toScreenActionRuleMap(FALLBACK_PARSER_VARIANT, customRules);

    expect(ruleMap.get("jump")).toBe("call");
    expect(ruleMap.get("customaction")).toBe("show");
  });

  it("resolves custom rules for variant scopes", () => {
    // undefined input
    expect(resolveCustomRulesForVariant("auto", undefined)).toEqual([]);
    expect(
      resolveCustomRulesForVariant(
        "auto",
        "invalid" as unknown as Record<string, ScreenActionRule[]>,
      ),
    ).toEqual([]);

    const customRulesByVariant = {
      auto: [{ actionName: "GlobalRule", actionKind: "jump" as const }],
      my_vn: [{ actionName: "LocalRule", actionKind: "call" as const }],
    };

    // Auto variant returns only auto rules
    const autoResolved = resolveCustomRulesForVariant(
      "auto",
      customRulesByVariant,
    );
    expect(autoResolved).toHaveLength(1);
    expect(autoResolved[0]?.actionName).toBe("GlobalRule");

    // Specific variant merges auto + variant rules
    const vnResolved = resolveCustomRulesForVariant(
      "my_vn",
      customRulesByVariant,
    );
    expect(vnResolved).toHaveLength(2);

    // Unknown variant gets only auto rules
    const otherResolved = resolveCustomRulesForVariant(
      "other",
      customRulesByVariant,
    );
    expect(otherResolved).toHaveLength(1);
  });

  it("serializes and deserializes variant plugins", () => {
    const plugin: ParserVariantPlugin = {
      id: "ser_test",
      label: "Serialization Test",
      description: "Testing round-trip",
      isCustom: true,
      defaultScreenActionRules: [
        { actionName: "Jump", actionKind: "jump" },
      ],
      stagingKeywords: ["enter", "exit"],
      stagingRegex: /^enter\b/i,
      terminalStatements: [
        {
          pattern: /^game_over\b/i,
          isTerminalOutcome: true,
          labelHasExplicitExit: true,
        },
      ],
      branchStatements: [
        {
          pattern: /^jump_to\s+(\w+)/i,
          branchKind: "jump",
          targetGroup: 1,
          suppressFallthrough: true,
        },
      ],
      choiceDirectives: [
        {
          pattern: /^choice\s+"([^"]+)"\s*->\s*(\w+)/i,
          captionGroup: 1,
          targetGroup: 2,
          durationGroup: 0,
          isTimeout: false,
        },
      ],
      variableMutations: [
        {
          pattern: /^set\s+(\w+)\s*=\s*(.+)/i,
          variableGroup: 1,
          valueGroup: 2,
          operator: "=",
          constantValue: "true",
          variableName: "flag",
        },
      ],
      endingRules: [
        {
          pattern: /^end_route\b/i,
          endingType: "true",
        },
      ],
      utilityLabelPatterns: [/^util_/i],
      detectionSignatures: [/test_sig/im],
      detectionFilePatterns: [/test_file\.rpy/i],
    };

    const serialized = serializeVariantPlugin(plugin);
    expect(typeof serialized.stagingRegex).toBe("string");
    expect(serialized.terminalStatements?.[0]?.pattern).toBe("^game_over\\b");

    const deserialized = deserializeVariantPlugin(serialized);
    expect(deserialized.id).toBe("ser_test");
    expect(deserialized.terminalStatements?.[0]?.pattern instanceof RegExp)
      .toBe(true);
    expect(deserialized.branchStatements?.[0]?.pattern instanceof RegExp).toBe(
      true,
    );
    expect(deserialized.choiceDirectives?.[0]?.pattern instanceof RegExp).toBe(
      true,
    );
    expect(deserialized.variableMutations?.[0]?.pattern instanceof RegExp).toBe(
      true,
    );
    expect(deserialized.endingRules?.[0]?.pattern instanceof RegExp).toBe(true);
    expect(deserialized.utilityLabelPatterns?.[0] instanceof RegExp).toBe(true);
    expect(deserialized.detectionSignatures?.[0] instanceof RegExp).toBe(true);
    expect(deserialized.detectionFilePatterns?.[0] instanceof RegExp).toBe(
      true,
    );
  });

  it("clears custom plugins and tests reserved IDs", () => {
    registerParserVariantPlugin({
      id: "to_be_cleared",
      label: "Clear Me",
      isCustom: true,
      defaultScreenActionRules: [],
    });
    expect(isParserVariant("to_be_cleared")).toBe(true);
    clearCustomParserVariantPlugins();
    expect(isParserVariant("to_be_cleared")).toBe(false);

    expect(() =>
      registerParserVariantPlugin({
        id: "prototype",
        label: "Prototype",
        defaultScreenActionRules: [],
      })
    ).toThrow("Cannot register custom variant");

    expect(() =>
      registerParserVariantPlugin({
        id: "constructor",
        label: "Constructor",
        defaultScreenActionRules: [],
      })
    ).toThrow("Cannot register custom variant");

    expect(() =>
      registerParserVariantPlugin({
        id: "tostring",
        label: "ToString",
        defaultScreenActionRules: [],
      })
    ).toThrow("Cannot register custom variant");

    expect(() =>
      registerParserVariantPlugin({
        id: "valueof",
        label: "ValueOf",
        defaultScreenActionRules: [],
      })
    ).toThrow("Cannot register custom variant");
  });

  it("handles plugin with RegExp instances and normalizeCustomRule", () => {
    const customNormalize = (r: ScreenActionRule) => ({
      actionName: r.actionName.toLowerCase(),
      actionKind: "jump" as const,
    });

    const pluginWithRegex: ParserVariantPlugin = {
      id: "rx_plugin",
      label: "Regex Plugin",
      isCustom: true,
      stagingKeywords: ["enter"],
      stagingRegex: /^enter\b/i,
      defaultScreenActionRules: [{ actionName: "Action1", actionKind: "call" }],
      normalizeCustomRule: customNormalize,
      branchStatements: [
        { pattern: /^branch_regex/i, branchKind: "jump", targetGroup: 1 },
      ],
      choiceDirectives: [
        { pattern: /^choice_regex/i, targetGroup: 1 },
      ],
      variableMutations: [
        { pattern: /^mut_regex/i, variableGroup: 1 },
      ],
      endingRules: [
        { pattern: /^end_regex/i, endingType: "bad" },
      ],
      utilityLabelPatterns: [/^util_regex/i],
      detectionFilePatterns: [/file_regex/i],
      detectionSignatures: [/sig_regex/i],
    };

    registerParserVariantPlugin(pluginWithRegex);
    const retrieved = getParserVariantPlugin("rx_plugin");
    expect(retrieved.stagingRegex?.source).toBe("^enter\\b");

    const merged = mergeScreenActionRules("rx_plugin", [
      { actionName: "RuleA", actionKind: "show" },
    ]);
    expect(merged.find((r) => r.actionName === "rulea")?.actionKind).toBe(
      "jump",
    );
  });

  it("deserializes empty plugin and compiles variant with base staging keywords", () => {
    const emptySerializable: SerializableParserVariantPlugin = {
      id: "empty_plugin",
      label: "Empty",
      defaultScreenActionRules: [],
    };
    const deserialized = deserializeVariantPlugin(emptySerializable);
    expect(deserialized.id).toBe("empty_plugin");
    expect(deserialized.stagingRegex).toBeUndefined();

    const compiledWithBase = compileCustomVariant({
      id: "compiled_base",
      label: "Compiled Base",
      baseVariant: FALLBACK_PARSER_VARIANT,
    });
    expect(compiledWithBase.id).toBe("compiled_base");
  });
});
