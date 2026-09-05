import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("flowchart topology and control flow hardening regressions", () => {
  it("routes subroutine returns from menu options directly to the caller's subsequent jump target", async () => {
    const script = [
      "label route_phase1:",
      '    "Select next action:"',
      "    menu:",
      '        "Option Alpha":',
      "            call subroutine_alpha",
      '        "Option Beta":',
      "            call subroutine_beta",
      "    jump route_phase2",
      "",
      "label subroutine_alpha:",
      '    "Executing subroutine alpha."',
      "    return",
      "",
      "label subroutine_beta:",
      '    "Executing subroutine beta."',
      "    return",
      "",
      "label route_phase2:",
      '    "Phase 2 continuation."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "script.rpy", content: script },
    ]);

    // Subroutine returns must go directly to the jump continuation (route_phase2)
    const returnsToContinuation = result.edges.filter(
      (e) =>
        e.kind === "call_return" &&
        (e.source === "subroutine_alpha" ||
          e.source === "subroutine_beta") &&
        e.target === "route_phase2",
    );
    expect(returnsToContinuation).toHaveLength(2);

    // There should NOT be a direct bypass jump from caller (route_phase1) to route_phase2
    const bypassJump = result.edges.find(
      (e) =>
        e.kind === "jump" &&
        e.source === "route_phase1" &&
        e.target === "route_phase2",
    );
    expect(bypassJump).toBeUndefined();
  });

  it("routes subroutine returns from conditional branches directly to the continuation label", async () => {
    const script = [
      "label conditional_hub:",
      "    if branch_flag:",
      "        call subroutine_flag_true",
      "    else:",
      "        call subroutine_flag_false",
      "    jump route_phase3",
      "",
      "label subroutine_flag_true:",
      '    "Flag true subroutine."',
      "    return",
      "",
      "label subroutine_flag_false:",
      '    "Flag false subroutine."',
      "    return",
      "",
      "label route_phase3:",
      '    "Continuation label."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "conditional.rpy", content: script },
    ]);

    const returnsToPhase3 = result.edges.filter(
      (e) =>
        e.kind === "call_return" &&
        (e.source === "subroutine_flag_true" ||
          e.source === "subroutine_flag_false") &&
        e.target === "route_phase3",
    );
    expect(returnsToPhase3).toHaveLength(2);

    const bypassJump = result.edges.find(
      (e) =>
        e.kind === "jump" &&
        e.source === "conditional_hub" &&
        e.target === "route_phase3",
    );
    expect(bypassJump).toBeUndefined();
  });

  it("does not create phantom DECISION nodes from top-level init python blocks", async () => {
    const script = [
      "init python in custom_system:",
      "    class ConfigDirector:",
      "        def __init__(self):",
      "            if True:",
      "                self.active = True",
      "            else:",
      "                self.active = False",
      "        def helper(self, x):",
      "            if x > 10:",
      "                return True",
      "            elif x > 5:",
      "                return False",
      "            return None",
      "",
      "label start:",
      '    "Story begins."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "util.rpy", content: script },
    ]);

    const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisionNodes).toHaveLength(0);

    const startNode = result.nodes.find((n) => n.id === "start");
    expect(startNode).toBeDefined();
  });

  it("suppresses fallthrough sequence edges when conditionals have exhaustive exits across all branches", async () => {
    const script = [
      "label ending_check:",
      "    if score == 0:",
      "        jump branch_ending_a",
      "    elif score < 3:",
      "        jump branch_ending_b",
      "    else:",
      "        jump branch_ending_c",
      "",
      "label branch_ending_a:",
      '    "Ending A."',
      "    return",
      "",
      "label branch_ending_b:",
      '    "Ending B."',
      "    return",
      "",
      "label branch_ending_c:",
      '    "Ending C."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "endings.rpy", content: script },
    ]);

    const fallthroughEdge = result.edges.find(
      (e) =>
        e.source === "ending_check" &&
        (e.target === "branch_ending_a" ||
          e.target === "branch_ending_b" ||
          e.target === "branch_ending_c") &&
        e.kind === "sequence",
    );
    expect(fallthroughEdge).toBeUndefined();
  });

  it("resolves cross-file jumps targeting labels that split on scene boundaries", async () => {
    const part1Script = [
      "label chapter1_end:",
      '    "End of chapter 1."',
      "    jump chapter2_start",
    ].join("\n");

    const lines = ["label chapter2_start:"];
    for (let i = 0; i < 20; i++) {
      lines.push(`    "Dialogue line ${i}"`);
    }
    lines.push("    scene bg classroom");
    lines.push('    "After classroom scene"');
    lines.push("    return");
    const part2Script = lines.join("\n");

    const result = await parseRenpyFiles([
      { name: "part1.rpy", content: part1Script },
      { name: "part2.rpy", content: part2Script },
    ]);

    const jumpEdge = result.edges.find(
      (e) => e.source === "chapter1_end" && e.kind === "jump",
    );
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge?.target).toBe("chapter2_start__scene_1");

    const unresolvedDiag = (result.diagnostics || []).find(
      (d) =>
        d.code === "unresolved_target" &&
        d.location?.targetId === "chapter2_start",
    );
    expect(unresolvedDiag).toBeUndefined();
  });

  it("detects prefixed start labels as root and marks unreferenced dead-code labels as orphans", async () => {
    const script = [
      "label sc_custom_start:",
      '    "Scenario entry point."',
      "    jump main_story",
      "",
      "label main_story:",
      '    "Progressing story."',
      "    jump conclusion_ending",
      "",
      "label conclusion_ending:",
      '    "Reached conclusion."',
      "    return",
      "",
      "label unreferenced_dead_ending:",
      '    "This label is never reached."',
      "    jump conclusion_ending",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "story.rpy", content: script },
    ]);

    const startNode = result.nodes.find((n) => n.id === "sc_custom_start");
    expect(startNode).toBeDefined();
    expect(startNode?.isOrphan).toBeUndefined();

    const deadNode = result.nodes.find((n) =>
      n.id === "unreferenced_dead_ending"
    );
    expect(deadNode).toBeDefined();
    expect(deadNode?.isOrphan).toBe(true);
  });
});
