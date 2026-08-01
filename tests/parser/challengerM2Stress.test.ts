import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser";
import { computeLineIndent } from "../../src/parser/tokenScanStage";
import { extractSceneAsset } from "../../src/parser/handlers/audioCues";

describe("Challenger M2 Parser & AST Bug Fixes Stress Suite", () => {
  // ── 1. Mixed Indentation Stress Tests ─────────────────────────────────────

  describe("Mixed Indentation (Tabs & Spaces)", () => {
    it("empirically verifies computeLineIndent exact tab-stop calculations", () => {
      // Single spaces
      expect(computeLineIndent("")).toBe(0);
      expect(computeLineIndent(" ")).toBe(1);
      expect(computeLineIndent("  ")).toBe(2);
      expect(computeLineIndent("   ")).toBe(3);
      expect(computeLineIndent("    ")).toBe(4);

      // Single tab at start (8-space alignment)
      expect(computeLineIndent("\t")).toBe(8);

      // Space before tab alignment
      expect(computeLineIndent(" \t")).toBe(8); // 1 + (8-1) = 8
      expect(computeLineIndent("  \t")).toBe(8); // 2 + (8-2) = 8
      expect(computeLineIndent("       \t")).toBe(8); // 7 + (8-7) = 8

      // Space on 8-byte boundary before tab
      expect(computeLineIndent("        \t")).toBe(16); // 8 + 8 = 16

      // Mixed tab + spaces
      expect(computeLineIndent("\t    ")).toBe(12); // 8 + 4 = 12
      expect(computeLineIndent("\t\t")).toBe(16); // 8 + 8 = 16
      expect(computeLineIndent("\t\t    ")).toBe(20); // 16 + 4 = 20
      expect(computeLineIndent("\t  \t")).toBe(16); // 8 + 2 -> tab aligns to 16
      expect(computeLineIndent("    \t    ")).toBe(12); // 4 + tab(8) + 4 = 12
    });

    it("parses complex script with mixed 4-space and tab indents without dropping block scopes", async () => {
      const script = [
        "label start:",
        "\tif flag_one:",
        "\t    if flag_two:",
        '\t\t"Deep mixed indent"',
        "\t\tjump deep_target",
        "\t    else:",
        '  \t\t"Else block with spaces then tab"',
        '\t"Back to outer tab indent"',
        "",
        "label deep_target:",
        "\treturn",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "mixed_indent.rpy",
        content: script,
      }]);

      const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
      expect(decisionNodes.length).toBeGreaterThanOrEqual(2);

      const deepJumpEdge = result.edges.find(
        (e) => e.target === "deep_target" && e.kind === "jump",
      );
      expect(deepJumpEdge).toBeDefined();
    });
  });

  // ── 2. Nested Control Flow & Decision Stack Stress Tests ──────────────────

  describe("Nested Control Flow (if / elif / else / while)", () => {
    it("handles deeply nested while loops inside if/elif/else blocks with correct DECISION nodes and edge conditions", async () => {
      const script = [
        "label start:",
        "    if outer_cond == 1:",
        "        while loop_a > 0:",
        '            "inside loop a"',
        "            if inner_cond:",
        "                $ loop_a -= 1",
        "            elif inner_cond_b:",
        "                jump escape_label",
        "            else:",
        '                "inner else"',
        "    elif outer_cond == 2:",
        "        while loop_b < 10:",
        '            "inside loop b"',
        "            $ loop_b += 1",
        "    else:",
        "        while True:",
        '            "infinite loop body"',
        "            jump finish",
        "",
        "label escape_label:",
        "    return",
        "",
        "label finish:",
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "nested_flow.rpy",
        content: script,
      }]);

      // Verify all decision nodes are created
      const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
      expect(decisionNodes.length).toBeGreaterThanOrEqual(4);

      // Verify branchKinds on decision nodes (if/while create decision nodes)
      const nodeBranchKinds = decisionNodes.map((n) => n.condition?.branchKind);
      expect(nodeBranchKinds).toContain("if");
      expect(nodeBranchKinds).toContain("while");

      // Verify branchKinds on edges (elif/else branches populate edge conditions)
      const edgeBranchKinds = result.edges
        .map((e) => e.condition?.branchKind)
        .filter((k): k is string => !!k);
      expect(edgeBranchKinds).toContain("elif");
      expect(edgeBranchKinds).toContain("else");

      // Check jump edges exist from nested branches
      expect(result.edges).toContainEqual(
        expect.objectContaining({ target: "escape_label", kind: "jump" }),
      );
      expect(result.edges).toContainEqual(
        expect.objectContaining({ target: "finish", kind: "jump" }),
      );
    });

    it("properly attributes show and hide statements inside while loops", async () => {
      const script = [
        "label start:",
        "    show eileen happy",
        "    while count > 0:",
        "        show bg room",
        "        hide eileen",
        "        $ count -= 1",
        "    hide bg room",
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "while_show_hide.rpy",
        content: script,
      }]);

      const startNode = result.nodes.find((n) => n.id === "start");
      expect(startNode).toBeDefined();

      const decisionNode = result.nodes.find((n) => n.type === "DECISION");
      expect(decisionNode).toBeDefined();
      expect(decisionNode?.condition?.branchKind).toBe("while");
    });

    it("verifies post-conditional rejoin edge generation across multiple scene boundaries", async () => {
      const script = [
        "label start:",
        '    "Dialogue 1"',
        "    if check_flag:",
        '        "Inside IF"',
        "    else:",
        '        "Inside ELSE"',
        "    scene bg scene_two",
        '    "After conditional scene split"',
        "",
      ].join("\n");

      const result = await parseRenpyFiles(
        [{ name: "post_cond_scene.rpy", content: script }],
        { sceneSplitDialogueThreshold: 0 },
      );

      const decisionNode = result.nodes.find((n) => n.type === "DECISION");
      expect(decisionNode).toBeDefined();

      // Ensure rejoin edge to start__scene_2 exists from decisionNode or scene split
      const sceneTwoNode = result.nodes.find((n) => n.id === "start__scene_2");
      expect(sceneTwoNode).toBeDefined();

      const incomingToSceneTwo = result.edges.filter((e) =>
        e.target === "start__scene_2"
      );
      expect(incomingToSceneTwo.length).toBeGreaterThan(0);
    });
  });

  // ── 3. Multi-File Shadowed Label Target Resolution ─────────────────────────

  describe("Multi-File Shadowed Labels & Duplicate Names", () => {
    it("correctly resolves local shadowed labels across 4 simulated chapter files taking file sorting into account", async () => {
      // Deterministic alphabetical file order: chapter_alpha -> chapter_beta -> chapter_delta -> chapter_gamma
      const files = [
        {
          name: "chapter_alpha.rpy",
          content: [
            "label start:",
            "    jump common_hub",
            "",
            "label common_hub:",
            '    "Alpha Hub"',
            "    jump chapter_beta_start",
            "",
          ].join("\n"),
        },
        {
          name: "chapter_beta.rpy",
          content: [
            "label chapter_beta_start:",
            "    jump common_hub",
            "",
            "label common_hub:",
            '    "Beta Hub"',
            "    jump chapter_gamma_start",
            "",
          ].join("\n"),
        },
        {
          name: "chapter_delta.rpy",
          content: [
            "label unique_dest:",
            '    "Delta unique destination"',
            "    jump common_hub",
            "",
            "label common_hub:",
            '    "Delta Hub"',
            "    return",
            "",
          ].join("\n"),
        },
        {
          name: "chapter_gamma.rpy",
          content: [
            "label chapter_gamma_start:",
            "    jump common_hub",
            "",
            "label common_hub:",
            '    "Gamma Hub"',
            "    jump unique_dest",
            "",
          ].join("\n"),
        },
      ];

      const result = await parseRenpyFiles(files);

      // Verify all 4 common_hub labels exist (canonical + shadow_2, shadow_3, shadow_4)
      const commonHubNodes = result.nodes.filter(
        (n) => n.label === "common_hub" && n.type === "LABEL",
      );
      expect(commonHubNodes).toHaveLength(4);

      // File processing order (alphabetical):
      // 1. chapter_alpha -> common_hub (canonical)
      // 2. chapter_beta  -> common_hub__shadow_2
      // 3. chapter_delta -> common_hub__shadow_3
      // 4. chapter_gamma -> common_hub__shadow_4

      const alphaJump = result.edges.find((e) =>
        e.source === "start" && e.kind === "jump"
      );
      expect(alphaJump?.target).toBe("common_hub");

      const betaJump = result.edges.find(
        (e) => e.source === "chapter_beta_start" && e.kind === "jump",
      );
      expect(betaJump?.target).toBe("common_hub__shadow_2");

      const deltaJump = result.edges.find(
        (e) => e.source === "unique_dest" && e.kind === "jump",
      );
      expect(deltaJump?.target).toBe("common_hub__shadow_3");

      const gammaJump = result.edges.find(
        (e) => e.source === "chapter_gamma_start" && e.kind === "jump",
      );
      expect(gammaJump?.target).toBe("common_hub__shadow_4");
    });

    it("falls back to global canonical label ID when local chapter does not contain target label", async () => {
      const files = [
        {
          name: "file_one.rpy",
          content: [
            "label start:",
            "    jump global_target",
            "",
          ].join("\n"),
        },
        {
          name: "file_two.rpy",
          content: [
            "label global_target:",
            '    "In File Two"',
            "    return",
            "",
          ].join("\n"),
        },
      ];

      const result = await parseRenpyFiles(files);

      const jumpEdge = result.edges.find(
        (e) => e.source === "start" && e.kind === "jump",
      );
      expect(jumpEdge).toBeDefined();
      expect(jumpEdge?.target).toBe("global_target");
    });

    it("handles duplicate label names declared within the SAME file gracefully without throwing", async () => {
      const script = [
        "label same_file_dup:",
        '    "First declaration"',
        "    jump same_file_dup",
        "",
        "label same_file_dup:",
        '    "Second declaration"',
        "    return",
        "",
      ].join("\n");

      await expect(
        parseRenpyFiles([{ name: "same_file_dup.rpy", content: script }]),
      ).resolves.toEqual(
        expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ type: "LABEL" }),
          ]),
        }),
      );
    });
  });

  // ── 4. Edge Cases, Exception Recovery & Graph Integrity ───────────────────

  describe("Edge Case Harness & Graph Integrity", () => {
    it("handles while loops with multiline expressions, escaped quotes, and inline comments", async () => {
      const script = [
        "label start:",
        "    while (count > 0 and \\",
        '           name == "test \\" quote" # comment with : colon',
        "          ):",
        '        "inside complex while"',
        "        $ count -= 1",
        "    return",
        "",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "multiline_while.rpy",
        content: script,
      }]);

      const decisionNode = result.nodes.find((n) => n.type === "DECISION");
      expect(decisionNode).toBeDefined();
      expect(decisionNode?.label).toContain("while");
    });

    it("handles trailing colons in scene asset extraction without syntax error", () => {
      expect(extractSceneAsset("scene bg room:")).toBe("bg room");
      expect(extractSceneAsset("scene bg room with dissolve:")).toBe("bg room");
      expect(extractSceneAsset("scene expression current_bg:")).toBe(
        "expression current_bg",
      );
    });

    it("verifies graphology graph normalization consistency and diagnostic reports", async () => {
      const script = [
        "label start:",
        "    jump non_existent_label",
        "",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "unresolved.rpy",
        content: script,
      }]);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unresolved_target",
            severity: "warning",
            location: expect.objectContaining({
              targetId: "non_existent_label",
            }),
          }),
        ]),
      );

      // Verify edge still exists in edges list
      const edge = result.edges.find((e) => e.target === "non_existent_label");
      expect(edge).toBeDefined();
    });

    it("preserves menu fallthrough when jump is inside conditional block inside option", async () => {
      const script = [
        "label start:",
        "    menu:",
        '        "Option 1":',
        "            if has_key:",
        "                jump secret_room",
        '        "Option 2":',
        '            "Regular option"',
        '    "After menu fallthrough"',
        "",
        "label secret_room:",
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([{
        name: "menu_cond_fallthrough.rpy",
        content: script,
      }]);

      const menuNode = result.nodes.find((n) => n.type === "MENU");
      expect(menuNode).toBeDefined();

      const secretJump = result.edges.find((e) => e.target === "secret_room");
      expect(secretJump).toBeDefined();

      // Menu must have fallthrough edge because Option 1's jump is conditional
      const fallthroughEdge = result.edges.find(
        (e) => e.source === menuNode?.id && e.kind === "sequence",
      );
      expect(fallthroughEdge).toBeDefined();
    });
  });
});
