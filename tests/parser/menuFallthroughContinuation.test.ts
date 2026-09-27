import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import {
  applyDagreLayout,
  applyElkLayout,
} from "../../src/infrastructure/layoutEngines.ts";
import { NODE_WIDTH } from "../../src/domain/index.ts";

describe("menu fallthrough story continuation splitting", () => {
  it("splits label into scenes when story continuation follows menu fallthrough without scene keyword", async () => {
    const script = [
      "label my_story:",
      '    "Intro dialogue line 1."',
      '    "Intro dialogue line 2."',
      "    menu:",
      '        "Stay here":',
      '            "You chose to stay."',
      '        "Leave":',
      "            jump outside",
      "",
      '    "Post-menu dialogue line 1."',
      '    "Post-menu dialogue line 2."',
      '    "Post-menu dialogue line 3."',
      "    jump next_chapter",
      "",
      "label outside:",
      '    "You are outside."',
      "    return",
      "",
      "label next_chapter:",
      '    "Next chapter dialogue."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "story.rpy",
      content: script,
    }]);

    // Label my_story should be split into Scene 1 and Scene 2
    const scene1 = result.nodes.find((n) => n.id.includes("__scene_1"));
    const scene2 = result.nodes.find((n) => n.id.includes("__scene_2"));
    const menu = result.nodes.find((n) => n.type === "MENU");
    const outside = result.nodes.find((n) => n.id === "outside");
    const nextChapter = result.nodes.find((n) => n.id === "next_chapter");

    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();
    expect(menu).toBeDefined();
    expect(outside).toBeDefined();
    expect(nextChapter).toBeDefined();

    // Scene 1 connects to menu
    const seqToMenu = result.edges.find(
      (e) => e.source === scene1?.id && e.target === menu?.id,
    );
    expect(seqToMenu).toBeDefined();

    // "Leave" jumps to outside
    const leaveEdge = result.edges.find(
      (e) =>
        e.source === menu?.id && e.target === outside?.id &&
        e.label === "Leave",
    );
    expect(leaveEdge).toBeDefined();

    // "Stay here" falls through to Scene 2
    const stayEdge = result.edges.find(
      (e) =>
        e.source === menu?.id && e.target === scene2?.id &&
        e.label === "Stay here",
    );
    expect(stayEdge).toBeDefined();

    // Scene 2 jumps to next_chapter
    const nextEdge = result.edges.find(
      (e) => e.source === scene2?.id && e.target === nextChapter?.id,
    );
    expect(nextEdge).toBeDefined();

    // Dialogue lines post-menu must be recorded in Scene 2, not Scene 1
    expect(scene1?.dialogueCount).toBe(2);
    expect(scene2?.dialogueCount).toBe(3);
  });

  it("handles ReEyAr pattern where show statements and dialogues continue after menu without scene keyword and routes No around Yes continuation", async () => {
    const script = [
      "label ReEyAr:",
      '    "Some dialogue before the decision."',
      "    menu:",
      '        "Yes":',
      '            "You selected yes."',
      '        "No":',
      "            jump adivinenquienhavueltopuesyolosfinalesperoestavezmascortosisenorasisedice",
      "",
      "    show character normal",
      '    "A bunch of dialogue continues here after Yes is chosen."',
      '    "More dialogue continues."',
      "    jump adivinenquienhavueltopuesyolosfinalesperoestavezmascortosisenorasisedice",
      "",
      "label adivinenquienhavueltopuesyolosfinalesperoestavezmascortosisenorasisedice:",
      '    "Final scene reached."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "ReEyAr.rpy",
      content: script,
    }]);

    const scene1 = result.nodes.find((n) => n.id.includes("__scene_1"));
    const scene2 = result.nodes.find((n) => n.id.includes("__scene_2"));
    const ending = result.nodes.find(
      (n) =>
        n.id ===
          "adivinenquienhavueltopuesyolosfinalesperoestavezmascortosisenorasisedice",
    );
    const menu = result.nodes.find((n) => n.type === "MENU");

    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();
    expect(ending).toBeDefined();
    expect(menu).toBeDefined();

    // "Yes" must route to Scene 2
    const yesEdge = result.edges.find(
      (e) =>
        e.source === menu?.id && e.target === scene2?.id && e.label === "Yes",
    );
    expect(yesEdge).toBeDefined();

    // "No" must route to ending
    const noEdge = result.edges.find(
      (e) =>
        e.source === menu?.id && e.target === ending?.id && e.label === "No",
    );
    expect(noEdge).toBeDefined();

    // Scene 2 jump routes to ending
    const scene2ToEnding = result.edges.find(
      (e) =>
        e.source === scene2?.id && e.target === ending?.id && e.kind === "jump",
    );
    expect(scene2ToEnding).toBeDefined();

    // Verify layout routes "No" around Scene 2 so it is not hidden behind "Yes" / Scene 2
    const layout = applyDagreLayout(result.nodes, result.edges, "TB", {
      enableCompoundContainers: true,
    });
    const laidOutScene2 = layout.nodes.find((n) => n.id === scene2!.id)!;
    const laidOutNoEdge = layout.edges.find((e) => e.id === noEdge!.id)!;

    expect(laidOutNoEdge.data?.svgPath).toBeDefined();
    expect(laidOutNoEdge.data?.labelPosition).toBeDefined();

    const scene2Parent = laidOutScene2.parentId
      ? layout.nodes.find((n) => n.id === laidOutScene2.parentId)
      : undefined;
    const scene2AbsX = (scene2Parent?.position.x ?? 0) +
      laidOutScene2.position.x;

    // The "No" edge label must sit outside Scene 2's horizontal bounds
    const noLabelX = laidOutNoEdge.data!.labelPosition!.x;
    const isOutsideScene2 = noLabelX < scene2AbsX - 20 ||
      noLabelX > scene2AbsX + NODE_WIDTH + 20;
    expect(isOutsideScene2).toBe(true);
    expect(laidOutNoEdge.data?.obstacles?.length).toBeGreaterThan(0);
  });

  it("splits even when there is zero dialogue before menu and only flag assignments in fallthrough choice", async () => {
    const script = [
      "label zero_pre_dialogue:",
      "    menu:",
      '        "Yes":',
      "            $ picked_yes = True",
      '        "No":',
      "            jump ending_label",
      "",
      '    "Dialogue only happens on the Yes continuation path."',
      "    jump ending_label",
      "",
      "label ending_label:",
      '    "Done."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "zero_pre.rpy",
      content: script,
    }]);

    const scene1 = result.nodes.find((n) =>
      n.id === "zero_pre_dialogue__scene_1"
    );
    const scene2 = result.nodes.find((n) =>
      n.id === "zero_pre_dialogue__scene_2"
    );
    const menu = result.nodes.find((n) => n.type === "MENU");
    const ending = result.nodes.find((n) => n.id === "ending_label");

    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();
    expect(menu).toBeDefined();
    expect(ending).toBeDefined();
    expect(
      result.edges.some(
        (e) =>
          e.source === menu!.id && e.target === scene2!.id && e.label === "Yes",
      ),
    ).toBe(true);
    expect(
      result.edges.some(
        (e) =>
          e.source === menu!.id && e.target === ending!.id && e.label === "No",
      ),
    ).toBe(true);
  });

  it("does not double-split when a scene statement already split inside the menu option block", async () => {
    const script = [
      "label start:",
      "    menu:",
      '        "Pick":',
      "            scene bg beach",
      '            "after split trigger"',
      '    "outside option"',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "in_menu_split.rpy",
      content: script,
    }]);

    expect(result.nodes.some((n) => n.id === "start__scene_1")).toBe(true);
    expect(result.nodes.some((n) => n.id === "start__scene_2")).toBe(true);
    expect(result.nodes.some((n) => n.id === "start__scene_3")).toBe(false);
  });

  it("does not split when menu fallthrough immediately exits via $ renpy.jump", async () => {
    const script = [
      "label direct_exit:",
      '    "Before menu"',
      "    menu:",
      '        "A":',
      '            "Picked A"',
      '        "B":',
      '            "Picked B"',
      '    $ renpy.jump("after_exit")',
      "",
      "label after_exit:",
      '    "Done"',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "direct_exit.rpy",
      content: script,
    }]);

    expect(result.nodes.some((n) => n.id === "direct_exit")).toBe(true);
    expect(result.nodes.some((n) => n.id.includes("__scene_"))).toBe(false);
  });

  it("preserves utility and detour roles across scene-split subroutine sibling nodes (Bug N1)", async () => {
    const script = [
      "label start:",
      "    call shared_helper",
      "    menu:",
      '        "Take detour":',
      "            call optional_detour",
      '        "Continue":',
      '            "Continuing main story."',
      "    return",
      "",
      "label shared_helper:",
      '    "Helper intro."',
      "    menu:",
      '        "Option 1":',
      '            "Helper option 1."',
      '        "Option 2":',
      '            "Helper option 2."',
      '    "Helper outro before return."',
      "    return",
      "",
      "label optional_detour:",
      '    "Detour intro."',
      "    menu:",
      '        "Left":',
      '            "Went left."',
      '        "Right":',
      '            "Went right."',
      '    "Detour outro before return."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "subroutine_roles.rpy",
      content: script,
    }]);

    const helperScene1 = result.nodes.find((n) =>
      n.id === "shared_helper__scene_1"
    );
    const helperScene2 = result.nodes.find((n) =>
      n.id === "shared_helper__scene_2"
    );
    expect(helperScene1?.role).toBe("utility");
    expect(helperScene2?.role).toBe("utility");

    const detourScene1 = result.nodes.find((n) =>
      n.id === "optional_detour__scene_1"
    );
    const detourScene2 = result.nodes.find((n) =>
      n.id === "optional_detour__scene_2"
    );
    expect(detourScene1?.role).toBe("detour");
    expect(detourScene2?.role).toBe("detour");
  });

  it("connects implicit else fallthrough with else metadata and omits redundant pre-if scene edge when menu is inside if block (Bug N2)", async () => {
    const script = [
      "label cond_menu_story:",
      '    "Before if block."',
      "    if has_key:",
      "        menu:",
      '            "Unlock door":',
      '                "Unlocked the door."',
      '            "Walk away":',
      "                jump leave_area",
      "    elif forced_exit:",
      "        jump leave_area",
      '    "Continuation after if block."',
      "    return",
      "",
      "label leave_area:",
      '    "Left the area."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "cond_menu.rpy",
      content: script,
    }]);

    const scene1 = result.nodes.find((n) =>
      n.id === "cond_menu_story__scene_1"
    );
    const scene2 = result.nodes.find((n) =>
      n.id === "cond_menu_story__scene_2"
    );
    const decision = result.nodes.find((n) => n.type === "DECISION");
    const menu = result.nodes.find((n) => n.type === "MENU");

    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();
    expect(decision).toBeDefined();
    expect(menu).toBeDefined();

    // decision -> scene2 must carry branchKind: "else" and label: "else"
    const decisionToScene2 = result.edges.find(
      (e) => e.source === decision!.id && e.target === scene2!.id,
    );
    expect(decisionToScene2).toBeDefined();
    expect(decisionToScene2?.label).toBe("else");
    expect(decisionToScene2?.condition?.branchKind).toBe("else");

    // Redundant unconditional scene1 -> scene2 edge must NOT be emitted
    const redundantScene1ToScene2 = result.edges.find(
      (e) => e.source === scene1!.id && e.target === scene2!.id,
    );
    expect(redundantScene1ToScene2).toBeUndefined();
  });

  it("splits label when menu option calls a subroutine and falls through to post-menu continuation (Bug N4)", async () => {
    const script = [
      "label call_in_menu:",
      '    "Before menu."',
      "    menu:",
      '        "Call helper":',
      "            call sub_action",
      '        "Leave":',
      "            jump exit_scene",
      '    "After menu continuation."',
      "    return",
      "",
      "label sub_action:",
      '    "In subroutine."',
      "    return",
      "",
      "label exit_scene:",
      '    "Exited."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "call_in_menu.rpy",
      content: script,
    }]);

    const scene1 = result.nodes.find((n) => n.id === "call_in_menu__scene_1");
    const scene2 = result.nodes.find((n) => n.id === "call_in_menu__scene_2");
    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();

    // call_return edge from sub_action should target scene2, not loop back to scene1
    const callReturnEdge = result.edges.find(
      (e) => e.source === "sub_action" && e.kind === "call_return",
    );
    expect(callReturnEdge).toBeDefined();
    expect(callReturnEdge?.target).toBe(scene2!.id);
  });

  it("splits label before attaching a post-menu match block and ignores hide staging before return (Bugs N4 & P2)", async () => {
    const script = [
      "label match_after_menu:",
      '    "Intro."',
      "    menu:",
      '        "Pick A":',
      "            $ picked = 1",
      '        "Exit":',
      "            jump done_label",
      "    match picked:",
      "        case 1:",
      '            "Matched 1."',
      "    return",
      "",
      "label hide_before_return:",
      '    "Intro."',
      "    menu:",
      '        "Stay":',
      '            "Staying."',
      '        "Go":',
      "            jump done_label",
      "    hide eileen",
      "    return",
      "",
      "label done_label:",
      '    "Done."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "match_and_hide.rpy",
      content: script,
    }]);

    const matchScene1 = result.nodes.find((n) =>
      n.id === "match_after_menu__scene_1"
    );
    const matchScene2 = result.nodes.find((n) =>
      n.id === "match_after_menu__scene_2"
    );
    const matchDecision = result.nodes.find(
      (n) => n.type === "DECISION" && n.condition?.branchKind === "match",
    );
    expect(matchScene1).toBeDefined();
    expect(matchScene2).toBeDefined();
    expect(matchDecision).toBeDefined();
    expect(
      result.edges.some(
        (e) => e.source === matchScene2!.id && e.target === matchDecision!.id,
      ),
    ).toBe(true);

    // hide_before_return should not split into an empty scene_2 because only `hide` precedes `return`
    expect(
      result.nodes.some((n) => n.id === "hide_before_return__scene_2"),
    ).toBe(false);
  });

  it("stores detourSide on bypassed edges and normalizes intra-chapter ELK edge sections with previousPositions (Bugs N3 & L1)", async () => {
    const script = [
      "label chap_story:",
      '    "Intro."',
      "    menu:",
      '        "Yes":',
      '            "Yes line."',
      '        "No":',
      "            jump chap_end",
      '    "Post-menu continuation."',
      "    jump chap_end",
      "",
      "label chap_end:",
      '    "Ending."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "chap.rpy",
      content: script,
    }]);

    const dagreLayout = applyDagreLayout(result.nodes, result.edges, "TB", {
      enableCompoundContainers: true,
    });
    const menu = result.nodes.find((n) => n.type === "MENU")!;
    const noEdge = dagreLayout.edges.find(
      (e) => e.source === menu.id && e.data?.label === "No",
    );
    expect(noEdge?.data?.detourSide).toBeDefined();

    // First ELK layout pass
    const elkPass1 = await applyElkLayout(result.nodes, result.edges, "TB", {
      enableCompoundContainers: true,
    });
    // Second ELK layout pass with large shifted previousPositions
    const shiftedPrev = new Map<string, { x: number; y: number }>();
    for (const n of elkPass1.nodes) {
      if (!n.parentId) {
        shiftedPrev.set(n.id, {
          x: n.position.x + 800,
          y: n.position.y + 600,
        });
      }
    }
    const elkPass2 = await applyElkLayout(result.nodes, result.edges, "TB", {
      enableCompoundContainers: true,
      previousPositions: shiftedPrev,
    });

    const elkMenuNode = elkPass2.nodes.find((n) => n.id === menu.id)!;
    const elkParentNode = elkMenuNode.parentId
      ? elkPass2.nodes.find((n) => n.id === elkMenuNode.parentId)
      : undefined;
    const menuAbsX = (elkParentNode?.position.x ?? 0) + elkMenuNode.position.x;
    const menuAbsY = (elkParentNode?.position.y ?? 0) + elkMenuNode.position.y;
    const elkYesEdge = elkPass2.edges.find(
      (e) => e.source === menu.id && e.data?.label === "Yes",
    )!;
    const firstBend = elkYesEdge.data?.bendPoints?.[0];
    expect(firstBend).toBeDefined();
    // First bendPoint must lie on the bottom boundary of the menu node in root coordinates
    expect(firstBend!.x).toBeGreaterThanOrEqual(menuAbsX);
    expect(firstBend!.x).toBeLessThanOrEqual(menuAbsX + NODE_WIDTH);
    expect(
      Math.abs(firstBend!.y - (menuAbsY + (elkMenuNode.height ?? 80))),
    ).toBeLessThanOrEqual(2);
  });

  it("preserves sibling branch menu fallthrough when another conditional branch executes a terminal statement like $ renpy.full_restart()", async () => {
    const script = [
      "label term_branch_story:",
      '    "Before conditional."',
      "    if has_token:",
      "        menu:",
      '            "Use token":',
      '                "Token used."',
      '            "Bail out":',
      "                jump safe_room",
      "    elif game_over_flag:",
      "        $ renpy.full_restart()",
      '    "Continuation after conditional."',
      "    return",
      "",
      "label safe_room:",
      '    "Safe."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "term_branch.rpy",
      content: script,
    }]);

    const scene1 = result.nodes.find((n) =>
      n.id === "term_branch_story__scene_1"
    );
    const scene2 = result.nodes.find((n) =>
      n.id === "term_branch_story__scene_2"
    );
    const menu = result.nodes.find((n) => n.type === "MENU");
    const decision = result.nodes.find((n) => n.type === "DECISION");

    expect(scene1).toBeDefined();
    expect(scene2).toBeDefined();
    expect(menu).toBeDefined();
    expect(decision).toBeDefined();

    // "Use token" option must connect to Scene 2
    expect(
      result.edges.some(
        (e) =>
          e.source === menu!.id &&
          e.target === scene2!.id &&
          e.label === "Use token",
      ),
    ).toBe(true);

    // Implicit else of the decision must connect to Scene 2
    expect(
      result.edges.some(
        (e) =>
          e.source === decision!.id &&
          e.target === scene2!.id &&
          e.condition?.branchKind === "else",
      ),
    ).toBe(true);
  });

  it("connects all resolved targets from menu fallthrough when $ renpy.jump targets a multi-target list variable", async () => {
    const script = [
      "label multi_renpy_jump:",
      '    $ possible_targets = ["route_alpha", "route_beta"]',
      "    menu:",
      '        "Proceed":',
      '            "Proceeding to dynamic route."',
      '        "Abort":',
      "            jump abort_route",
      "    $ renpy.jump(possible_targets[idx])",
      "",
      "label route_alpha:",
      '    "Alpha"',
      "    return",
      "",
      "label route_beta:",
      '    "Beta"',
      "    return",
      "",
      "label abort_route:",
      '    "Aborted"',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "multi_renpy_jump.rpy",
      content: script,
    }]);

    const menu = result.nodes.find((n) => n.type === "MENU")!;
    expect(menu).toBeDefined();

    // Both route_alpha and route_beta must be connected from menu with label "Proceed"
    expect(
      result.edges.some(
        (e) =>
          e.source === menu.id &&
          e.target === "route_alpha" &&
          e.label === "Proceed",
      ),
    ).toBe(true);
    expect(
      result.edges.some(
        (e) =>
          e.source === menu.id &&
          e.target === "route_beta" &&
          e.label === "Proceed",
      ),
    ).toBe(true);

    // Parent label must NOT emit a direct bypass jump edge to route_beta
    expect(
      result.edges.some(
        (e) => e.source === "multi_renpy_jump" && e.target === "route_beta",
      ),
    ).toBe(false);
  });

  it("does not emit phantom decision bypass edges when a menu inside a branch falls through to a jump or scene split", async () => {
    const script = [
      "label branch_menu_jump:",
      '    "Intro"',
      "    if flag_a:",
      "        menu:",
      '            "Choice 1":',
      '                "Picked 1"',
      '            "Choice 2":',
      "                jump target_two",
      "        jump target_one",
      "    else:",
      '        "Else path"',
      '    "Post-if continuation"',
      "    return",
      "",
      "label target_one:",
      '    "Target 1"',
      "    return",
      "",
      "label target_two:",
      '    "Target 2"',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "branch_menu_jump.rpy",
      content: script,
    }]);

    const decision = result.nodes.find((n) => n.type === "DECISION")!;
    const menu = result.nodes.find((n) => n.type === "MENU")!;
    expect(decision).toBeDefined();
    expect(menu).toBeDefined();

    // Choice 1 jumps from menu to target_one
    expect(
      result.edges.some(
        (e) =>
          e.source === menu.id &&
          e.target === "target_one" &&
          e.label === "Choice 1",
      ),
    ).toBe(true);

    // Decision node must NOT have a direct bypass jump edge to target_one
    expect(
      result.edges.some(
        (e) => e.source === decision.id && e.target === "target_one",
      ),
    ).toBe(false);
  });
});
