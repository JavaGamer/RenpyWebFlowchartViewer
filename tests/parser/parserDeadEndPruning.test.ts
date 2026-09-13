import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Dead-end decision node pruning", () => {
  it("prunes inline cosmetic if statements when pruneDeadEndDecisions is true", async () => {
    const script = `
label start:
    "Hello world"
    if wearing_glasses:
        "Looking sharp with glasses!"
    "Continuing the story..."
    jump chapter2

label chapter2:
    "End of story"
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "script.rpy", content: script }],
      { pruneDeadEndDecisions: true },
    );

    const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisionNodes).toHaveLength(0);

    const labels = result.nodes.filter((n) => n.type === "LABEL");
    expect(labels.map((l) => l.id)).toEqual(["start", "chapter2"]);

    // Sequence from start to chapter2 should be preserved
    const jumpEdge = result.edges.find((e) =>
      e.source === "start" && e.target === "chapter2"
    );
    expect(jumpEdge).toBeDefined();
  });

  it("preserves raw decision nodes when pruneDeadEndDecisions is false or omitted", async () => {
    const script = `
label start:
    "Hello world"
    if wearing_glasses:
        "Looking sharp with glasses!"
    "Continuing the story..."
    jump chapter2

label chapter2:
    "End of story"
    return
`;

    const resultDefault = await parseRenpyFiles([
      { name: "script.rpy", content: script },
    ]);
    const decisionNodesDefault = resultDefault.nodes.filter((n) =>
      n.type === "DECISION"
    );
    expect(decisionNodesDefault.length).toBeGreaterThan(0);

    const result = await parseRenpyFiles(
      [{ name: "script.rpy", content: script }],
      { pruneDeadEndDecisions: false },
    );

    const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisionNodes.length).toBeGreaterThan(0);
  });

  it("preserves while and for loops even when pruneDeadEndDecisions is true", async () => {
    const script = `
label start:
    $ i = 0
    while i < 3:
        "Looping..."
        $ i += 1
    for item in ["a", "b"]:
        "Item [item]"
    return
`;
    const result = await parseRenpyFiles(
      [{ name: "script.rpy", content: script }],
      { pruneDeadEndDecisions: true },
    );
    const whileNode = result.nodes.find(
      (n) => n.type === "DECISION" && n.condition?.branchKind === "while",
    );
    expect(whileNode).toBeDefined();
    const forNode = result.nodes.find(
      (n) => n.type === "DECISION" && n.condition?.branchKind === "for",
    );
    expect(forNode).toBeDefined();
  });

  it("preserves branching decision nodes that jump to different labels", async () => {
    const script = `
label start:
    "Before fork"
    if has_key:
        jump secret_room
    else:
        jump main_hall

label secret_room:
    "You found the secret!"
    return

label main_hall:
    "You entered the main hall."
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "script.rpy", content: script }],
      { pruneDeadEndDecisions: true },
    );

    const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisionNodes).toHaveLength(1);

    const decision = decisionNodes[0]!;
    // Should have outgoing transitions to secret_room and main_hall
    const outEdges = result.edges.filter((e) => e.source === decision.id);
    expect(outEdges.length).toBeGreaterThanOrEqual(1);

    const targetIds = outEdges.map((e) => e.target);
    expect(targetIds).toContain("secret_room");
  });

  it("preserves decisions that branch to game over or alternative labels", async () => {
    const script = `
label game_over_check:
    "Checking status..."
    if health <= 0:
        "You perished."
        jump game_over
    "Still alive!"
    jump continue_game

label game_over:
    "Game over screen."
    return

label continue_game:
    "Moving forward."
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "script.rpy", content: script }],
      { pruneDeadEndDecisions: true },
    );

    const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisionNodes).toHaveLength(1);

    const outEdges = result.edges.filter((e) =>
      e.source === decisionNodes[0]!.id
    );
    expect(outEdges.some((e) => e.target === "game_over")).toBe(true);
  });

  it("prunes cascaded dead-end decisions where nested conditions go nowhere", async () => {
    const script = `
label start:
    "Scene begins"
    if weather == 'sunny':
        if time == 'morning':
            "A fine sunny morning."
        else:
            "A sunny afternoon."
    else:
        "Cloudy skies."
    "The day goes on..."
    jump chapter2

label chapter2:
    "End"
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "script.rpy", content: script }],
      { pruneDeadEndDecisions: true },
    );

    const decisionNodes = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisionNodes).toHaveLength(0);

    const startToChapter2 = result.edges.find((e) =>
      e.source === "start" && e.target === "chapter2"
    );
    expect(startToChapter2).toBeDefined();
  });

  it("prunes cosmetic decisions without removing real menus", async () => {
    const script = `
label start:
    "Introduction"
    if mood == 'happy':
        "Smile!"
    menu:
        "Option A":
            jump path_a
        "Option B":
            jump path_b

label path_a:
    if wearing_hat:
        "Tips hat"
    "Path A ending"
    return

label path_b:
    "Path B ending"
    return
`;

    const result = await parseRenpyFiles(
      [{ name: "script.rpy", content: script }],
      { pruneDeadEndDecisions: true },
    );

    const menus = result.nodes.filter((n) => n.type === "MENU");
    expect(menus).toHaveLength(1);

    const decisions = result.nodes.filter((n) => n.type === "DECISION");
    expect(decisions).toHaveLength(0);

    const menuEdges = result.edges.filter((e) => e.source === menus[0]!.id);
    expect(menuEdges).toHaveLength(2);
    expect(menuEdges.map((e) => e.target)).toEqual(
      expect.arrayContaining(["path_a", "path_b"]),
    );
  });

  it("scenario: Wish You Were Her prunes all dead-end decisions without losing real menus or branch points", async () => {
    const fs = await import("node:fs");
    const scenarioPath =
      "C:/Users/gamin/Downloads/Games/StudentTransfer-9.2-pc-arm/game/scenario/wishyouwereher/story/Wish You Were Her.rpy";
    if (!fs.existsSync(scenarioPath)) return;

    const content = fs.readFileSync(scenarioPath, "utf-8");
    const result = await parseRenpyFiles(
      [{
        name: "Wish You Were Her.rpy",
        content,
      }],
      { pruneDeadEndDecisions: true },
    );

    const menus = result.nodes.filter((n) => n.type === "MENU");
    // All 4 real story menus in Wish You Were Her remain intact
    expect(menus.length).toBe(4);

    const decisions = result.nodes.filter((n) => n.type === "DECISION");
    // Check that every surviving decision node has at least one outgoing edge
    for (const dec of decisions) {
      const outEdges = result.edges.filter((e) => e.source === dec.id);
      expect(outEdges.length).toBeGreaterThan(0);
    }

    // Dead-end decision count is exactly 0 (previously 59!)
    const deadEndDecisions = decisions.filter((d) => {
      const outEdges = result.edges.filter((e) => e.source === d.id);
      return outEdges.length === 0;
    });
    expect(deadEndDecisions).toHaveLength(0);

    // True branching points (e.g. decision_35 branching to walkHome and friendLink) are preserved
    expect(
      decisions.some((d) =>
        d.label?.includes("fMichelleWitch or fScarletHorse")
      ),
    ).toBe(true);
  });
});
