import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser";

describe("storytellingMetricsAndListResolution", () => {
  it("tracks character dialogue line counts and word counts", async () => {
    const files = [
      {
        name: "dialogue.rpy",
        content: `
define e = Character("Eileen")
default mc = Character("Main Character")

label start:
    e "Hello reader. Welcome to Eileen's world."
    mc "Thank you."
    e "Let's explore."
`,
      },
    ];

    const result = await parseRenpyFiles(files);
    const startNode = result.nodes.find((n) => n.id === "start");
    expect(startNode).toBeDefined();
    expect(startNode?.characterDialogue).toBeDefined();

    // Eileen should have 2 lines and 8 words
    expect(startNode?.characterDialogue?.["e"]).toEqual({
      lineCount: 2,
      wordCount: 8,
    });

    // MC should have 1 line and 2 words
    expect(startNode?.characterDialogue?.["mc"]).toEqual({
      lineCount: 1,
      wordCount: 2,
    });
  });

  it("resolves static target expressions from list/array variables", async () => {
    const files = [
      {
        name: "list_resolve.rpy",
        content: `
define destinations = ["forest", "lake", "meadow"]

label start:
    $ current_dest = destinations[0]
    jump expression current_dest

label forest:
    "We are in the forest"

label lake:
    "We are by the lake"
`,
      },
    ];

    const result = await parseRenpyFiles(files);

    // Jump edge should target forest
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "forest",
        kind: "jump",
      }),
    );
  });

  it("resolves to all list elements when index is dynamic/unresolvable", async () => {
    const files = [
      {
        name: "list_resolve_all.rpy",
        content: `
define destinations = ["forest", "lake"]

label start:
    jump expression destinations[dynamic_index]

label forest:
    "Forest"

label lake:
    "Lake"
`,
      },
    ];

    const result = await parseRenpyFiles(files);

    // Jump edge should target both forest and lake
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "forest",
        kind: "jump",
      }),
    );
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "lake",
        kind: "jump",
      }),
    );
  });
});
