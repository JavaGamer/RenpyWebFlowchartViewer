import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Deep Static Code Analysis & Script Linting", () => {
  describe("Dead State & Unused Flag Audit", () => {
    it("flags variables defined with default/define/$ that are never evaluated", async () => {
      const files = [
        {
          name: "unused_var.rpy",
          content: `
default unused_default_flag = False
define unused_define_val = 42

label start:
    $ unused_local_var = "never used"
    $ used_flag = True
    if used_flag:
        "Flag was used!"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const unusedDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "unused_variable",
      );
      expect(unusedDiagnostics).toBeDefined();
      expect(unusedDiagnostics?.length).toBe(3);

      const details = unusedDiagnostics?.map((d) => d.context?.detail);
      expect(details).toContain("unused_default_flag");
      expect(details).toContain("unused_define_val");
      expect(details).toContain("unused_local_var");
      expect(details).not.toContain("used_flag");
    });

    it("does not flag variables that are interpolated into dialogue text", async () => {
      const files = [
        {
          name: "interpolated.rpy",
          content: `
default player_name = "Hero"
default score = 100

label start:
    "Welcome, [player_name]!"
    "Your current score is [score] points."
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const unusedDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "unused_variable",
      );
      expect(unusedDiagnostics ?? []).toHaveLength(0);
    });

    it("does not flag variables read on RHS of assignments", async () => {
      const files = [
        {
          name: "rhs_usage.rpy",
          content: `
default base_points = 10
default total_points = 0

label start:
    $ total_points = base_points + 5
    if total_points > 10:
        "Great job!"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const unusedDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "unused_variable",
      );
      expect(unusedDiagnostics ?? []).toHaveLength(0);
    });
  });

  describe("Undeclared Conditional Variable Audit", () => {
    it("flags variables evaluated in if/elif but never declared or assigned", async () => {
      const files = [
        {
          name: "undeclared.rpy",
          content: `
label start:
    if secret_unassigned_flag:
        "Secret path"
    elif unknown_stat > 50:
        "High stat"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const undeclaredDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "undeclared_variable",
      );
      expect(undeclaredDiagnostics).toBeDefined();
      expect(undeclaredDiagnostics?.length).toBeGreaterThanOrEqual(2);

      const details = undeclaredDiagnostics?.map((d) => d.context?.detail);
      expect(details).toContain("secret_unassigned_flag");
      expect(details).toContain("unknown_stat");
    });

    it("does not flag declared variables, label parameters, or engine built-ins", async () => {
      const files = [
        {
          name: "valid_vars.rpy",
          content: `
default is_unlocked = False
default persistent.game_cleared = False

label start:
    $ assigned_var = 10
    if is_unlocked and persistent.game_cleared:
        "Unlocked!"
    if assigned_var > 5:
        "Assigned!"
    if renpy.music.is_playing() or config.developer or _return:
        "Engine condition"
    call sub_label(param_flag=True)
    return

label sub_label(param_flag=False):
    if param_flag:
        "Param is true"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const undeclaredDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "undeclared_variable",
      );
      expect(undeclaredDiagnostics ?? []).toHaveLength(0);
    });

    it("handles tuple unpacking mutations and prevents false undeclared/unused warnings", async () => {
      const files = [
        {
          name: "tuple_unpacking.rpy",
          content: `
label start:
    $ coord_x, coord_y = (10, 20)
    if coord_x > 5 and coord_y > 15:
        "Coordinates match!"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const undeclared = result.diagnostics?.filter(
        (d) => d.context?.category === "undeclared_variable",
      );
      const unused = result.diagnostics?.filter(
        (d) => d.context?.category === "unused_variable",
      );
      expect(undeclared ?? []).toHaveLength(0);
      expect(unused ?? []).toHaveLength(0);
    });

    it("evaluates variables and assignments in python blocks correctly", async () => {
      const files = [
        {
          name: "python_block.rpy",
          content: `
default secret_code = "xyz"
default unlocked = False

label start:
    python:
        if secret_code == "xyz":
            unlocked = True
    if unlocked:
        "Access granted!"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const unused = result.diagnostics?.filter(
        (d) => d.context?.category === "unused_variable",
      );
      const undeclared = result.diagnostics?.filter(
        (d) => d.context?.category === "undeclared_variable",
      );
      expect(unused ?? []).toHaveLength(0);
      expect(undeclared ?? []).toHaveLength(0);
    });

    it("correctly treats for loop target variables as declared", async () => {
      const files = [
        {
          name: "for_loops.rpy",
          content: `
default inventory = ["potion", "sword"]

label start:
    for item in inventory:
        if item == "sword":
            "Found sword!"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const undeclared = result.diagnostics?.filter(
        (d) => d.context?.category === "undeclared_variable",
      );
      const unused = result.diagnostics?.filter(
        (d) => d.context?.category === "unused_variable",
      );
      expect(undeclared ?? []).toHaveLength(0);
      expect(unused ?? []).toHaveLength(0);
    });

    it("does not duplicate variable mutations in python blocks", async () => {
      const files = [
        {
          name: "python_mutations.rpy",
          content: `
default points = 0

label start:
    python:
        points += 1
    menu:
        "Correct Choice" if points == 1:
            jump win
        "Duplicate Bug Choice" if points == 2:
            jump dead_end

label win:
    "You won!"
    return

label dead_end:
    "Dead end!"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      // Verify node mutations count in start label is exactly 1 (not duplicated to 2)
      const startMutations = result.nodeMutations?.get("start");
      expect(startMutations).toBeDefined();
      expect(startMutations).toHaveLength(1);
      expect(startMutations![0]!.variableName).toBe("points");
      expect(startMutations![0]!.operator).toBe("+=");

      // Ensure points == 1 was evaluated with points = 1 (not 2 from duplication)
      // The edge for "Duplicate Bug Choice" (points == 2) should be statically false
      const bugChoiceEdge = result.edges.find((e) =>
        e.label === "Duplicate Bug Choice"
      );
      expect(bugChoiceEdge?.conditionIsStaticallyFalse).toBe(true);

      const correctChoiceEdge = result.edges.find((e) =>
        e.label === "Correct Choice"
      );
      expect(correctChoiceEdge?.conditionIsStaticallyFalse).toBeFalsy();
    });
  });

  describe("Call Stack Depth Warnings", () => {
    it("detects nested call chains that exceed the configured safe call stack depth limit", async () => {
      const files = [
        {
          name: "call_depth.rpy",
          content: `
label start:
    call sub_a
    return

label sub_a:
    call sub_b

label sub_b:
    call sub_c

label sub_c:
    call sub_d

label sub_d:
    "Leaf subroutine"
    return
`,
        },
      ];

      // Configure a low limit of 3 to test detection
      const result = await parseRenpyFiles(files, { maxCallStackDepth: 3 });

      const depthDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "excessive_call_depth",
      );
      expect(depthDiagnostics).toBeDefined();
      expect(depthDiagnostics?.length).toBeGreaterThan(0);
      expect(depthDiagnostics![0]!.message).toContain("safe limit (3)");
      expect(depthDiagnostics![0]!.message).toContain("sub_d");
    });

    it("does not warn when call chains remain within the safe depth limit", async () => {
      const files = [
        {
          name: "safe_depth.rpy",
          content: `
label start:
    call sub_1
    return

label sub_1:
    call sub_2
    return

label sub_2:
    "Leaf"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files, { maxCallStackDepth: 5 });

      const depthDiagnostics = result.diagnostics?.filter(
        (d) => d.context?.category === "excessive_call_depth",
      );
      expect(depthDiagnostics ?? []).toHaveLength(0);
    });
  });

  describe("Enhanced Dynamic Target Fallbacks", () => {
    it("resolves dynamic jumps with suffix patterns matching project labels", async () => {
      const files = [
        {
          name: "dynamic_suffix.rpy",
          content: `
label start:
    jump expression (route_name + "_ending")

label alice_ending:
    "Alice Ending"
    return

label bob_ending:
    "Bob Ending"
    return

label unrelated_label:
    "Unrelated"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const jumpEdges = result.edges.filter((e) => e.kind === "jump");
      const targetIds = jumpEdges.map((e) => e.target);
      expect(targetIds).toContain("alice_ending");
      expect(targetIds).toContain("bob_ending");
      expect(targetIds).not.toContain("unrelated_label");

      const dynamicDiagnostics = result.diagnostics?.filter(
        (d) => d.code === "dynamic_target",
      );
      expect(dynamicDiagnostics ?? []).toHaveLength(0);
    });

    it("resolves dynamic jumps with prefix and suffix combined", async () => {
      const files = [
        {
          name: "dynamic_template.rpy",
          content: `
label start:
    jump expression ("act_" + str(act_num) + "_scene")

label act_1_scene:
    "Act 1 Scene"
    return

label act_2_scene:
    "Act 2 Scene"
    return

label act_1_boss:
    "Act 1 Boss"
    return
`,
        },
      ];

      const result = await parseRenpyFiles(files);

      const jumpEdges = result.edges.filter((e) => e.kind === "jump");
      const targetIds = jumpEdges.map((e) => e.target);
      expect(targetIds).toContain("act_1_scene");
      expect(targetIds).toContain("act_2_scene");
      expect(targetIds).not.toContain("act_1_boss");
    });
  });
});
