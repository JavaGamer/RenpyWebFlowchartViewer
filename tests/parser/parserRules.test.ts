import { describe, expect, it } from "vitest";
import {
  BUILTIN_PARSER_VARIANT_PLUGINS,
  compileCustomVariant,
  detectParserVariant,
  getParserVariantPlugin,
  getPredefinedScreenActionRules,
  isParserVariant,
  mergeScreenActionRules,
  registerParserVariantPlugin,
  resolveCustomRulesForVariant,
  toScreenActionRuleMap,
  validateSafeRegexPattern,
} from "../../src/config/parserRules.ts";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import { discoverTerminalEndings } from "../../src/domain/analytics/endingReachability.ts";
import type { FlowNode } from "../../src/domain/graph.ts";
import { useParserRuleSettingsStore } from "../../src/application/parserRuleSettingsStore.ts";
import { useAppStore } from "../../src/application/appStore.ts";

describe("parser rule variants", () => {
  it("includes ST default mappings in st variant", () => {
    const stRules = getPredefinedScreenActionRules("st");
    expect(stRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionName: "timedchoice" }),
        expect.objectContaining({ actionName: "gameover" }),
        expect.objectContaining({ actionName: "title" }),
        expect.objectContaining({ actionName: "placeholder" }),
        expect.objectContaining({ actionName: "routename" }),
      ]),
    );
  });

  it("includes predefined rules for the renpy variant", () => {
    const renpyRules = getPredefinedScreenActionRules("renpy");
    expect(renpyRules).toHaveLength(9);
    expect(renpyRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionName: "Jump", actionKind: "jump" }),
        expect.objectContaining({ actionName: "Call", actionKind: "call" }),
        expect.objectContaining({ actionName: "Show", actionKind: "show" }),
        expect.objectContaining({ actionName: "Hide", actionKind: "hide" }),
        expect.objectContaining({
          actionName: "ShowMenu",
          actionKind: "show_menu",
        }),
        expect.objectContaining({
          actionName: "SetVariable",
          actionKind: "set_variable",
        }),
        expect.objectContaining({
          actionName: "ToggleVariable",
          actionKind: "toggle_variable",
        }),
        expect.objectContaining({
          actionName: "Confirm",
          actionKind: "confirm",
        }),
        expect.objectContaining({
          actionName: "NullAction",
          actionKind: "null_action",
        }),
      ]),
    );
  });

  it("allows custom rules to override predefined rules", () => {
    const rules = mergeScreenActionRules("st", [{
      actionName: "title",
      actionKind: "call",
    }]);
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionName: "title", actionKind: "call" }),
      ]),
    );
  });

  it("mergeScreenActionRules with empty custom rules returns only predefined rules", () => {
    const rules = mergeScreenActionRules("renpy", []);
    expect(rules).toHaveLength(9);
  });

  it("mergeScreenActionRules with undefined custom rules returns only predefined rules", () => {
    const rules = mergeScreenActionRules("renpy", undefined);
    expect(rules).toHaveLength(9);
  });

  it("mergeScreenActionRules discards rules with an invalid actionKind", () => {
    const rules = mergeScreenActionRules("renpy", [
      { actionName: "Warp", actionKind: "teleport" as "jump" },
    ]);
    // 'Warp' should not be added because its kind is invalid.
    expect(rules.some((r) => r.actionName === "Warp")).toBe(false);
  });

  it("mergeScreenActionRules discards rules with an empty actionName after trimming", () => {
    const rules = mergeScreenActionRules("renpy", [{
      actionName: "   ",
      actionKind: "jump",
    }]);
    expect(rules).toHaveLength(9);
  });

  it("normalizes rule lookup keys for matching", () => {
    const ruleMap = toScreenActionRuleMap("renpy", [{
      actionName: "Warp",
      actionKind: "jump",
    }]);
    expect(ruleMap.get("warp")).toBe("jump");
  });

  it("toScreenActionRuleMap with undefined variant defaults to renpy predefined rules", () => {
    const ruleMap = toScreenActionRuleMap(undefined, undefined);
    expect(ruleMap.get("jump")).toBe("jump");
    expect(ruleMap.get("call")).toBe("call");
  });

  it("toScreenActionRuleMap with undefined customRules still returns predefined rules", () => {
    const ruleMap = toScreenActionRuleMap("renpy", undefined);
    expect(ruleMap.size).toBe(9);
  });
});

describe("registerParserVariantPlugin validation", () => {
  it("throws when plugin id is empty", () => {
    expect(() =>
      registerParserVariantPlugin({
        id: "   ",
        label: "My Variant",
        defaultScreenActionRules: [],
      })
    ).toThrow("non-empty string");
  });

  it("throws when plugin label is empty", () => {
    expect(() =>
      registerParserVariantPlugin({
        id: "myvariant",
        label: "   ",
        defaultScreenActionRules: [],
      })
    ).toThrow("non-empty label");
  });

  it("throws when a defaultScreenActionRule has an invalid actionKind", () => {
    expect(() =>
      registerParserVariantPlugin({
        id: "myvariant",
        label: "My Variant",
        defaultScreenActionRules: [{
          actionName: "Teleport",
          actionKind: "warp" as "jump",
        }],
      })
    ).toThrow("Invalid defaultScreenActionRule");
  });

  it("throws when a defaultScreenActionRule has an empty actionName", () => {
    expect(() =>
      registerParserVariantPlugin({
        id: "myvariant",
        label: "My Variant",
        defaultScreenActionRules: [{ actionName: "   ", actionKind: "jump" }],
      })
    ).toThrow("Invalid defaultScreenActionRule");
  });

  it("registers a valid plugin and trims id and label", () => {
    registerParserVariantPlugin({
      id: "  testvariant  ",
      label: "  Test Variant  ",
      defaultScreenActionRules: [{ actionName: " Warp ", actionKind: "jump" }],
    });
    const rules = getPredefinedScreenActionRules("testvariant");
    expect(rules).toEqual([{ actionName: "Warp", actionKind: "jump" }]);
  });
});

describe("detectParserVariant", () => {
  it("detects ST variant from placeholder statements", () => {
    const script = `
label chapter1:
    "Hello world"
    placeholder
`;
    const result = detectParserVariant([script]);
    expect(result.variant).toBe("st");
  });

  it("detects ST variant from timedchoice statements", () => {
    const script = `
label choice_time:
    timedchoice (5, "timeout_label"):
        "Option 1":
            jump next
`;
    const result = detectParserVariant([script]);
    expect(result.variant).toBe("st");
  });

  it("detects ST variant from staging keywords", () => {
    const script = `
label scene_start:
    swap char1 char2
    "Swapped!"
`;
    const result = detectParserVariant([script]);
    expect(result.variant).toBe("st");
  });

  it("falls back to renpy variant when no custom signatures match", () => {
    const script = `
label start:
    scene bg room
    "Just standard Ren'Py"
    menu:
        "Yes":
            jump yes_label
        "No":
            jump no_label
`;
    const result = detectParserVariant([script]);
    expect(result.variant).toBe("renpy");
  });

  it("returns fallback variant for empty contents", () => {
    expect(detectParserVariant([]).variant).toBe("renpy");
    expect(detectParserVariant([""]).variant).toBe("renpy");
  });
});

describe("resolveCustomRulesForVariant", () => {
  it("returns auto rules when variant is auto", () => {
    const rulesByVariant = {
      auto: [{ actionName: "QuickSave", actionKind: "call" as const }],
      renpy: [{ actionName: "Warp", actionKind: "jump" as const }],
      st: [],
    };
    const resolved = resolveCustomRulesForVariant("auto", rulesByVariant);
    expect(resolved).toEqual([
      { actionName: "QuickSave", actionKind: "call" },
    ]);
  });

  it("variant-specific rules override generic auto rules", () => {
    const rulesByVariant = {
      auto: [
        { actionName: "GlobalNav", actionKind: "call" as const },
        { actionName: "CustomAction", actionKind: "show_menu" as const },
      ],
      renpy: [
        { actionName: "CustomAction", actionKind: "jump" as const },
        { actionName: "RenpyNav", actionKind: "jump" as const },
      ],
    };
    const resolved = resolveCustomRulesForVariant("renpy", rulesByVariant);
    expect(resolved).toEqual(
      expect.arrayContaining([
        { actionName: "GlobalNav", actionKind: "call" },
        { actionName: "RenpyNav", actionKind: "jump" },
        { actionName: "CustomAction", actionKind: "jump" }, // variant-specific overrides auto
      ]),
    );
  });

  it("returns empty array when rulesByVariant is undefined or empty", () => {
    expect(resolveCustomRulesForVariant("renpy", undefined)).toEqual([]);
    expect(resolveCustomRulesForVariant("renpy", {})).toEqual([]);
  });
});

describe("detectParserVariant false-positive prevention", () => {
  it("does not falsely detect standard Python code or dialogue as ST variant", () => {
    const script = `
label start:
    body "I can't move."
    $ body = "athletic"
    $ clone = True
    $ swap(card1, card2)
    "Normal dialogue continuing"
    return
`;
    const result = detectParserVariant([script]);
    expect(result.variant).toBe("renpy");
  });
});

describe("variant detection engine: pragma & path heuristics", () => {
  it("detects variant via # @variant: <id> pragma with 100% confidence", () => {
    const script = `
# @variant: mas
label ch30_loop:
    "Hello player."
    return
`;
    const result = detectParserVariant([{ name: "ch30.rpy", content: script }]);
    expect(result.variant).toBe("mas");
    expect(result.confidence).toBe(100);
    expect(result.evidence.matchedPragma).toBe("mas");
    expect(result.summary).toContain("pragma override");
  });

  it("prioritizes pragma over conflicting script keywords", () => {
    const script = `
# @variant: ddlc
label scene_start:
    swap char1 char2
    "Text"
    return
`;
    const result = detectParserVariant([{ name: "test.rpy", content: script }]);
    expect(result.variant).toBe("ddlc");
    expect(result.confidence).toBe(100);
  });

  it("detects variant using file path heuristics", () => {
    const masResult = detectParserVariant([{
      path: "game/mas_submod_utils.rpy",
      content: "label start:\n    return",
    }]);
    expect(masResult.variant).toBe("mas");
    expect(masResult.evidence.matchedPathPatterns.length).toBeGreaterThan(0);

    const ddlcResult = detectParserVariant([{
      path: "game/script-ch0.rpy",
      content: "label ch0_main:\n    return",
    }]);
    expect(ddlcResult.variant).toBe("ddlc");

    const nvlResult = detectParserVariant([{
      path: "game/screens_nvl.rpy",
      content: "label nvl_story:\n    return",
    }]);
    expect(nvlResult.variant).toBe("nvl");
  });

  it("computes weighted confidence score and candidate breakdown", () => {
    const script = `
label start:
    $ persistent.playthrough = 1
    call poemgame
    return
`;
    const result = detectParserVariant([{
      name: "script.rpy",
      content: script,
    }]);
    expect(result.variant).toBe("ddlc");
    expect(result.confidence).toBeGreaterThan(50);
    expect(result.scores.length).toBeGreaterThan(0);
    expect(result.scores[0].variant).toBe("ddlc");
  });
});

describe("new built-in presets: mas, renpy7, nvl", () => {
  it("registers and identifies new built-in presets", () => {
    expect(isParserVariant("mas")).toBe(true);
    expect(isParserVariant("renpy7")).toBe(true);
    expect(isParserVariant("nvl")).toBe(true);

    const pluginIds = BUILTIN_PARSER_VARIANT_PLUGINS.map((p) => p.id);
    expect(pluginIds).toContain("mas");
    expect(pluginIds).toContain("renpy7");
    expect(pluginIds).toContain("nvl");
  });

  it("provides MAS specific screen actions and staging keywords", () => {
    const mas = getParserVariantPlugin("mas");
    expect(mas.stagingKeywords).toContain("m_talk");
    expect(mas.stagingKeywords).toContain("mas_reaction");
    expect(
      mas.defaultScreenActionRules.some((r) =>
        r.actionName === "mas_show_poem"
      ),
    ).toBe(true);
  });

  it("provides NVL specific screen actions and staging keywords", () => {
    const nvl = getParserVariantPlugin("nvl");
    expect(nvl.stagingKeywords).toContain("nvl_clear");
    expect(nvl.stagingKeywords).toContain("page");
    expect(nvl.defaultScreenActionRules.length).toBeGreaterThanOrEqual(9);
  });

  it("provides Ren'Py 7 Legacy rules and staging keywords", () => {
    const renpy7 = getParserVariantPlugin("renpy7");
    expect(renpy7.stagingKeywords).toContain("camera");
    expect(renpy7.stagingKeywords).toContain("with");
    expect(renpy7.defaultScreenActionRules.length).toBeGreaterThanOrEqual(9);
  });
});

describe("custom variant syntax & semantic control", () => {
  it("parses custom choice directives and creates timeout edges", async () => {
    registerParserVariantPlugin({
      id: "test-timed-choice-variant",
      label: "Test Timed Choice Variant",
      defaultScreenActionRules: [],
      choiceDirectives: [
        {
          pattern:
            /^\s*custom_timer\s*\(\s*([0-9.]+)\s*,\s*["']([A-Za-z0-9_]+)["']\s*\)/i,
          durationGroup: 1,
          targetGroup: 2,
          isTimeout: true,
        },
      ],
    });

    const script = `
label choice_test:
    custom_timer (4.5, "timeout_dest")
    menu:
        "Choice A":
            jump a_dest

label a_dest:
    return

label timeout_dest:
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "test_choice.rpy", content: script }],
      { parserVariant: "test-timed-choice-variant" },
    );

    const timeoutEdge = result.edges.find(
      (e) => e.target.includes("timeout_dest") && e.timeout?.isTimeout,
    );
    expect(timeoutEdge).toBeDefined();
    expect(timeoutEdge?.timeout?.durationSeconds).toBe(4.5);
  });

  it("parses custom variable mutations and emits nodeMutations", async () => {
    registerParserVariantPlugin({
      id: "test-mutations-variant",
      label: "Test Mutations Variant",
      defaultScreenActionRules: [],
      variableMutations: [
        {
          pattern: /^\s*gain_affinity\s+([A-Za-z0-9_]+)\s+(\d+)/i,
          variableName: "affinity",
          operator: "+=",
          valueGroup: 2,
        },
      ],
    });

    const script = `
label story_node:
    gain_affinity monika 10
    "Gained affinity."
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "test_mut.rpy", content: script }],
      { parserVariant: "test-mutations-variant" },
    );

    const storyNode = result.nodes.find((n) => n.label === "story_node");
    expect(storyNode).toBeDefined();
    const mutations = result.nodeMutations?.get(storyNode!.id);
    expect(mutations?.some((m) => m.variableName === "affinity")).toBe(true);
  });

  it("classifies utility labels and prevents false terminal story endings", async () => {
    registerParserVariantPlugin({
      id: "test-utility-labels-variant",
      label: "Test Utility Labels Variant",
      defaultScreenActionRules: [],
      utilityLabelPatterns: [/^lb_util_/, /^helper_/],
    });

    const script = `
label lb_util_calculate_stats:
    $ stats = 100
    return

label main_story_ending:
    "End of story."
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "test_util.rpy", content: script }],
      { parserVariant: "test-utility-labels-variant" },
    );

    const utilNode = result.nodes.find((n) =>
      n.label === "lb_util_calculate_stats"
    );
    const mainNode = result.nodes.find((n) => n.label === "main_story_ending");

    expect(utilNode).toBeDefined();
    expect(utilNode?.role).toBe("utility");
    expect(mainNode?.role).not.toBe("utility");
  });

  describe("ReDoS & Regex Security", () => {
    it("rejects nested quantifiers and overlapping alternation groups", () => {
      // Nested quantifiers
      expect(() => validateSafeRegexPattern("(a+)+")).toThrow(
        /catastrophic backtracking/i,
      );
      expect(() => validateSafeRegexPattern("([a-z]+)*")).toThrow(
        /catastrophic backtracking/i,
      );

      // Overlapping alternations with quantifiers
      expect(() => validateSafeRegexPattern("(x|[w-z])+$")).toThrow(
        /catastrophic backtracking/i,
      );
      expect(() => validateSafeRegexPattern("(\\w+|[a-z]+)+")).toThrow(
        /catastrophic backtracking/i,
      );

      // Dynamic probe catastrophic backtracking
      expect(() => validateSafeRegexPattern("(a|a)+$")).toThrow(
        /catastrophic backtracking/i,
      );
    });

    it("accepts safe bounded regex patterns", () => {
      expect(validateSafeRegexPattern("^game/mas_.*\\.rpy$")).toBeInstanceOf(
        RegExp,
      );
      expect(validateSafeRegexPattern("^lb_.*$")).toBeInstanceOf(RegExp);
      expect(
        validateSafeRegexPattern("^\\s*\\$?\\s*affinity\\s*\\+=\\s*(\\d+)"),
      ).toBeInstanceOf(RegExp);
    });
  });

  describe("Windows Path Normalization in detectParserVariant", () => {
    it("matches detection file patterns on Windows backslash paths", () => {
      const files = [
        {
          name: "game\\submods\\mas_main.rpy",
          path: "game\\submods\\mas_main.rpy",
          content: "# Mod file",
        },
      ];
      const detection = detectParserVariant(files);
      expect(detection.evidence.matchedPathPatterns.length).toBeGreaterThan(0);
      expect(detection.variant).toBe("mas");
    });
  });

  describe("Custom Variant Rule Overrides", () => {
    it("allows custom variants to override base preset rules cleanly", () => {
      const compiled = compileCustomVariant({
        id: "override-test-variant",
        label: "Override Test Variant",
        baseVariant: "renpy",
        screenActionRules: [
          { actionName: "Jump", actionKind: "call" }, // Override built-in jump -> call
          { actionName: "CustomAction", actionKind: "show" },
        ],
      });

      const jumpRule = compiled.defaultScreenActionRules.find(
        (r) => r.actionName.toLowerCase() === "jump",
      );
      expect(jumpRule).toBeDefined();
      expect(jumpRule?.actionKind).toBe("call");

      const customRule = compiled.defaultScreenActionRules.find(
        (r) => r.actionName.toLowerCase() === "customaction",
      );
      expect(customRule).toBeDefined();
      expect(customRule?.actionKind).toBe("show");
    });
  });

  describe("Ending Reachability & Utility Roles", () => {
    it("does not classify non-story utility nodes with 0 outgoing edges as terminal endings", () => {
      const nodes: FlowNode[] = [
        {
          id: "node-story-1",
          type: "LABEL",
          label: "good_ending",
          role: "story",
          dialogueCount: 5,
          dialogueLines: ["You won!"],
          isShadowed: false,
        },
        {
          id: "node-util-1",
          type: "LABEL",
          label: "lb_util_calc",
          role: "utility",
          dialogueCount: 0,
          dialogueLines: [],
          isShadowed: false,
        },
      ];

      const result = discoverTerminalEndings(nodes, []);
      expect(result.endingMap.has("node-story-1")).toBe(true);
      expect(result.endingMap.has("node-util-1")).toBe(false);
    });
  });

  describe("Prototype Pollution Resilience", () => {
    it("prevents prototype pollution in customRulesSlice", () => {
      useParserRuleSettingsStore.setState({
        selectedVariant: "renpy",
        customRulesByVariant: {},
      });

      const store = useParserRuleSettingsStore.getState();

      // Accessing dangerous keys should be a no-op and never crash or pollute
      store.addCustomRule("toString");
      expect(Object.prototype.toString).toBeInstanceOf(Function);
      store.updateCustomRule(0, { actionName: "Exploit" }, "toString");
      store.removeCustomRule(0, "toString");

      store.addCustomRule("__proto__");
      expect(Object.hasOwn(Object.prototype, "actionName")).toBe(false);
    });

    it("rejects malformed payloads in importCustomVariant with Zod validation", () => {
      useParserRuleSettingsStore.setState({
        customVariants: [],
        selectedVariant: "auto",
      });

      const store = useParserRuleSettingsStore.getState();

      // Invalid branchKind in branchStatements
      const invalidBranchJson = JSON.stringify({
        id: "invalid-branch-variant",
        label: "Invalid Branch",
        branchStatements: [
          { pattern: "warp (.*)", branchKind: "invalid_kind" },
        ],
      });
      const res = store.importCustomVariant(invalidBranchJson);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Validation error");

      // Invalid ID containing illegal characters
      const invalidIdJson = JSON.stringify({
        id: "Invalid ID with spaces!",
        label: "Invalid ID Variant",
      });
      const resId = store.importCustomVariant(invalidIdJson);
      expect(resId.success).toBe(false);
    });

    it("resets variantDetectionResult in appPhaseSlice reset", () => {
      useAppStore.setState({
        variantDetectionResult: {
          variant: "mas",
          confidence: 95,
          summary: "test",
          evidence: { matchedPathPatterns: [], matchedKeywords: [] },
          scores: [],
        },
        isVariantAutoDetected: true,
      });

      useAppStore.getState().reset();
      expect(useAppStore.getState().variantDetectionResult).toBeNull();
      expect(useAppStore.getState().isVariantAutoDetected).toBe(false);
    });
  });
});
