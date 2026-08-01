import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import { extractSceneAsset } from "../../src/parser/handlers/audioCues.ts";
import { PARSER_TOKENS } from "../../src/parser/parserTokens.ts";

describe("Challenger 2 Empirical Verification", () => {
  // ── 1. Synthetic Menu Fallthrough Edges ─────────────────────────────────────

  describe("Menu Fallthrough Edges & Conditional Jump Options", () => {
    it("1a. Menu where ALL options have unconditional jumps emits NO fallthrough sequence edge", async () => {
      const script = [
        "label start:",
        "    menu:",
        '        "Choice A":',
        "            jump choice_a",
        '        "Choice B":',
        "            jump choice_b",
        '    "This line is after menu"',
        "",
        "label choice_a:",
        '    "In Choice A"',
        "    return",
        "",
        "label choice_b:",
        '    "In Choice B"',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "all_uncond_menu.rpy",
        content: script,
      }]);

      const menuNode = result.nodes.find((n) => n.type === "MENU");
      expect(menuNode).toBeDefined();

      // Should have jump edges to choice_a and choice_b
      const jumpA = result.edges.find((e) =>
        e.source === menuNode?.id && e.target === "choice_a" &&
        e.kind === "jump"
      );
      const jumpB = result.edges.find((e) =>
        e.source === menuNode?.id && e.target === "choice_b" &&
        e.kind === "jump"
      );
      expect(jumpA).toBeDefined();
      expect(jumpB).toBeDefined();

      // Should NOT have a fallthrough sequence edge from menuNode to post-menu dialogue or next node
      const sequenceEdgesFromMenu = result.edges.filter((e) =>
        e.source === menuNode?.id && e.kind === "sequence"
      );
      expect(sequenceEdgesFromMenu).toHaveLength(0);
    });

    it("1b. Menu with mixed conditional jump and unconditional jump options EMITS fallthrough sequence edge", async () => {
      const script = [
        "label start:",
        "    menu:",
        '        "Choice A (Conditional Jump)":',
        "            if has_key:",
        "                jump secret_room",
        '        "Choice B (Unconditional Jump)":',
        "            jump main_hall",
        '    "After menu fallthrough text"',
        "",
        "label secret_room:",
        '    "In secret room"',
        "    return",
        "",
        "label main_hall:",
        '    "In main hall"',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "mixed_cond_menu.rpy",
        content: script,
      }]);

      const menuNode = result.nodes.find((n) => n.type === "MENU");
      expect(menuNode).toBeDefined();

      // Jump edge to secret_room should have condition metadata
      const secretJump = result.edges.find((e) =>
        e.target === "secret_room" && e.kind === "jump"
      );
      expect(secretJump).toBeDefined();
      expect(secretJump?.condition).toBeDefined();
      expect(secretJump?.condition?.expression).toBe("has_key");

      // Fallthrough sequence edge MUST be emitted because Choice A can fall through if has_key is false
      const fallthroughEdge = result.edges.find((e) =>
        e.source === menuNode?.id && e.kind === "sequence"
      );
      expect(fallthroughEdge).toBeDefined();
    });

    it("1c. Menu with non-jumping option (dialogue/code only) EMITS fallthrough sequence edge", async () => {
      const script = [
        "label start:",
        "    menu:",
        '        "Choice A (Code only)":',
        "            $ count += 1",
        '            "You picked option A."',
        '        "Choice B (Jump)":',
        "            jump leave_label",
        '    "Post-menu dialogue"',
        "",
        "label leave_label:",
        '    "Leaving"',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "code_option_menu.rpy",
        content: script,
      }]);

      const menuNode = result.nodes.find((n) => n.type === "MENU");
      expect(menuNode).toBeDefined();

      // Fallthrough sequence edge MUST be emitted from menu to post-menu code
      const fallthroughEdge = result.edges.find((e) =>
        e.source === menuNode?.id && e.kind === "sequence"
      );
      expect(fallthroughEdge).toBeDefined();
    });

    it("1d. Menu where ALL options have conditional jumps EMITS fallthrough sequence edge", async () => {
      const script = [
        "label start:",
        "    menu:",
        '        "Choice A":',
        "            if cond_a:",
        "                jump target_a",
        '        "Choice B":',
        "            if cond_b:",
        "                jump target_b",
        '    "Reachable if neither condition is met or after options"',
        "",
        "label target_a:",
        "    return",
        "label target_b:",
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "all_cond_jumps.rpy",
        content: script,
      }]);

      const menuNode = result.nodes.find((n) => n.type === "MENU");
      expect(menuNode).toBeDefined();

      const fallthroughEdge = result.edges.find((e) =>
        e.source === menuNode?.id && e.kind === "sequence"
      );
      expect(fallthroughEdge).toBeDefined();
    });

    it("1e. Menu fallthrough across scene boundary splitting correctly connects menu to scene split node", async () => {
      const script = [
        "label start:",
        '    "Dialogue line 1"',
        '    "Dialogue line 2"',
        '    "Dialogue line 3"',
        "    menu:",
        '        "Conditional Option":',
        "            if flag:",
        "                jump branch_target",
        '        "Unconditional Option":',
        "            jump main_target",
        '    "Post menu dialogue 1"',
        '    "Post menu dialogue 2"',
        "    scene bg new_scene",
        '    "Dialogue in scene 2"',
        "",
        "label branch_target:",
        "    return",
        "label main_target:",
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles(
        [{ name: "menu_scene_split.rpy", content: script }],
        { sceneSplitDialogueThreshold: 2 },
      );

      const menuNode = result.nodes.find((n) => n.type === "MENU");
      expect(menuNode).toBeDefined();

      // Scene split nodes should exist
      const scene2Node = result.nodes.find((n) => n.id === "start__scene_2");
      expect(scene2Node).toBeDefined();

      // Fallthrough sequence edge from menu should target scene split node or next dialogue node
      const fallthroughEdge = result.edges.find((e) =>
        e.source === menuNode?.id && e.kind === "sequence"
      );
      expect(fallthroughEdge).toBeDefined();
    });
  });

  // ── 2. Scene Statement & ATL Parsing, show/hide Handling ────────────────────

  describe("Scene / ATL Parsing & show / hide Statements", () => {
    it("2a. extractSceneAsset correctly strips trailing colons and comments", () => {
      expect(extractSceneAsset("scene bg room:")).toBe("bg room");
      expect(extractSceneAsset("scene bg room with dissolve:")).toBe("bg room");
      expect(extractSceneAsset('scene "assets/bg_room.png":')).toBe(
        "assets/bg_room.png",
      );
      expect(
        extractSceneAsset("scene bg room at top left behind char zorder 2:"),
      ).toBe("bg room");
      expect(extractSceneAsset("scene bg room # comment with trailing colon:"))
        .toBe("bg room");
      expect(extractSceneAsset("scene bg room: # comment after colon")).toBe(
        "bg room",
      );
    });

    it("2b. PARSER_TOKENS includes kwShow and kwHide", () => {
      expect(PARSER_TOKENS.kwShow).toBeTypeOf("number");
      expect(PARSER_TOKENS.kwHide).toBeTypeOf("number");
    });

    it("2c. Parses script with trailing colons in scene statements and show/hide blocks with ATL", async () => {
      const script = [
        "label start:",
        "    scene bg bedroom:",
        "        alpha 0.0",
        "        linear 2.0 alpha 1.0",
        '    "You wake up in the bedroom."',
        "    show eileen happy at center:",
        "        zoom 1.2",
        '    "Eileen smiles at you."',
        "    hide eileen with dissolve",
        '    "She leaves the room."',
        "    scene bg hallway with fade:",
        "        xalign 0.5",
        '    "You walk out into the hallway."',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "atl_show_hide.rpy",
        content: script,
      }]);

      // Verify start node exists
      const startNode = result.nodes.find((n) => n.id === "start");
      expect(startNode).toBeDefined();

      // Check scene assets extracted
      expect(result.assets).toBeDefined();
      if (result.assets) {
        const sceneAssets = result.assets.filter((a) =>
          a.type === "image" || a.type === "scene"
        );
        const assetNames = sceneAssets.map((a) => a.name);
        expect(assetNames).toContain("bg bedroom");
        expect(assetNames).toContain("bg hallway");
        // Trailing colon must NOT be in asset name
        for (const name of assetNames) {
          expect(name.endsWith(":")).toBe(false);
        }
      }
    });

    it("2d. Handles show and hide statements inside while loops and conditional blocks", async () => {
      const script = [
        "label start:",
        "    $ loop_count = 0",
        "    while loop_count < 3:",
        "        show sprite_a at left",
        '        "Loop iteration"',
        "        hide sprite_a",
        "        if loop_count == 2:",
        "          scene bg loop_end:",
        "            alpha 1.0",
        "        $ loop_count += 1",
        '    "After while loop"',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "while_show_hide.rpy",
        content: script,
      }]);

      // Check decision node for while loop exists
      const whileDecision = result.nodes.find((n) =>
        n.type === "DECISION" && n.label?.includes("while")
      );
      expect(whileDecision).toBeDefined();

      // Check sequence edges flow out of decision block
      const outgoingEdges = result.edges.filter((e) =>
        e.source === whileDecision?.id
      );
      expect(outgoingEdges.length).toBeGreaterThan(0);
    });
  });
});
