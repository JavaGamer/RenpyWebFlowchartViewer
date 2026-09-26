import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import { applyDagreLayout } from "../../src/infrastructure/layoutEngines.ts";
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
});
