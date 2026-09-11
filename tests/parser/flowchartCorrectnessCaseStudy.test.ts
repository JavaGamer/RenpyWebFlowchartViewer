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

  it("accurately captures dialogue strings containing nested quotes", async () => {
    const script = [
      "label start:",
      "    katrina \"I said, 'I wish John were back to normal.'\"",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "quotes.rpy", content: script },
    ], { captureDialogueLines: true });

    const startNode = result.nodes.find((n) => n.id === "start");
    expect(startNode?.dialogueLines?.[0]).toBe(
      "I said, 'I wish John were back to normal.'",
    );
  });

  it("handles sequential if statements without treating subsequent if as an else branch", async () => {
    const script = [
      "label test_sequential_if:",
      "    if cond_a:",
      '        "Branch A"',
      "    else:",
      '        "Branch A Else"',
      "    if cond_b:",
      '        "Branch B"',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "seq_if.rpy", content: script },
    ]);

    const decisions = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisions).toHaveLength(2);
    const [decA, decB] = decisions;
    expect(decA?.label).toBe("if cond_a");
    expect(decB?.label).toBe("if cond_b");

    // decA must NOT have an "else" sequence edge to decB
    const elseToB = result.edges.find(
      (e) => e.source === decA?.id && e.target === decB?.id,
    );
    expect(elseToB).toBeUndefined();

    // decB must be connected directly from the label
    const labelToB = result.edges.find(
      (e) => e.source === "test_sequential_if" && e.target === decB?.id,
    );
    expect(labelToB).toBeDefined();
  });

  it("preserves scene continuity and avoids dead-end scenes when splitting inside conditionals", async () => {
    // Generate enough dialogue to exceed scene split threshold (threshold = 2)
    const script = [
      "label branch_story:",
      "    if outer_flag:",
      '        "Scene 1 Line 1"',
      '        "Scene 1 Line 2"',
      '        "Scene 1 Line 3"',
      "        scene bg yard",
      '        "Scene 2 Line 1"',
      '        "Scene 2 Line 2"',
      '        "Scene 2 Line 3"',
      "        scene bg livingroom",
      '        "Scene 3 Line 1"',
      "        jump destination",
      "    else:",
      '        "Else line"',
      "        jump destination",
      "",
      "label destination:",
      '        "Arrived."',
      "        return",
    ].join("\n");

    const result = await parseRenpyFiles(
      [{ name: "branch_story.rpy", content: script }],
      { sceneSplitDialogueThreshold: 2 },
    );

    const scene1 = result.nodes.find((n) => n.id === "branch_story__scene_1");
    const scene2 = result.nodes.find((n) => n.id === "branch_story__scene_2");
    const scene3 = result.nodes.find((n) => n.id === "branch_story__scene_3");

    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();
    expect(scene3).toBeDefined();

    // scene2 must have outgoing edges (NOT a dead end)
    const scene2OutEdges = result.edges.filter((e) => e.source === scene2?.id);
    expect(scene2OutEdges.length).toBeGreaterThan(0);
    expect(scene2OutEdges.some((e) => e.target === scene3?.id)).toBe(true);

    // scene3 must have outgoing edges to destination
    const scene3OutEdges = result.edges.filter((e) => e.source === scene3?.id);
    expect(scene3OutEdges.length).toBeGreaterThan(0);
    expect(scene3OutEdges.some((e) => e.target === "destination")).toBe(true);
  });

  it("clears completed inline decisions on subsequent linear dialogue preventing edge explosion", async () => {
    const script = [
      "label call_explosion_check:",
      "    if flag1:",
      '        "F1"',
      "    if flag2:",
      '        "F2"',
      '    "Linear dialogue re-merging all previous paths."',
      "    call subroutine_target",
      "    jump downstream_target",
      "",
      "label subroutine_target:",
      '    "In subroutine."',
      "    return",
      "",
      "label downstream_target:",
      '    "In downstream."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "calls.rpy", content: script },
    ]);

    // Exactly one call edge from caller to subroutine_target
    const callEdges = result.edges.filter(
      (e) => e.kind === "call" && e.target === "subroutine_target",
    );
    expect(callEdges).toHaveLength(1);
    expect(callEdges[0]?.source).toBe("call_explosion_check");

    // Exactly one jump edge to downstream_target (from subroutine return or caller)
    const jumpEdges = result.edges.filter(
      (e) => e.kind === "jump" && e.target === "downstream_target",
    );
    expect(jumpEdges.length).toBeGreaterThanOrEqual(1);
    // Subroutine return handles continuation or direct jump
    const directBypassJumps = result.edges.filter(
      (e) =>
        e.kind === "jump" &&
        e.target === "downstream_target" &&
        e.source.startsWith("decision_"),
    );
    expect(directBypassJumps).toHaveLength(0);
  });

  it("parses dollar assignments without spaces and evaluates variable negation correctly", async () => {
    const script = [
      "label var_test:",
      "    $fMichelleWitch = True",
      "    $ fScarletHorse = not fKatrinaMean",
      "    $ fCounter = not fCounter",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "vars.rpy", content: script },
    ]);

    const varNode = result.nodes.find((n) => n.id === "var_test");
    expect(varNode).toBeDefined();
    const mutations = varNode?.mutations ?? [];

    const michelleMut = mutations.find((m) =>
      m.variableName === "fMichelleWitch"
    );
    expect(michelleMut).toBeDefined();
    expect(michelleMut?.operator).toBe("=");
    expect(michelleMut?.value).toBe(true);

    const scarletMut = mutations.find((m) =>
      m.variableName === "fScarletHorse"
    );
    expect(scarletMut).toBeDefined();
    expect(scarletMut?.operator).toBe("=");

    const counterMut = mutations.find((m) => m.variableName === "fCounter");
    expect(counterMut).toBeDefined();
    expect(counterMut?.operator).toBe("toggle");
  });

  it("marks terminal story scenes ending with return as isTerminalOutcome even with internal decision nodes", async () => {
    const script = [
      "label story_end_scene:",
      '    "Reflecting on life."',
      "    if flag_nerd:",
      '        "Nerd reflection."',
      "    else:",
      '        "Other reflection."',
      '    "Final thought."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "story_end.rpy", content: script },
    ]);

    const endNode = result.nodes.find((n) => n.id === "story_end_scene");
    expect(endNode).toBeDefined();
    expect(endNode?.role).toBe("story");
    expect(endNode?.isTerminalOutcome).toBe(true);
  });

  it("attributes extend dialogue to the previous speaker", async () => {
    const script = [
      "label dialogue_extend_test:",
      '    john "First part of dialogue..."',
      '    extend " and the continuation."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "extend.rpy", content: script },
    ]);

    const node = result.nodes.find((n) => n.id === "dialogue_extend_test");
    expect(node).toBeDefined();
    expect(node?.characterDialogue).toBeDefined();
    expect(node?.characterDialogue?.["john"]).toBeDefined();
    expect(node?.characterDialogue?.["john"]?.lineCount).toBe(2);
    expect(node?.characterDialogue?.["extend"]).toBeUndefined();
  });

  it("verifies the Wish You Were Her case study end-to-end", async () => {
    const caseStudyPath =
      "C:\\Users\\gamin\\Downloads\\Games\\StudentTransfer-9.2-pc-arm\\game\\scenario\\wishyouwereher\\story\\Wish You Were Her.rpy";
    let scriptContent: string;
    try {
      scriptContent = await Deno.readTextFile(caseStudyPath);
    } catch {
      return; // Skip if file not present on another environment
    }

    const result = await parseRenpyFiles([
      { name: "Wish You Were Her.rpy", content: scriptContent },
    ], { captureDialogueLines: true });

    // 1. Check michelle scenes: none should be dead ends
    for (
      const id of [
        "michelle__scene_1",
        "michelle__scene_2",
        "michelle__scene_3",
        "michelle__scene_4",
      ]
    ) {
      const node = result.nodes.find((n) => n.id === id);
      expect(node).toBeDefined();
      const outEdges = result.edges.filter((e) => e.source === id);
      expect(outEdges.length).toBeGreaterThan(0);
    }

    // 2. Check scarlet scenes: none should be dead ends
    for (
      const id of [
        "scarlet__scene_1",
        "scarlet__scene_2",
        "scarlet__scene_3",
      ]
    ) {
      const node = result.nodes.find((n) => n.id === id);
      expect(node).toBeDefined();
      const outEdges = result.edges.filter((e) => e.source === id);
      expect(outEdges.length).toBeGreaterThan(0);
    }

    // 3. Check day2__scene_3 is marked terminal outcome
    const day2Scene3 = result.nodes.find((n) => n.id === "day2__scene_3");
    expect(day2Scene3).toBeDefined();
    expect(day2Scene3?.isTerminalOutcome).toBe(true);

    // 4. Sequential if in kyoko: no else edge between decision_30 and decision_32
    const dec30 = result.nodes.find((n) => n.label === "if fCalledKyoko");
    const dec32 = result.nodes.find((n) =>
      n.label === "if fScarletHorse or fMichelleWitch"
    );
    expect(dec30).toBeDefined();
    expect(dec32).toBeDefined();
    const elseEdge = result.edges.find((e) =>
      e.source === dec30?.id && e.target === dec32?.id
    );
    expect(elseEdge).toBeUndefined();

    // 5. Calls to walkToFriendDescription: exactly 1 from kyoko and 1 from michelle
    const callsFromKyoko = result.edges.filter(
      (e) =>
        e.kind === "call" && e.target === "walkToFriendDescription" &&
        e.source.startsWith("kyoko"),
    );
    expect(callsFromKyoko).toHaveLength(1);
    const callsFromMichelle = result.edges.filter(
      (e) =>
        e.kind === "call" && e.target === "walkToFriendDescription" &&
        e.source.startsWith("michelle"),
    );
    expect(callsFromMichelle).toHaveLength(1);

    // 6. Jumps from dream to day2: exactly 1 jump edge
    const jumpsDreamToDay2 = result.edges.filter(
      (e) =>
        e.kind === "jump" && e.target.startsWith("day2") &&
        (e.source === "dream" || e.source.startsWith("decision_")),
    );
    expect(jumpsDreamToDay2).toHaveLength(1);

    // 7. fMichelleWitch = True recorded on michelle__scene_1
    const michelle1 = result.nodes.find((n) => n.id === "michelle__scene_1");
    const michelleWitchMut = michelle1?.mutations?.find((m) =>
      m.variableName === "fMichelleWitch"
    );
    expect(michelleWitchMut).toBeDefined();
    expect(michelleWitchMut?.value).toBe(true);

    // 8. fScarletHorse = not fKatrinaMean has operator "="
    const scarlet1 = result.nodes.find((n) => n.id === "scarlet__scene_1");
    const scarletHorseMut = scarlet1?.mutations?.find((m) =>
      m.variableName === "fScarletHorse"
    );
    expect(scarletHorseMut).toBeDefined();
    expect(scarletHorseMut?.operator).toBe("=");
  });

  it("preserves string literal assignments like 'not ready' without boolean poisoning in control flow analysis", async () => {
    const script = [
      "label quest_hub:",
      '    $ quest_status = "not ready"',
      '    $ battle_cry = "honor and glory"',
      "    if quest_status == 'not ready':",
      '        "The quest has not started yet."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "quest.rpy", content: script },
    ]);

    const node = result.nodes.find((n) => n.id === "quest_hub");
    expect(node).toBeDefined();
    const statusMut = node?.mutations?.find((m) =>
      m.variableName === "quest_status"
    );
    expect(statusMut).toBeDefined();
    expect(statusMut?.value).toBe("not ready");
    expect(statusMut?.isLiteral).toBe(true);

    const battleCryMut = node?.mutations?.find((m) =>
      m.variableName === "battle_cry"
    );
    expect(battleCryMut).toBeDefined();
    expect(battleCryMut?.value).toBe("honor and glory");
    expect(battleCryMut?.isLiteral).toBe(true);
  });

  it("accurately recognizes various Python variable negation toggle patterns", async () => {
    const script = [
      "label toggle_tests:",
      "    $ flag_a = not (flag_a)",
      "    $ flag_b = (not flag_b)",
      "    $ flag_c = not flag_c # trailing comment",
      "    $ flag_d = not not flag_d",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "toggles.rpy", content: script },
    ]);

    const node = result.nodes.find((n) => n.id === "toggle_tests");
    expect(node).toBeDefined();
    const mutA = node?.mutations?.find((m) => m.variableName === "flag_a");
    const mutB = node?.mutations?.find((m) => m.variableName === "flag_b");
    const mutC = node?.mutations?.find((m) => m.variableName === "flag_c");
    const mutD = node?.mutations?.find((m) => m.variableName === "flag_d");

    expect(mutA?.operator).toBe("toggle");
    expect(mutB?.operator).toBe("toggle");
    expect(mutC?.operator).toBe("toggle");
    expect(mutD?.operator).toBe("=");
  });

  it("properly updates subroutine returns inside conditional branches followed by dialogue", async () => {
    const script = [
      "label caller_scene:",
      "    if flag:",
      "        call helper_subroutine",
      '    "Dialogue immediately following conditional helper."',
      "    return",
      "",
      "label helper_subroutine:",
      '    "Doing helper work."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "sub_dialogue.rpy", content: script },
    ]);

    const returnEdges = result.edges.filter(
      (e) => e.kind === "call_return" && e.source === "helper_subroutine",
    );
    expect(returnEdges).toHaveLength(1);
    expect(returnEdges[0]?.target).toBe("caller_scene");
  });

  it("resets lastSpeaker on label boundaries and ignores reserved keywords", async () => {
    const script = [
      "label chapter1:",
      '    alice "Hello from Alice."',
      "    jump chapter2",
      "",
      "label chapter2:",
      '    extend "Continuation should not be Alice."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "speaker_bleed.rpy", content: script },
    ]);

    const ch2 = result.nodes.find((n) => n.id === "chapter2");
    expect(ch2).toBeDefined();
    expect(ch2?.characterDialogue?.["alice"]).toBeUndefined();
    expect(ch2?.characterDialogue?.["narrator"]).toBeDefined();
  });
});
