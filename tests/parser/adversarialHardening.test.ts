import { describe, expect, it } from "vitest";
import {
  registerParserVariantPlugin,
  unregisterParserVariantPlugin,
  validateSafeRegexPattern,
} from "../../src/config/parserRules.ts";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import { parseScreenDefinition } from "../../src/parser/handlers/screen/screenActionExtractor.ts";
import { createGraphState } from "../../src/parser/pipelineState.ts";
import { useAppStore } from "../../src/application/appStore.ts";
import { reparseUploadedFiles } from "../../src/application/reparse.ts";

describe("Adversarial Hardening: Regex & ReDoS Safety", () => {
  it("rejects nested quantifiers that can cause exponential backtracking", () => {
    // Nested plus/star
    expect(() => validateSafeRegexPattern("(a+)+")).toThrow(
      /nested quantifiers/i,
    );
    expect(() => validateSafeRegexPattern("([a-zA-Z0-9]+)+")).toThrow(
      /nested quantifiers/i,
    );
    expect(() => validateSafeRegexPattern("(\\d+)*")).toThrow(
      /nested quantifiers/i,
    );
    expect(() => validateSafeRegexPattern("(a*)*")).toThrow(
      /nested quantifiers/i,
    );

    // Nested curly brace quantifiers
    expect(() => validateSafeRegexPattern("(a{2,5})+")).toThrow(
      /nested quantifiers/i,
    );
    expect(() => validateSafeRegexPattern("(a+){2,5}")).toThrow(
      /nested quantifiers/i,
    );
    expect(() => validateSafeRegexPattern("(a{1,}){2,}")).toThrow(
      /nested quantifiers/i,
    );
  });

  it("rejects overlapping alternations inside repeated groups", () => {
    expect(() => validateSafeRegexPattern("(a|a)+")).toThrow(
      /overlapping alternations/i,
    );
    expect(() => validateSafeRegexPattern("(test|test)*")).toThrow(
      /overlapping alternations/i,
    );
  });

  it("rejects patterns exceeding the 300 character bound", () => {
    const longPattern = "a".repeat(301);
    expect(() => validateSafeRegexPattern(longPattern)).toThrow(
      /maximum length/i,
    );
  });

  it("accepts safe Ren'Py syntax patterns", () => {
    expect(validateSafeRegexPattern("^warp\\s+([a-zA-Z0-9_.]+)").source).toBe(
      "^warp\\s+([a-zA-Z0-9_.]+)",
    );
    expect(validateSafeRegexPattern("^goto\\s+([a-zA-Z0-9_.]+)").source).toBe(
      "^goto\\s+([a-zA-Z0-9_.]+)",
    );
    expect(
      validateSafeRegexPattern("renpy\\.(?:full_restart|quit|utter_restart)")
        .source,
    ).toBe("renpy\\.(?:full_restart|quit|utter_restart)");
    expect(validateSafeRegexPattern("(\\w+)").source).toBe("(\\w+)");
  });

  it("rejects reserved IDs when registering variant plugins", () => {
    expect(() =>
      registerParserVariantPlugin({
        id: "__proto__",
        label: "Exploit",
        defaultScreenActionRules: [],
      })
    ).toThrow(/reserved/i);

    expect(() =>
      registerParserVariantPlugin({
        id: "constructor",
        label: "Exploit",
        defaultScreenActionRules: [],
      })
    ).toThrow(/reserved/i);

    expect(() =>
      registerParserVariantPlugin({
        id: "renpy",
        label: "Builtin Collision",
        isCustom: true,
        defaultScreenActionRules: [],
      })
    ).toThrow(/reserved/i);

    expect(() =>
      registerParserVariantPlugin({
        id: "Invalid ID with spaces",
        label: "Bad Format",
        defaultScreenActionRules: [],
      })
    ).toThrow(/must contain only lowercase letters/i);
  });
});

describe("Adversarial Hardening: Control Flow Context Guards (CFG-01 & CFG-02)", () => {
  it("does NOT trigger custom branch statement inside dialogue, comments, or python assignments", async () => {
    const customPluginId = "adv_test_cfg";
    try {
      registerParserVariantPlugin({
        id: customPluginId,
        label: "Adv CFG Test",
        branchStatements: [
          {
            pattern: new RegExp("^warp\\s+([a-zA-Z0-9_.]+)"),
            branchKind: "jump",
            targetGroup: 1,
            suppressFallthrough: true,
          },
        ],
        defaultScreenActionRules: [],
      });

      const script = `
label start:
    # warp target_comment
    "We need to warp target_dialogue right now!"
    $ warp = 1
    e "warp target_narrator"
    warp real_target

label real_target:
    "Arrived safely"
`;

      const result = await parseRenpyFiles(
        [
          {
            name: "test_cfg.rpy",
            relativePath: "test_cfg.rpy",
            content: script,
          },
        ],
        { parserVariant: customPluginId },
      );

      // Verify that edges were only created to real_target, not to comment, dialogue, or python
      const jumpEdges = result.edges.filter((e) => e.kind === "jump");
      expect(jumpEdges.length).toBe(1);
      expect(jumpEdges[0].target).toBe("real_target");
    } finally {
      unregisterParserVariantPlugin(customPluginId);
    }
  });

  it("supports Ren'Py local labels and quoted targets in custom branch statements", async () => {
    const customPluginId = "adv_test_local_lbl";
    try {
      registerParserVariantPlugin({
        id: customPluginId,
        label: "Adv Local Label Test",
        branchStatements: [
          {
            pattern: new RegExp("^warp\\s+(.+)$"),
            branchKind: "jump",
            targetGroup: 1,
            suppressFallthrough: true,
          },
        ],
        defaultScreenActionRules: [],
      });

      const script = `
label start:
    warp .local_checkpoint

label .local_checkpoint:
    "At local checkpoint"
    warp "start"
`;

      const result = await parseRenpyFiles(
        [
          {
            name: "test_local.rpy",
            relativePath: "test_local.rpy",
            content: script,
          },
        ],
        { parserVariant: customPluginId },
      );

      const jumpTargets = result.edges
        .filter((e) => e.kind === "jump")
        .map((e) => e.target);
      expect(jumpTargets).toContain(".local_checkpoint");
      expect(jumpTargets).toContain("start");
    } finally {
      unregisterParserVariantPlugin(customPluginId);
    }
  });
});

describe("Adversarial Hardening: Screen Action Extractor (SCR-01, SCR-02, SCR-03)", () => {
  it("extracts targets from Python ternary actions: action (Jump('a') if cond else Jump('b'))", () => {
    const graphState = createGraphState("renpy");
    const parsed = parseScreenDefinition(
      "test_screen",
      "screens.rpy",
      10,
      'textbutton "Choice" action (Jump("branch_a") if has_key else Jump("branch_b"))',
      graphState.screenActionRuleMap,
      graphState,
    );

    const jumpTargets = parsed.actions
      .filter((a) => a.construct === "jump")
      .map((a) => a.target);
    expect(jumpTargets).toContain("branch_a");
    expect(jumpTargets).toContain("branch_b");
  });

  it("supports bare screen action identifiers like 'action Return' and 'action MainMenu'", () => {
    const graphState = createGraphState("renpy");
    const parsed = parseScreenDefinition(
      "test_screen",
      "screens.rpy",
      15,
      'textbutton "Back" action Return\ntextbutton "Title" action MainMenu',
      graphState.screenActionRuleMap,
      graphState,
    );

    expect(parsed.hasReturnAction).toBe(true);
    // Return and MainMenu are built-in ignored / return actions, so 0 unmapped diagnostics
    expect(graphState.diagnostics.length).toBe(0);
  });

  it("does NOT produce unmapped diagnostics for standard Ren'Py GUI actions", () => {
    const graphState = createGraphState("renpy");
    const standardGuiBody = `
    textbutton "Save" action FileAction(1)
    textbutton "QuickSave" action QuickSave()
    textbutton "QuickLoad" action QuickLoad()
    textbutton "Skip" action Skip()
    textbutton "Mute" action SetMute('music', True)
    textbutton "Web" action OpenURL('https://renpy.org')
    textbutton "Menu" action MainMenu(confirm=False)
`;

    parseScreenDefinition(
      "gui_screen",
      "screens.rpy",
      1,
      standardGuiBody,
      graphState.screenActionRuleMap,
      graphState,
    );

    const unmappedDiags = graphState.diagnostics.filter(
      (d) => d.code === "unmapped_screen_action",
    );
    expect(unmappedDiags.length).toBe(0);
  });

  it("deduplicates unmapped action diagnostics by construct globally", () => {
    const graphState = createGraphState("renpy");
    parseScreenDefinition(
      "screen1",
      "screens.rpy",
      5,
      'textbutton "MiniGame1" action CustomUnmappedMiniGame("stage1")',
      graphState.screenActionRuleMap,
      graphState,
    );
    parseScreenDefinition(
      "screen2",
      "minigames.rpy",
      12,
      'textbutton "MiniGame2" action CustomUnmappedMiniGame("stage2")',
      graphState.screenActionRuleMap,
      graphState,
    );

    const unmappedDiags = graphState.diagnostics.filter(
      (d) => d.code === "unmapped_screen_action",
    );
    // Should be deduplicated to 1 diagnostic
    expect(unmappedDiags.length).toBe(1);
    expect(unmappedDiags[0].id).toBe(
      "unmapped_screen_action|customunmappedminigame",
    );
  });
});

describe("Adversarial Hardening: Concurrency & Session Preservation", () => {
  it("rejects concurrent reparse requests when isReparsing is true", async () => {
    useAppStore.setState({ isReparsing: true });
    try {
      const result = await reparseUploadedFiles();
      expect(result).toBe(false);
    } finally {
      useAppStore.setState({ isReparsing: false });
    }
  });

  it("does NOT increment importRevision when preserveSession is true", () => {
    const initialRevision = useAppStore.getState().importRevision;
    useAppStore.getState().parseSuccess([], [], [], undefined, {
      preserveSession: true,
      parsedVariant: "renpy",
    });

    expect(useAppStore.getState().importRevision).toBe(initialRevision);

    // When preserveSession is false or undefined, it increments
    useAppStore.getState().parseSuccess([], [], [], undefined, {
      preserveSession: false,
      parsedVariant: "renpy",
    });
    expect(useAppStore.getState().importRevision).toBe(initialRevision + 1);
  });
});
