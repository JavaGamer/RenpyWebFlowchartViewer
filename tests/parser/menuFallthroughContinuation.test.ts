import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

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

  it("handles ReEyAr pattern where show statements and dialogues continue after menu without scene keyword", async () => {
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
  });
});
