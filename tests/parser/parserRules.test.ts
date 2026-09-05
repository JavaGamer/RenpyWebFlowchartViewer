import { describe, expect, it } from "vitest";
import {
  detectParserVariant,
  getPredefinedScreenActionRules,
  mergeScreenActionRules,
  registerParserVariantPlugin,
  resolveCustomRulesForVariant,
  toScreenActionRuleMap,
} from "../../src/config/parserRules";

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
