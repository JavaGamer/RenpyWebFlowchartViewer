import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Variable State Mutation Tracking", () => {
  it("tracks variable assignments with arithmetic and boolean operators", async () => {
    const script = `
label start:
    $ affection = 0
    $ affection += 5
    $ affection -= 2
    $ has_key = True
    $ has_key = not has_key
    $ persistent.ending1 = True
    "You reach the crossroad."
    jump chapter1
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const startNode = result.nodes.find((n) => n.id === "start");
    expect(startNode).toBeDefined();
    expect(startNode?.mutations).toBeDefined();
    expect(startNode?.mutations?.length).toBeGreaterThanOrEqual(5);

    const mutations = startNode!.mutations!;
    expect(
      mutations.some((m) =>
        m.variableName === "affection" && m.operator === "=" && m.value === 0
      ),
    ).toBe(true);
    expect(
      mutations.some((m) =>
        m.variableName === "affection" && m.operator === "+=" && m.value === 5
      ),
    ).toBe(true);
    expect(
      mutations.some((m) =>
        m.variableName === "affection" && m.operator === "-=" && m.value === 2
      ),
    ).toBe(true);
    expect(
      mutations.some((m) =>
        m.variableName === "has_key" && m.operator === "=" && m.value === true
      ),
    ).toBe(true);
    expect(
      mutations.some((m) =>
        m.variableName === "has_key" && m.operator === "toggle"
      ),
    ).toBe(true);
    expect(
      mutations.some((m) =>
        m.variableName === "persistent.ending1" && m.isPersistent === true &&
        m.value === true
      ),
    ).toBe(true);
  });

  it("tracks *= and /= augmented assignments and preserves mutations during simplification", async () => {
    const script = `
label start:
    $ gold = 100
    $ gold *= 2
    $ gold /= 4
    jump next_step

label next_step:
    $ gold += 10
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const startNode = result.nodes.find((n) => n.id === "start");
    expect(startNode).toBeDefined();
    const mutations = startNode!.mutations!;
    expect(
      mutations.some((m) =>
        m.variableName === "gold" && m.operator === "*=" && m.value === 2
      ),
    ).toBe(true);
    expect(
      mutations.some((m) =>
        m.variableName === "gold" && m.operator === "/=" && m.value === 4
      ),
    ).toBe(true);
  });

  it("evaluates compound augmented assignments and dynamic jump targets with numeric dataflow", async () => {
    const script = `
label start:
    $ route_idx = 1
    $ step = 2
    $ route_idx += step
    jump expression ("chapter_" + str(route_idx))

label chapter_3:
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const edge = result.edges.find(
      (e) => e.source === "start" && e.target === "chapter_3",
    );
    expect(edge).toBeDefined();
  });
});
