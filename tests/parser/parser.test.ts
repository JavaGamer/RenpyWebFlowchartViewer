import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser";

describe("parseRenpyFiles", () => {
  it("returns an empty graph when no files are provided", async () => {
    await expect(parseRenpyFiles([])).resolves.toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("parses basic labels, dialogue, and fallthrough sequence edges", async () => {
    const script = [
      "label start:",
      '    "hello"',
      "",
      "label second:",
      '    e "hi"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "basic.rpy",
      content: script,
    }]);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "start",
          type: "LABEL",
          label: "start",
          dialogueCount: 1,
        }),
        expect.objectContaining({
          id: "second",
          type: "LABEL",
          label: "second",
          dialogueCount: 1,
        }),
      ]),
    );

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        id: "seq_start__second",
        source: "start",
        target: "second",
        kind: "sequence",
        label: "next",
      }),
    );
  });

  it("keeps duplicate label nodes visible across files while preserving local sequence edges", async () => {
    const files = [
      {
        name: "part1.rpy",
        content: [
          "label alpha:",
          '    "line a1"',
          "",
          "label beta:",
          '    "line b1"',
          "",
        ].join("\n"),
      },
      {
        name: "part2.rpy",
        content: [
          "label alpha:",
          '    "line a2"',
          "",
          "label beta:",
          '    "line b2"',
          "",
        ].join("\n"),
      },
    ];

    const result = await parseRenpyFiles(files);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "alpha", dialogueCount: 1 }),
        expect.objectContaining({ id: "beta", dialogueCount: 1 }),
        expect.objectContaining({
          id: "alpha__shadow_2",
          dialogueCount: 1,
          isShadowed: true,
          shadowOfId: "alpha",
        }),
        expect.objectContaining({
          id: "beta__shadow_2",
          dialogueCount: 1,
          isShadowed: true,
          shadowOfId: "beta",
        }),
      ]),
    );

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "alpha",
          target: "beta",
          kind: "sequence",
          label: "next",
        }),
        expect.objectContaining({
          source: "alpha__shadow_2",
          target: "beta__shadow_2",
          kind: "sequence",
          label: "next",
        }),
      ]),
    );
  });

  it("keeps parse output stable across repeated invocations for the same input", async () => {
    const files = [
      {
        name: "repeat.rpy",
        content: [
          "label one:",
          '    "line 1"',
          "",
          "label two:",
          '    "line 2"',
          "",
        ].join("\n"),
      },
    ];

    const first = await parseRenpyFiles(files);
    const second = await parseRenpyFiles(files);

    expect(second).toEqual(first);
  });

  // ── Label parsing ────────────────────────────────────────────────────────────

  it("parses a single label with no dialogue", async () => {
    const script = "label intro:\n    pass\n";

    const result = await parseRenpyFiles([{
      name: "intro.rpy",
      content: script,
    }]);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toEqual(
      expect.objectContaining({
        id: "intro",
        type: "LABEL",
        label: "intro",
        dialogueCount: 0,
      }),
    );
    expect(result.edges).toHaveLength(0);
  });

  it("accumulates multiple dialogue lines in the same label", async () => {
    const script = [
      "label scene:",
      '    "line one"',
      '    "line two"',
      '    "line three"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "scene.rpy",
      content: script,
    }]);

    const node = result.nodes.find((n) => n.id === "scene");
    expect(node).toBeDefined();
    expect(node?.dialogueCount).toBe(3);
    expect(node?.dialogueLines).toEqual(["line one", "line two", "line three"]);
  });

  it("supports count-only dialogue mode for faster parse without line capture", async () => {
    const script = [
      "label scene:",
      '    "line one"',
      '    "line two"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles(
      [{ name: "scene.rpy", content: script }],
      { captureDialogueLines: false },
    );

    const node = result.nodes.find((n) => n.id === "scene");
    expect(node).toBeDefined();
    expect(node?.dialogueCount).toBe(2);
    expect(node?.dialogueLines).toBeUndefined();
  });

  it("splits labels into scene sub-nodes when scene boundaries occur after label content", async () => {
    const script = [
      "label start:",
      '    "before 1"',
      '    "before 2"',
      '    "before 3"',
      "    scene bg room",
      '    "after"',
      "",
      "label end:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "scene-split.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "start__scene_1",
          label: "start: Scene 1",
          type: "LABEL",
        }),
        expect.objectContaining({
          id: "start__scene_2",
          label: "start: Scene 2",
          type: "LABEL",
        }),
        expect.objectContaining({ id: "end", label: "end", type: "LABEL" }),
      ]),
    );
    expect(result.nodes.find((node) => node.id === "start")).toBeUndefined();
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start__scene_1",
          target: "start__scene_2",
          kind: "sequence",
          label: "next",
        }),
      ]),
    );
  });

  it("does not split or relabel a label when scene appears before any scoped label content", async () => {
    const script = [
      "label start:",
      "    scene black",
      '    "line"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "no-split-first-scene.rpy",
      content: script,
    }]);

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "start", label: "start", type: "LABEL" }),
      ]),
    );
    expect(result.nodes.find((node) => node.id.startsWith("start__scene_")))
      .toBeUndefined();
  });

  it("triggers scene splitting when scene appears inside a menu option block", async () => {
    const script = [
      "label start:",
      "    menu:",
      '        "Pick":',
      '            "inside option 1"',
      '            "inside option 2"',
      '            "inside option 3"',
      "            scene bg beach",
      '            "after split trigger"',
      '    "outside option"',
      "",
      "label end:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu-option-scene-split.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((node) => node.type === "MENU");
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "start__scene_1",
          label: "start: Scene 1",
          type: "LABEL",
        }),
        expect.objectContaining({
          id: "start__scene_2",
          label: "start: Scene 2",
          type: "LABEL",
        }),
      ]),
    );
    expect(menuNode?.parentLabelId).toBe("start__scene_1");
    const sceneSplitEdge = result.edges.find(
      (edge) => edge.kind === "sequence" && edge.target === "start__scene_2",
    );
    expect(sceneSplitEdge).toBeDefined();
    expect(sceneSplitEdge?.source).toBe(menuNode?.id);
    expect(sceneSplitEdge?.label).toBe("Pick");
    expect(
      result.edges.find(
        (edge) =>
          edge.kind === "sequence" &&
          edge.source === "start__scene_1" &&
          edge.target === "start__scene_2",
      ),
    ).toBeUndefined();
  });

  it("uses next for scene split routing after menu options finish", async () => {
    const script = [
      "label start:",
      '    "before 1"',
      '    "before 2"',
      '    "before 3"',
      "    menu:",
      '        "Pick":',
      '            "inside option"',
      "    scene bg beach",
      '    "after split trigger"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu-fallthrough-scene-split.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });
    const menuNode = result.nodes.find((node) => node.type === "MENU");
    const sceneSplitEdge = result.edges.find(
      (edge) => edge.kind === "sequence" && edge.target === "start__scene_2",
    );

    expect(sceneSplitEdge).toBeDefined();
    expect(sceneSplitEdge?.source).toBe(menuNode?.id);
    expect(sceneSplitEdge?.label).toBe("next");
  });

  it("splits labels when a conditional header appears before a scene boundary", async () => {
    const script = [
      "label start:",
      '    "before 1"',
      '    "before 2"',
      '    "before 3"',
      "    if seen_intro:",
      "        pass",
      "    scene bg beach",
      '    "after split trigger"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "conditional-scene-split.rpy",
      content: script,
    }], { sceneSplitDialogueThreshold: 0 });

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "start__scene_1",
          label: "start: Scene 1",
          type: "LABEL",
        }),
        expect.objectContaining({
          id: "start__scene_2",
          label: "start: Scene 2",
          type: "LABEL",
        }),
      ]),
    );
  });

  it("enables scene-based label splitting by default for all parser variants", async () => {
    const script = [
      "label route:",
      '    "first 1"',
      '    "first 2"',
      '    "first 3"',
      "    scene bg city",
      '    "second"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles(
      [{ name: "st-scene-split.rpy", content: script }],
      { parserVariant: "st", sceneSplitDialogueThreshold: 0 },
    );

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "route__scene_1",
          label: "route: Scene 1",
          type: "LABEL",
        }),
        expect.objectContaining({
          id: "route__scene_2",
          label: "route: Scene 2",
          type: "LABEL",
        }),
      ]),
    );
  });

  // ── Menu detection ───────────────────────────────────────────────────────────

  it("parses an unnamed menu and creates a MENU node with a sequence edge from its parent label", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "Option A":',
      "            jump end_a",
      '        "Option B":',
      "            jump end_b",
      "",
      "label end_a:",
      '    "done a"',
      "",
      "label end_b:",
      '    "done b"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    // There must be a sequence edge from the parent label to the menu node
    const labelToMenu = result.edges.find(
      (e) => e.source === "choice" && e.target === menuNode?.id,
    );
    expect(labelToMenu).toBeDefined();
  });

  it("parses a named menu and uses the provided name as the menu node label", async () => {
    const script = [
      "label hub:",
      "    menu talk_options:",
      '        "Ask A":',
      "            jump dest_a",
      '        "Ask B":',
      "            jump dest_b",
      "",
      "label dest_a:",
      '    "a"',
      "",
      "label dest_b:",
      '    "b"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "named_menu.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.label).toBe("talk_options");
  });

  it("uses the dialogue prompt as the label for unnamed menu nodes", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "Should I go north or south?"',
      '        "Option A":',
      "            jump end_a",
      '        "Option B":',
      "            jump end_b",
      "",
      "label end_a:",
      '    "done a"',
      "",
      "label end_b:",
      '    "done b"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_dialogue.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.label).toBe("Should I go north or south?");
  });

  it("uses the first dialogue prompt as label and ignores subsequent dialogue prompts for unnamed menu labels", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "First prompt line"',
      '        "Second prompt line"',
      '        "Option A":',
      "            jump end_a",
      "",
      "label end_a:",
      '    "done a"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_multi_dialogue.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.label).toBe("First prompt line");
  });

  it("retains the custom name of a named menu even when it has dialogue prompts", async () => {
    const script = [
      "label choice:",
      "    menu talk_options:",
      '        "What should I talk about?"',
      '        "Option A":',
      "            jump end_a",
      "",
      "label end_a:",
      '    "done a"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "named_menu_dialogue.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.label).toBe("talk_options");
  });

  it("associates menu dialogue prompts directly with the MENU node", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "Should I go north or south?"',
      '        "Option A":',
      "            jump end_a",
      "",
      "label end_a:",
      '    "done a"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_dialogue_association.rpy",
      content: script,
    }]);

    const choiceNode = result.nodes.find((n) => n.id === "choice");
    const menuNode = result.nodes.find((n) => n.type === "MENU");

    // Parent label node should not have the menu's dialogue count/lines
    expect(choiceNode?.dialogueCount).toBe(0);
    expect(choiceNode?.dialogueLines).toBeUndefined();

    // Menu node should have the dialogue count/lines
    expect(menuNode?.dialogueCount).toBe(1);
    expect(menuNode?.dialogueLines).toEqual(["Should I go north or south?"]);
  });

  it("does not count menu option strings as dialogue", async () => {
    const script = [
      "label pick:",
      "    menu:",
      '        "Option A":',
      "            jump end",
      '        "Option B":',
      "            jump end",
      "",
      "label end:",
      '    "fin"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_opts.rpy",
      content: script,
    }]);

    const pickNode = result.nodes.find((n) => n.id === "pick");
    expect(pickNode?.dialogueCount).toBe(0);
  });

  // ── Jump parsing ─────────────────────────────────────────────────────────────

  it("parses a jump statement and creates a directed jump edge", async () => {
    const script = [
      "label start:",
      "    jump finish",
      "",
      "label finish:",
      '    "the end"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "jump.rpy",
      content: script,
    }]);

    const jumpEdge = result.edges.find(
      (e) => e.source === "start" && e.target === "finish",
    );
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge?.id).toMatch(/^jump_/);
  });

  it("jump prevents a fallthrough sequence edge to the next label", async () => {
    const script = [
      "label a:",
      "    jump c",
      "",
      "label b:",
      '    "b"',
      "",
      "label c:",
      '    "c"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "jump_no_fallthrough.rpy",
      content: script,
    }]);

    const fallthroughEdge = result.edges.find(
      (e) => e.source === "a" && e.target === "b" && e.label === "next",
    );
    expect(fallthroughEdge).toBeUndefined();
  });

  it("creates a jump edge with the menu option text as label when jump is inside a menu option", async () => {
    const script = [
      "label decide:",
      "    menu:",
      '        "Go north":',
      "            jump north",
      '        "Go south":',
      "            jump south",
      "",
      "label north:",
      '    "north"',
      "",
      "label south:",
      '    "south"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_jump.rpy",
      content: script,
    }]);

    const northEdge = result.edges.find((e) => e.target === "north");
    const southEdge = result.edges.find((e) => e.target === "south");

    expect(northEdge).toBeDefined();
    expect(northEdge?.label).toBe("Go north");

    expect(southEdge).toBeDefined();
    expect(southEdge?.label).toBe("Go south");
  });

  it("adds a menu fallthrough sequence edge when menu options do not jump/call", async () => {
    const script = [
      "label decide:",
      "    menu:",
      '        "Go north":',
      '            "You walk north for a bit."',
      '        "Go south":',
      '            "You walk south for a bit."',
      "",
      "label after_menu:",
      '    "after"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_fallthrough.rpy",
      content: script,
    }]);
    const menuNode = result.nodes.find((n) => n.type === "MENU");

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: menuNode?.id,
        target: "after_menu",
        kind: "sequence",
        label: "next",
      }),
    );
  });

  it("adds a menu fallthrough edge to the next menu when prior options have no explicit exit", async () => {
    const script = [
      "label decide:",
      "    menu:",
      '        "Talk":',
      '            "You chat a bit."',
      "",
      "    menu:",
      '        "Leave":',
      "            jump end",
      "",
      "label end:",
      '    "done"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_to_menu_fallthrough.rpy",
      content: script,
    }]);
    const menus = result.nodes.filter((n) => n.type === "MENU");
    expect(menus).toHaveLength(2);

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: menus[0]?.id,
        target: menus[1]?.id,
        kind: "sequence",
        label: "next",
      }),
    );
  });

  it("keeps nested menu jumps attached to the nested menu node and option text", async () => {
    const script = [
      "label start:",
      "    menu:",
      '        "Outer":',
      "            menu:",
      '                "Inner":',
      "                    jump inner_dest",
      "",
      "label inner_dest:",
      '    "done"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "nested_menu_source.rpy",
      content: script,
    }]);

    const menuNodes = result.nodes.filter((n) => n.type === "MENU");
    expect(menuNodes).toHaveLength(2);

    const innerJump = result.edges.find((e) =>
      e.target === "inner_dest" && e.id.startsWith("jump_")
    );
    expect(innerJump).toBeDefined();
    expect(innerJump?.label).toBe("Inner");
    expect(menuNodes.some((n) => n.id === innerJump?.source)).toBe(true);
  });

  it("uses stable edge IDs when a menu option text is not yet available", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "Option A":',
      "            jump end_a",
      "",
      "label end_a:",
      '    "done"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "unnamed_menu_edge_id.rpy",
      content: script,
    }]);

    const seqEdge = result.edges.find((e) =>
      e.source === "choice" && e.target.startsWith("menu_")
    );
    expect(seqEdge).toBeDefined();
    expect(seqEdge?.id).toBe(`seq_choice__${seqEdge?.target}`);
  });

  // ── Dialogue extraction ───────────────────────────────────────────────────────

  it("counts narrator dialogue (no character prefix)", async () => {
    const script = [
      "label narration:",
      '    "narrator speaks"',
      '    "again"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "narrator.rpy",
      content: script,
    }]);

    const node = result.nodes.find((n) => n.id === "narration");
    expect(node?.dialogueCount).toBe(2);
  });

  it("counts character dialogue (character name prefix)", async () => {
    const script = [
      "label scene:",
      '    e "hello there"',
      '    m "hi!"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "char_dialogue.rpy",
      content: script,
    }]);

    const node = result.nodes.find((n) => n.id === "scene");
    expect(node?.dialogueCount).toBe(2);
  });

  it("attributes dialogue inside a menu option block to the menu node", async () => {
    const script = [
      "label explain:",
      "    menu:",
      '        "Ask A":',
      '            e "answering A"',
      "            jump done",
      "",
      "label done:",
      '    "done"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_dialogue.rpy",
      content: script,
    }]);

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.dialogueCount).toBe(1);

    const labelNode = result.nodes.find((n) => n.id === "explain");
    expect(labelNode?.dialogueCount).toBe(0);
  });

  // ── Return keyword ───────────────────────────────────────────────────────────

  it("return prevents a fallthrough sequence edge to the next label", async () => {
    const script = [
      "label first:",
      '    "say something"',
      "    return",
      "",
      "label second:",
      '    "never reached via fallthrough"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "return.rpy",
      content: script,
    }]);

    const fallthroughEdge = result.edges.find(
      (e) =>
        e.source === "first" && e.target === "second" && e.label === "next",
    );
    expect(fallthroughEdge).toBeUndefined();
  });
});
