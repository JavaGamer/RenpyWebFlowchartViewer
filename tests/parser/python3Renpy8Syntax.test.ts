import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Python 3 & Ren'Py 8 Syntax Expansion", () => {
  it("parses match/case statements into decision nodes and branching edges", async () => {
    const script = `
label start:
    match weather:
        case "sunny":
            jump park
        case "rainy":
            jump home
        case _:
            jump anywhere

label park:
    return
label home:
    return
label anywhere:
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const decisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(decisionNode).toBeDefined();

    // Verify branching edges from decision node
    const sunnyEdge = result.edges.find(
      (e) => e.source === decisionNode!.id && e.target === "park",
    );
    expect(sunnyEdge).toBeDefined();

    const rainyEdge = result.edges.find(
      (e) => e.source === decisionNode!.id && e.target === "home",
    );
    expect(rainyEdge).toBeDefined();

    const wildcardEdge = result.edges.find(
      (e) => e.source === decisionNode!.id && e.target === "anywhere",
    );
    expect(wildcardEdge).toBeDefined();
  });

  it("evaluates and connects inline ternary jumps", async () => {
    const script = `
label start:
    jump expression ("ending_good" if affection > 10 else "ending_bad")

label ending_good:
    return

label ending_bad:
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const goodEdge = result.edges.find(
      (e) => e.source === "start" && e.target === "ending_good",
    );
    const badEdge = result.edges.find(
      (e) => e.source === "start" && e.target === "ending_bad",
    );

    expect(goodEdge).toBeDefined();
    expect(badEdge).toBeDefined();
  });

  it("handles case 0: and pattern guard clauses without flagging as dead code", async () => {
    const script = `
label start:
    match status:
        case 0:
            jump zero_state
        case val if val > 100:
            jump high_state

label zero_state:
    return

label high_state:
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const decisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(decisionNode).toBeDefined();

    const zeroEdge = result.edges.find(
      (e) => e.source === decisionNode!.id && e.target === "zero_state",
    );
    expect(zeroEdge).toBeDefined();
    // Must NOT be flagged as statically false
    expect(zeroEdge?.conditionIsStaticallyFalse).toBeFalsy();
    // Condition expression should synthesize comparison with match expression
    expect(zeroEdge?.condition?.expression).toBe("(status) == (0)");

    const highEdge = result.edges.find(
      (e) => e.source === decisionNode!.id && e.target === "high_state",
    );
    expect(highEdge).toBeDefined();
    expect(highEdge?.condition?.expression).toContain("val > 100");
  });

  it("evaluates unparenthesized inline ternary jumps", async () => {
    const script = `
label start:
    jump expression "route_alpha" if choice_made else "route_beta"

label route_alpha:
    return

label route_beta:
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const alphaEdge = result.edges.find(
      (e) => e.source === "start" && e.target === "route_alpha",
    );
    const betaEdge = result.edges.find(
      (e) => e.source === "start" && e.target === "route_beta",
    );

    expect(alphaEdge).toBeDefined();
    expect(betaEdge).toBeDefined();
  });

  it("prioritizes python early statements at -50000 regardless of init offset", async () => {
    const script = `
init offset = 100

init python early:
    early_var = 1

python early:
    earlier_var = 2
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    expect(result.initVariables?.has("early_var")).toBe(true);
    expect(result.initVariables?.has("earlier_var")).toBe(true);
  });

  it("handles Python 3 or-patterns in match/case without bitwise distortion", async () => {
    const script = `
label start:
    match code:
        case 1 | 2:
            jump small_code
        case "A" | "B" if active:
            jump letter_code
        case _:
            jump other_code

label small_code:
    return
label letter_code:
    return
label other_code:
    return
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: script,
      },
    ]);

    const decisionNode = result.nodes.find((n) => n.type === "DECISION");
    expect(decisionNode).toBeDefined();

    const smallEdge = result.edges.find(
      (e) => e.source === decisionNode!.id && e.target === "small_code",
    );
    expect(smallEdge).toBeDefined();
    expect(smallEdge?.condition?.expression).toContain(" or ");
    expect(smallEdge?.condition?.expression).toBe(
      "(((code) == (1)) or ((code) == (2)))",
    );

    const letterEdge = result.edges.find(
      (e) => e.source === decisionNode!.id && e.target === "letter_code",
    );
    expect(letterEdge).toBeDefined();
    expect(letterEdge?.condition?.expression).toContain("active");
  });
});
