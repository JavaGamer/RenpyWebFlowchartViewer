import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("timedchoice and fallthrough menu flowchart topology regressions", () => {
  it("1. timedchoice followed by menu: emits timeout jump edge originating from menu node with timeout metadata", async () => {
    const script = [
      "label scenario_main:",
      "    scene bg room_a with fade",
      '    "Intro dialogue in scene 1."',
      "    scene bg room_b",
      '    "More dialogue before timed choice."',
      '    $ timedchoice(3.0, "route_timeout")',
      "    menu:",
      '        "Option Alpha":',
      '            "You selected option alpha."',
      "    scene bg room_c",
      '    "Continuing after choice."',
      "",
      "label route_timeout:",
      '    "You hesitated for too long."',
      "    $ gameover()",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "timedchoice_menu.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // The timeout jump MUST originate from the menu node, not the pre-menu scene
    const timeoutJump = result.edges.find(
      (e) =>
        e.source === menuNode?.id && e.kind === "jump" &&
        e.target === "route_timeout",
    );
    expect(timeoutJump).toBeDefined();
    expect(timeoutJump?.timeout).toEqual({
      isTimeout: true,
      durationSeconds: 3.0,
    });

    // The pre-menu scene must connect to the menu node via sequence edge
    const preMenuSceneEdge = result.edges.find(
      (e) => e.target === menuNode?.id && e.kind === "sequence",
    );
    expect(preMenuSceneEdge).toBeDefined();
    expect(preMenuSceneEdge?.source).toBe("scenario_main__scene_2");

    // The pre-menu scene must NOT have a timeout jump directly to route_timeout
    const leakedJump = result.edges.find(
      (e) =>
        e.source === "scenario_main__scene_2" &&
        e.target === "route_timeout",
    );
    expect(leakedJump).toBeUndefined();
  });

  it("1b. standalone timedchoice not followed by menu: flushes jump edge from current label", async () => {
    const script = [
      "label standalone_test:",
      '    "Some dialogue."',
      '    $ timedchoice(5.0, "timeout_dest")',
      '    "Next dialogue without menu."',
      "",
      "label timeout_dest:",
      '    "Timed out."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "standalone_timedchoice.rpy",
      content: script,
    }]);

    const timeoutJump = result.edges.find(
      (e) =>
        e.source === "standalone_test" && e.target === "timeout_dest" &&
        e.kind === "jump",
    );
    expect(timeoutJump).toBeDefined();
    expect(timeoutJump?.timeout).toEqual({
      isTimeout: true,
      durationSeconds: 5.0,
    });
  });

  it("1c. timedchoice with Ren'Py command syntax (timedchoice 3.0 target) attaches to menu", async () => {
    const script = [
      "label cmd_syntax:",
      "    timedchoice 3.0 target_cmd",
      "    menu:",
      '        "Take it":',
      '            "Took it."',
      "",
      "label target_cmd:",
      '    "Timed out."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "cmd_syntax.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const timeoutJump = result.edges.find(
      (e) =>
        e.source === menuNode?.id && e.target === "target_cmd" &&
        e.kind === "jump",
    );
    expect(timeoutJump).toBeDefined();
    expect(timeoutJump?.timeout).toEqual({
      isTimeout: true,
      durationSeconds: 3.0,
    });
  });

  it("1d. timedchoice with float without leading zero (.5) and local label target (.timeout)", async () => {
    const script = [
      "label float_test:",
      "    timedchoice .5 .timeout",
      "    menu:",
      '        "Act quickly":',
      '            "Acted."',
      "",
      "label .timeout:",
      '    "Too slow."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "float_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const timeoutJump = result.edges.find(
      (e) =>
        e.source === menuNode?.id && e.kind === "jump" &&
        (e.target === "float_test.timeout" || e.target === ".timeout"),
    );
    expect(timeoutJump).toBeDefined();
    expect(timeoutJump?.timeout).toEqual({
      isTimeout: true,
      durationSeconds: 0.5,
    });
  });

  it("1e. timedchoice with whitespace inside python syntax ($ timedchoice( 2.5 , 'timeout_label' ))", async () => {
    const script = [
      "label ws_test:",
      "    $ timedchoice( 2.5 , 'timeout_ws' )",
      "    menu:",
      '        "Choice":',
      '            "Chosen."',
      "",
      "label timeout_ws:",
      '    "Done."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "ws_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const timeoutJump = result.edges.find(
      (e) =>
        e.source === menuNode?.id && e.target === "timeout_ws" &&
        e.kind === "jump",
    );
    expect(timeoutJump).toBeDefined();
    expect(timeoutJump?.timeout).toEqual({
      isTimeout: true,
      durationSeconds: 2.5,
    });
  });

  it("1f. timedchoice at end of file flushes cleanly without dropping edge", async () => {
    const script = [
      "label eof_test:",
      '    "Ending with timedchoice."',
      '    $ timedchoice(4.0, "eof_dest")',
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "eof_test.rpy",
      content: script,
    }]);

    const timeoutJump = result.edges.find(
      (e) =>
        e.source === "eof_test" && e.target === "eof_dest" &&
        e.kind === "jump",
    );
    expect(timeoutJump).toBeDefined();
    expect(timeoutJump?.timeout).toEqual({
      isTimeout: true,
      durationSeconds: 4.0,
    });
  });

  it("2. fallthrough menu choices preserve option text on outgoing sequence edges", async () => {
    const script = [
      "label start:",
      "    menu:",
      '        "Option Alpha":',
      '            "Picked Alpha."',
      '        "Option Beta":',
      '            "Picked Beta."',
      "    scene bg next_scene",
      '    "After split trigger"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "fallthrough_labels.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const alphaEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id && e.target === "start__scene_2" &&
        e.label === "Option Alpha",
    );
    expect(alphaEdge).toBeDefined();
    expect(alphaEdge?.kind).toBe("sequence");

    const betaEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id && e.target === "start__scene_2" &&
        e.label === "Option Beta",
    );
    expect(betaEdge).toBeDefined();
    expect(betaEdge?.kind).toBe("sequence");

    // Neither edge should have the generic 'next' label
    const genericEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id && e.target === "start__scene_2" &&
        e.label === "next",
    );
    expect(genericEdge).toBeUndefined();
  });

  it("3. subsequent scene splits connect sequentially without scene starvation", async () => {
    const script = [
      "label scene_chain:",
      "    scene bg 1",
      '    "Line 1"',
      "    scene bg 2",
      '    "Line 2"',
      "    scene bg 3",
      '    "Line 3"',
      "    scene bg 4",
      '    "Line 4"',
      "    scene bg 5",
      '    "Line 5"',
      "    scene bg 6",
      '    "Line 6 before menu 1"',
      "    menu:",
      '        "Choice 1":',
      '            "Choice 1 selected."',
      "    scene bg 7",
      '    "Line 7"',
      "    scene bg 8",
      '    "Line 8"',
      "    scene bg 9",
      '    "Line 9 before menu 2"',
      "    menu:",
      '        "Choice 2":',
      '            "Choice 2 selected."',
      "    scene bg 10",
      '    "Line 10"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "scene_chain.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    // Scene 6 -> menu_1
    const edge6ToMenu1 = result.edges.find(
      (e) => e.source === "scene_chain__scene_6" && e.target === "menu_1",
    );
    expect(edge6ToMenu1).toBeDefined();

    // menu_1 -> Scene 7 (labeled with choice text)
    const edgeMenu1To7 = result.edges.find(
      (e) => e.source === "menu_1" && e.target === "scene_chain__scene_7",
    );
    expect(edgeMenu1To7).toBeDefined();
    expect(edgeMenu1To7?.label).toBe("Choice 1");

    // Scene 7 -> Scene 8
    const edge7To8 = result.edges.find(
      (e) =>
        e.source === "scene_chain__scene_7" &&
        e.target === "scene_chain__scene_8",
    );
    expect(edge7To8).toBeDefined();

    // Scene 8 -> Scene 9
    const edge8To9 = result.edges.find(
      (e) =>
        e.source === "scene_chain__scene_8" &&
        e.target === "scene_chain__scene_9",
    );
    expect(edge8To9).toBeDefined();

    // Scene 9 -> menu_2
    const edge9ToMenu2 = result.edges.find(
      (e) => e.source === "scene_chain__scene_9" && e.target === "menu_2",
    );
    expect(edge9ToMenu2).toBeDefined();

    // menu_2 -> Scene 10
    const edgeMenu2To10 = result.edges.find(
      (e) => e.source === "menu_2" && e.target === "scene_chain__scene_10",
    );
    expect(edgeMenu2To10).toBeDefined();
    expect(edgeMenu2To10?.label).toBe("Choice 2");

    // Critical: menu_1 must NOT connect to Scene 8, Scene 9, or menu_2 (no starved intermediate scenes)
    expect(
      result.edges.find((e) =>
        e.source === "menu_1" && e.target === "scene_chain__scene_8"
      ),
    ).toBeUndefined();
    expect(
      result.edges.find((e) =>
        e.source === "menu_1" && e.target === "scene_chain__scene_9"
      ),
    ).toBeUndefined();
    expect(
      result.edges.find((e) => e.source === "menu_1" && e.target === "menu_2"),
    ).toBeUndefined();
  });

  it("4. labels ending with gameover + return do NOT leak sequence edges into subsequent labels", async () => {
    const script = [
      "label start:",
      '    "Story starts here."',
      "    jump bad_end_label",
      "",
      "label bad_end_label:",
      '    "You met an unfortunate ending."',
      "    $ gameover()",
      "    return",
      "",
      "label next_story_label:",
      '    "A completely different story starts here."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "gameover_leak.rpy",
      content: script,
    }]);

    // There must be NO sequence edge from bad_end_label to next_story_label
    const leakEdge = result.edges.find(
      (e) => e.source === "bad_end_label" && e.target === "next_story_label",
    );
    expect(leakEdge).toBeUndefined();

    // bad_end_label should have isTerminalOutcome: true
    const badEndNode = result.nodes.find((n) => n.id === "bad_end_label");
    expect(badEndNode?.isTerminalOutcome).toBe(true);
  });

  it("4b. menus with all exiting options (gameover/return/full_restart) do not leak into subsequent labels", async () => {
    const script = [
      "label menu_bad_end:",
      "    menu:",
      '        "Give up":',
      '            "Giving up."',
      "            $ gameover()",
      "            return",
      '        "Restart":',
      "            $ renpy.full_restart()",
      "",
      "label unrelated_label:",
      '    "Should not be reached from menu."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_all_exit.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Neither the menu nor the label should leak into unrelated_label
    const menuLeak = result.edges.find(
      (e) => e.source === menuNode?.id && e.target === "unrelated_label",
    );
    expect(menuLeak).toBeUndefined();

    const labelLeak = result.edges.find(
      (e) => e.source === "menu_bad_end" && e.target === "unrelated_label",
    );
    expect(labelLeak).toBeUndefined();
  });

  it("5. menus with multiple fallthrough options connect each option without dropping subsequent choices", async () => {
    const script = [
      "label multi_choice:",
      "    menu:",
      '        "Choice Alpha":',
      '            "Picked Alpha."',
      '        "Choice Beta":',
      '            "Picked Beta."',
      '        "Choice Gamma":',
      '            "Picked Gamma."',
      "    scene bg next_chapter",
      '    "Continuing after choice."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "multi_fallthrough.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const outgoingFromMenu = result.edges.filter(
      (e) => e.source === menuNode?.id && e.target === "multi_choice__scene_2",
    );
    expect(outgoingFromMenu).toHaveLength(3);

    const labels = outgoingFromMenu.map((e) => e.label);
    expect(labels).toContain("Choice Alpha");
    expect(labels).toContain("Choice Beta");
    expect(labels).toContain("Choice Gamma");
  });

  it("6. scenario parse of multi-ending branching structure yields expected terminal outcomes without phantom endings", async () => {
    const script = [
      "label story_root:",
      "    scene bg room_1",
      '    "Scene 1 dialogue."',
      "    scene bg room_2",
      '    "Scene 2 dialogue."',
      "    scene bg room_3",
      '    "Scene 3 dialogue."',
      "    scene bg room_4",
      '    "Scene 4 dialogue."',
      "    scene bg room_5",
      '    "Scene 5 dialogue."',
      "    scene bg room_6",
      '    "Scene 6 dialogue."',
      '    $ timedchoice(3.0, "route_timeout_branch")',
      "    menu:",
      '        "Proceed forward":',
      '            "Moving forward."',
      "    scene bg room_7",
      '    "Scene 7 dialogue."',
      "    scene bg room_8",
      '    "Scene 8 dialogue."',
      "    scene bg room_9",
      '    "Scene 9 dialogue."',
      "    menu:",
      '        "Take branch left":',
      "            jump ending_left",
      '        "Take branch right":',
      '            "Going right."',
      "    scene bg room_10",
      '    "Scene 10 dialogue."',
      "    scene bg room_11",
      '    "Scene 11 dialogue."',
      '    $ timedchoice(1.1, "route_quick_timeout")',
      "    menu:",
      '        "Disarm mechanism":',
      '            "Disarmed."',
      "    scene bg room_12",
      '    "Scene 12 dialogue."',
      "    menu:",
      '        "End Alpha":',
      "            jump ending_alpha",
      '        "End Beta":',
      "            jump ending_beta",
      '        "End Gamma":',
      "            jump ending_gamma",
      '        "End Delta":',
      "            jump ending_delta",
      '        "End Epsilon":',
      "            jump ending_epsilon",
      '        "End Zeta":',
      "            jump ending_zeta",
      "",
      "label route_timeout_branch:",
      '    "Ending 1: Timeout Branch"',
      "    $ gameover()",
      "    return",
      "",
      "label ending_left:",
      '    "Ending 2: Left Door"',
      "    $ gameover()",
      "    return",
      "",
      "label route_quick_timeout:",
      '    "Ending 3: Quick Timeout"',
      "    $ gameover()",
      "    return",
      "",
      "label ending_alpha:",
      '    "Ending 4"',
      "    $ gameover()",
      "    return",
      "",
      "label ending_beta:",
      '    "Ending 5"',
      "    $ gameover()",
      "    return",
      "",
      "label ending_gamma:",
      '    "Ending 6"',
      "    $ gameover()",
      "    return",
      "",
      "label ending_delta:",
      '    "Ending 7"',
      "    $ gameover()",
      "    return",
      "",
      "label ending_epsilon:",
      '    "Ending 8"',
      "    $ gameover()",
      "    return",
      "",
      "label ending_zeta:",
      '    "Ending 9"',
      "    $ gameover()",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "synthetic_scenario.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const terminalNodes = result.nodes.filter((n) =>
      n.isTerminalOutcome === true
    );
    const terminalIds = terminalNodes.map((n) => n.id).sort();

    // Exactly 9 terminal outcomes
    expect(terminalNodes).toHaveLength(9);
    expect(terminalIds).toEqual([
      "ending_alpha",
      "ending_beta",
      "ending_delta",
      "ending_epsilon",
      "ending_gamma",
      "ending_left",
      "ending_zeta",
      "route_quick_timeout",
      "route_timeout_branch",
    ]);

    // Intermediate scenes in the main spine must NOT be terminal outcomes
    const scenesInSpine = result.nodes.filter(
      (n) => n.id.startsWith("story_root__scene_"),
    );
    expect(scenesInSpine.length).toBeGreaterThan(0);
    for (const sceneNode of scenesInSpine) {
      expect(sceneNode.isTerminalOutcome).toBe(false);
    }
  });

  it("defect 1: phantom direct bypass edge in label-to-label fallthrough with menus is suppressed", async () => {
    const script = [
      "label synthetic_source_label:",
      "    menu:",
      '        "Option Alpha":',
      '            "Alpha selected."',
      '        "Option Beta":',
      '            "Beta selected."',
      "",
      "label synthetic_target_label:",
      '    "Arrived at target label."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect1_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Menu options must connect to synthetic_target_label
    const menuEdges = result.edges.filter(
      (e) => e.source === menuNode?.id && e.target === "synthetic_target_label",
    );
    expect(menuEdges).toHaveLength(2);

    // Phantom direct bypass edge from source label to target label must NOT exist
    const directBypass = result.edges.find(
      (e) =>
        e.source === "synthetic_source_label" &&
        e.target === "synthetic_target_label" &&
        e.kind === "sequence",
    );
    expect(directBypass).toBeUndefined();
  });

  it("defect 2: pendingTimedChoice is not prematurely flushed by intervening non-branching staging statements", async () => {
    const script = [
      "label synthetic_timed_staging:",
      '    $ timedchoice(4.5, "synthetic_timeout_dest")',
      '    play music "synthetic_audio.ogg"',
      '    queue sound "synthetic_sfx.ogg"',
      "    show synthetic_actor happy",
      "    with dissolve",
      "    window hide",
      "    $ synthetic_variable = 42",
      "    menu:",
      '        "Choice One":',
      '            "One chosen."',
      "",
      "label synthetic_timeout_dest:",
      '    "Timed out."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect2_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Timeout edge must originate from menu node
    const timeoutEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_timeout_dest" &&
        e.kind === "jump",
    );
    expect(timeoutEdge).toBeDefined();
    expect(timeoutEdge?.timeout?.durationSeconds).toBe(4.5);

    // Staging statements must not have caused premature flush on synthetic_timed_staging
    const prematureEdge = result.edges.find(
      (e) =>
        e.source === "synthetic_timed_staging" &&
        e.target === "synthetic_timeout_dest",
    );
    expect(prematureEdge).toBeUndefined();
  });

  it("defect 3: timedchoice with quoted command syntax (double and single quotes) matches correctly", async () => {
    const script = [
      "label synthetic_double_quotes:",
      '    timedchoice 3.5 "synthetic_target_double"',
      "    menu:",
      '        "Double Quote Choice":',
      '            "Chosen."',
      "",
      "label synthetic_target_double:",
      '    "Double quote timeout."',
      "",
      "label synthetic_single_quotes:",
      "    timedchoice 2.5 'synthetic_target_single'",
      "    menu:",
      '        "Single Quote Choice":',
      '            "Chosen."',
      "",
      "label synthetic_target_single:",
      '    "Single quote timeout."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect3_test.rpy",
      content: script,
    }]);

    const doubleTimeout = result.edges.find(
      (e) =>
        e.target === "synthetic_target_double" &&
        e.kind === "jump" &&
        e.timeout?.isTimeout === true,
    );
    expect(doubleTimeout).toBeDefined();
    expect(doubleTimeout?.timeout?.durationSeconds).toBe(3.5);

    const singleTimeout = result.edges.find(
      (e) =>
        e.target === "synthetic_target_single" &&
        e.kind === "jump" &&
        e.timeout?.isTimeout === true,
    );
    expect(singleTimeout).toBeDefined();
    expect(singleTimeout?.timeout?.durationSeconds).toBe(2.5);
  });

  it("defect 4: orphaned menu fallthrough on label-level jumps, calls, and returns connects to target and suppresses direct label edge", async () => {
    const script = [
      "label synthetic_jump_caller:",
      "    menu:",
      '        "Opt Jump 1":',
      '            "Dialogue 1."',
      '        "Opt Jump 2":',
      '            "Dialogue 2."',
      "    jump synthetic_jump_target",
      "",
      "label synthetic_jump_target:",
      '    "Arrived at jump target."',
      "",
      "label synthetic_call_caller:",
      "    menu:",
      '        "Opt Call 1":',
      '            "Call Dialogue 1."',
      "    call synthetic_call_target",
      "",
      "label synthetic_call_target:",
      '    "Inside subroutine."',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect4_test.rpy",
      content: script,
    }]);

    // Jump case: menu options must connect to synthetic_jump_target via jump edges
    const jumpMenu = result.nodes.find((n) =>
      n.type === "MENU" &&
      result.edges.some((e) =>
        e.source === "synthetic_jump_caller" && e.target === n.id
      )
    );
    expect(jumpMenu).toBeDefined();

    const jumpEdgesFromMenu = result.edges.filter(
      (e) =>
        e.source === jumpMenu?.id && e.target === "synthetic_jump_target" &&
        e.kind === "jump",
    );
    expect(jumpEdgesFromMenu).toHaveLength(2);

    // Direct jump from caller must be suppressed
    const directJump = result.edges.find(
      (e) =>
        e.source === "synthetic_jump_caller" &&
        e.target === "synthetic_jump_target" &&
        e.kind === "jump",
    );
    expect(directJump).toBeUndefined();

    // Call case: menu option must connect to synthetic_call_target via call edge
    const callMenu = result.nodes.find((n) =>
      n.type === "MENU" &&
      result.edges.some((e) =>
        e.source === "synthetic_call_caller" && e.target === n.id
      )
    );
    expect(callMenu).toBeDefined();

    const callEdgeFromMenu = result.edges.find(
      (e) =>
        e.source === callMenu?.id && e.target === "synthetic_call_target" &&
        e.kind === "call",
    );
    expect(callEdgeFromMenu).toBeDefined();

    // Direct call from caller must be suppressed
    const directCall = result.edges.find(
      (e) =>
        e.source === "synthetic_call_caller" &&
        e.target === "synthetic_call_target" &&
        e.kind === "call",
    );
    expect(directCall).toBeUndefined();
  });

  it("defect 5: asymmetric branch severing when menu in if falls through to scene with non-menu else is prevented", async () => {
    const script = [
      "label synthetic_conditional_scene_label:",
      '    "Intro dialogue line 1."',
      '    "Intro dialogue line 2."',
      "    if synthetic_condition:",
      "        menu:",
      '            "Option In If 1":',
      '                "If choice 1 dialogue."',
      '            "Option In If 2":',
      '                "If choice 2 dialogue."',
      "    else:",
      '        "Else branch dialogue line 1."',
      '        "Else branch dialogue line 2."',
      "    scene bg synthetic_room_next",
      '    "Dialogue after scene split."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect5_test.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const sceneOneNode = result.nodes.find(
      (n) => n.id === "synthetic_conditional_scene_label__scene_1",
    );
    const sceneTwoNode = result.nodes.find(
      (n) => n.id === "synthetic_conditional_scene_label__scene_2",
    );
    expect(sceneOneNode).toBeDefined();
    expect(sceneTwoNode).toBeDefined();

    // Active scene 1 (containing non-menu else branch) must connect to scene 2
    const sceneOneToTwoEdge = result.edges.find(
      (e) =>
        e.source === "synthetic_conditional_scene_label__scene_1" &&
        e.target === "synthetic_conditional_scene_label__scene_2" &&
        e.kind === "sequence",
    );
    expect(sceneOneToTwoEdge).toBeDefined();

    // Menu options must also connect to scene 2
    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    const menuToSceneTwoEdges = result.edges.filter(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_conditional_scene_label__scene_2" &&
        e.kind === "sequence",
    );
    expect(menuToSceneTwoEdges).toHaveLength(2);
  });

  it("defect 2 extended: pendingTimedChoice is not flushed by intervening pause staging statement", async () => {
    const script = [
      "label synthetic_timed_pause:",
      '    $ timedchoice(2.0, "synthetic_pause_timeout")',
      "    pause 1.0",
      "    menu:",
      '        "Proceed":',
      '            "Proceeded."',
      "",
      "label synthetic_pause_timeout:",
      '    "Timeout."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect2_ext_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const timeoutEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_pause_timeout" &&
        e.kind === "jump",
    );
    expect(timeoutEdge).toBeDefined();
    expect(timeoutEdge?.timeout?.durationSeconds).toBe(2.0);

    const prematureEdge = result.edges.find(
      (e) =>
        e.source === "synthetic_timed_pause" &&
        e.target === "synthetic_pause_timeout",
    );
    expect(prematureEdge).toBeUndefined();
  });

  it("defect 4 extended: subroutine with fallthrough menu followed by return materializes call_return edge back to caller", async () => {
    const script = [
      "label synthetic_caller:",
      '    "Calling subroutine."',
      "    call synthetic_subroutine",
      '    "Returned to caller."',
      "",
      "label synthetic_subroutine:",
      "    menu:",
      '        "Sub Option 1":',
      '            "Picked 1."',
      '        "Sub Option 2":',
      '            "Picked 2."',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect4_return_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) =>
      n.type === "MENU" && n.parentLabelId === "synthetic_subroutine"
    );
    expect(menuNode).toBeDefined();

    const callReturnEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_caller" &&
        e.kind === "call_return",
    );
    expect(callReturnEdge).toBeDefined();
  });

  it("defect 4 extended: jump expression with multiple resolved targets connects fallthrough menu to each target without direct bypass", async () => {
    const script = [
      "init python:",
      '    target_options = ["synthetic_dest_alpha", "synthetic_dest_beta"]',
      "",
      "label synthetic_multitarget_caller:",
      "    menu:",
      '        "Opt 1":',
      '            "Dialogue 1."',
      "    jump expression target_options",
      "",
      "label synthetic_dest_alpha:",
      '    "Alpha."',
      "",
      "label synthetic_dest_beta:",
      '    "Beta."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect4_multitarget_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) =>
      n.type === "MENU" && n.parentLabelId === "synthetic_multitarget_caller"
    );
    expect(menuNode).toBeDefined();

    // Menu should connect to both dest_alpha and dest_beta
    const alphaJump = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_dest_alpha" &&
        e.kind === "jump",
    );
    const betaJump = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_dest_beta" &&
        e.kind === "jump",
    );
    expect(alphaJump).toBeDefined();
    expect(betaJump).toBeDefined();

    // Direct jump from synthetic_multitarget_caller to either destination must be suppressed
    expect(
      result.edges.find(
        (e) =>
          e.source === "synthetic_multitarget_caller" &&
          (e.target === "synthetic_dest_alpha" ||
            e.target === "synthetic_dest_beta") &&
          e.kind === "jump",
      ),
    ).toBeUndefined();
  });

  it("defect 5 extended: exhaustive conditional where both if and else have fallthrough menus suppresses direct scene-to-scene bypass", async () => {
    const script = [
      "label synthetic_exhaustive_conditional:",
      '    "Dialogue before branch."',
      "    if synthetic_condition:",
      "        menu:",
      '            "If Option":',
      '                "Picked If."',
      "    else:",
      "        menu:",
      '            "Else Option":',
      '                "Picked Else."',
      "    scene bg synthetic_room_after",
      '    "Dialogue after scene split."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "defect5_exhaustive_test.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const sceneOneNode = result.nodes.find(
      (n) => n.id === "synthetic_exhaustive_conditional__scene_1",
    );
    const sceneTwoNode = result.nodes.find(
      (n) => n.id === "synthetic_exhaustive_conditional__scene_2",
    );
    expect(sceneOneNode).toBeDefined();
    expect(sceneTwoNode).toBeDefined();

    // Direct sequence edge from scene 1 to scene 2 must NOT exist (exhaustive menus)
    const directBypassEdge = result.edges.find(
      (e) =>
        e.source === "synthetic_exhaustive_conditional__scene_1" &&
        e.target === "synthetic_exhaustive_conditional__scene_2" &&
        e.kind === "sequence",
    );
    expect(directBypassEdge).toBeUndefined();

    // Both menus must connect to scene 2
    const menus = result.nodes.filter((n) => n.type === "MENU");
    expect(menus).toHaveLength(2);
    for (const menu of menus) {
      const edgeToScene2 = result.edges.find(
        (e) =>
          e.source === menu.id &&
          e.target === "synthetic_exhaustive_conditional__scene_2" &&
          e.kind === "sequence",
      );
      expect(edgeToScene2).toBeDefined();
    }
  });

  it("defect 1/5: asymmetric conditional menu falling through to label preserves non-menu else branch sequence edge", async () => {
    const script = [
      "label synthetic_asymmetric_label_1:",
      '    "Intro dialogue line 1."',
      "    if synthetic_condition:",
      "        menu:",
      '            "Option Alpha":',
      '                "Alpha selected."',
      "    else:",
      '        "Else branch dialogue."',
      "",
      "label synthetic_asymmetric_label_2:",
      '    "Next label dialogue."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "asymmetric_label_fallthrough.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Menu option Alpha must connect to synthetic_asymmetric_label_2
    const menuEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_asymmetric_label_2" &&
        e.kind === "sequence" &&
        e.label === "Option Alpha",
    );
    expect(menuEdge).toBeDefined();

    // The non-menu else branch from synthetic_asymmetric_label_1 must ALSO connect to synthetic_asymmetric_label_2
    const elseBranchEdge = result.edges.find(
      (e) =>
        e.source === "synthetic_asymmetric_label_1" &&
        e.target === "synthetic_asymmetric_label_2" &&
        e.kind === "sequence",
    );
    expect(elseBranchEdge).toBeDefined();
  });

  it("defect 4 extended: asymmetric conditional menu followed by jump preserves jump edge from non-menu else branch", async () => {
    const script = [
      "label synthetic_jump_caller:",
      "    if synthetic_condition:",
      "        menu:",
      '            "Option In If":',
      '                "Chosen."',
      "    else:",
      '        "Else dialogue."',
      "    jump synthetic_jump_target",
      "",
      "label synthetic_jump_target:",
      '    "Target reached."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "asymmetric_jump.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Menu must jump to synthetic_jump_target
    const menuJump = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_jump_target" &&
        e.kind === "jump",
    );
    expect(menuJump).toBeDefined();

    // Enclosing label must ALSO jump to synthetic_jump_target for the non-menu else branch
    const labelJump = result.edges.find(
      (e) =>
        e.source === "synthetic_jump_caller" &&
        e.target === "synthetic_jump_target" &&
        e.kind === "jump",
    );
    expect(labelJump).toBeDefined();
  });

  it("defect 4 extended: asymmetric conditional menu followed by call preserves call edge from non-menu else branch", async () => {
    const script = [
      "label synthetic_call_caller:",
      "    if synthetic_condition:",
      "        menu:",
      '            "Option In If":',
      '                "Chosen."',
      "    else:",
      '        "Else dialogue."',
      "    call synthetic_call_subroutine",
      '    "Back at caller."',
      "",
      "label synthetic_call_subroutine:",
      '    "Subroutine code."',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "asymmetric_call.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Both menu and caller label must have call edges into synthetic_call_subroutine
    const menuCall = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_call_subroutine" &&
        e.kind === "call",
    );
    expect(menuCall).toBeDefined();

    const labelCall = result.edges.find(
      (e) =>
        e.source === "synthetic_call_caller" &&
        e.target === "synthetic_call_subroutine" &&
        e.kind === "call",
    );
    expect(labelCall).toBeDefined();
  });

  it("defect 4 extended: asymmetric conditional menu followed by return materializes call_return for both branches", async () => {
    const script = [
      "label synthetic_caller_node:",
      "    call synthetic_asymmetric_subroutine",
      '    "Returned."',
      "",
      "label synthetic_asymmetric_subroutine:",
      "    if synthetic_condition:",
      "        menu:",
      '            "Option In If":',
      '                "Chosen."',
      "    else:",
      '        "Else dialogue."',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "asymmetric_return.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Both menu and subroutine label must materialize call_return edges to caller
    const menuReturn = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_caller_node" &&
        e.kind === "call_return",
    );
    expect(menuReturn).toBeDefined();

    const labelReturn = result.edges.find(
      (e) =>
        e.source === "synthetic_asymmetric_subroutine" &&
        e.target === "synthetic_caller_node" &&
        e.kind === "call_return",
    );
    expect(labelReturn).toBeDefined();
  });

  it("defect 1 extended: conditional menu with no else branch connects decision false path to subsequent label", async () => {
    const script = [
      "label synthetic_no_else_1:",
      '    "Intro dialogue."',
      "    if synthetic_condition:",
      "        menu:",
      '            "Option In If":',
      '                "Chosen."',
      "",
      "label synthetic_no_else_2:",
      '    "After conditional."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "no_else_label_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    const decisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(menuNode).toBeDefined();
    expect(decisionNode).toBeDefined();

    // Menu option connects to label 2
    const menuEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_no_else_2" &&
        e.kind === "sequence",
    );
    expect(menuEdge).toBeDefined();

    // False / else path connects enclosing label to label 2
    const elseEdge = result.edges.find(
      (e) =>
        e.source === "synthetic_no_else_1" &&
        e.target === "synthetic_no_else_2" &&
        e.kind === "sequence",
    );
    expect(elseEdge).toBeDefined();
  });

  it("defect 2 extended: camera, outfit, accessory, and nvl staging statements do not prematurely flush pendingTimedChoice", async () => {
    const script = [
      "label synthetic_extended_staging:",
      '    $ timedchoice(4.0, "synthetic_staging_timeout")',
      "    camera",
      "    outfit character casual",
      "    accessory character add hat",
      "    nvl clear",
      "    pass",
      "    menu:",
      '        "Take Action":',
      '            "Action taken."',
      "",
      "label synthetic_staging_timeout:",
      '    "Timed out."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "extended_staging_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // Timeout jump MUST originate from menu node
    const timeoutEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_staging_timeout" &&
        e.kind === "jump",
    );
    expect(timeoutEdge).toBeDefined();
    expect(timeoutEdge?.timeout?.durationSeconds).toBe(4.0);

    // No premature flush from label
    const prematureEdge = result.edges.find(
      (e) =>
        e.source === "synthetic_extended_staging" &&
        e.target === "synthetic_staging_timeout",
    );
    expect(prematureEdge).toBeUndefined();
  });

  it("defect 3 extended: timedchoice with keyword arguments (time=, target=) matches correctly", async () => {
    const script = [
      "label synthetic_kw_args:",
      '    $ timedchoice(time=3.5, target="synthetic_kw_dest")',
      "    menu:",
      '        "Act Now":',
      '            "Acted."',
      "",
      "label synthetic_kw_dest:",
      '    "Timeout dest."',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "kw_args_test.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const timeoutEdge = result.edges.find(
      (e) =>
        e.source === menuNode?.id &&
        e.target === "synthetic_kw_dest" &&
        e.kind === "jump",
    );
    expect(timeoutEdge).toBeDefined();
    expect(timeoutEdge?.timeout?.durationSeconds).toBe(3.5);
  });
});
