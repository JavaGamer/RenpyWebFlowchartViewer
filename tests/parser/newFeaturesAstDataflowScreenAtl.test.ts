import { describe, expect, it } from "vitest";
import {
  evaluatePythonAstExpression,
  parsePythonBlock,
} from "../../src/domain/index.ts";
import { extractAtlVisualAssets } from "../../src/parser/handlers/atlParser.ts";
import { extractScreenActionExpressions } from "../../src/parser/handlers/screen/screenActionExtractor.ts";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

async function parseScriptToGraph(script: string) {
  return await parseRenpyFiles([{ name: "script.rpy", content: script }]);
}

describe("Python Expression AST Parser", () => {
  it("parses multi-variable tuple/list unpacking", () => {
    const code = `$ x, y = 1, 2\n$ (a, b) = ("chapter_a", "chapter_b")`;
    const parsed = parsePythonBlock(code);

    expect(parsed.assignments.length).toBe(4);
    expect(parsed.assignments[0]!.variable).toBe("x");
    expect(parsed.assignments[0]!.valueExpression).toBe("1");
    expect(parsed.assignments[1]!.variable).toBe("y");
    expect(parsed.assignments[1]!.valueExpression).toBe("2");
    expect(parsed.assignments[2]!.variable).toBe("a");
    expect(parsed.assignments[2]!.valueLiteral).toBe("chapter_a");
    expect(parsed.assignments[3]!.variable).toBe("b");
    expect(parsed.assignments[3]!.valueLiteral).toBe("chapter_b");
  });

  it("parses augmented assignments and strictly collects LHS target variables", () => {
    const code = `count += 1\nscore *= 2\ntarget = source_var + 5`;
    const parsed = parsePythonBlock(code);

    expect(parsed.assignments.length).toBe(3);
    expect(parsed.assignments[0]!.variable).toBe("count");
    expect(parsed.assignments[0]!.valueExpression).toBe("1");
    expect(parsed.assignments[1]!.variable).toBe("score");
    expect(parsed.assignments[1]!.valueExpression).toBe("2");
    expect(parsed.assignments[2]!.variable).toBe("target");
  });

  it("evaluates ternary expressions, function calls, and modulo/floor-div/pow operators", () => {
    const expr1 = `"chapter_2" if visited else "chapter_1"`;
    const resTrue = evaluatePythonAstExpression(expr1, { visited: true });
    expect(resTrue.value).toBe("chapter_2");
    expect(resTrue.isStaticallyEvaluated).toBe(true);

    const resFalse = evaluatePythonAstExpression(expr1, { visited: false });
    expect(resFalse.value).toBe("chapter_1");
    expect(resFalse.isStaticallyEvaluated).toBe(true);

    const resUnknown = evaluatePythonAstExpression(expr1, {});
    expect(resUnknown.stringCandidates).toContain("chapter_2");
    expect(resUnknown.stringCandidates).toContain("chapter_1");

    const funcExpr = `len("hello") + int("5")`;
    const resFunc = evaluatePythonAstExpression(funcExpr);
    expect(resFunc.value).toBe(10);
    expect(resFunc.isStaticallyEvaluated).toBe(true);

    const opExpr = `(10 % 3) + (17 // 5) + (2 ** 3)`;
    const resOp = evaluatePythonAstExpression(opExpr);
    expect(resOp.value).toBe(1 + 3 + 8);
    expect(resOp.isStaticallyEvaluated).toBe(true);
  });
});

describe("Dataflow Tracking for Dynamic Jumps/Calls", () => {
  it("tracks preceding node variable assignments to resolve dynamic jump targets", async () => {
    const script = `
label start:
    $ current_chapter = "chapter_2"
    jump expression current_chapter

label chapter_2:
    "Welcome to Chapter 2"
`;
    const graph = await parseScriptToGraph(script);
    const jumpEdge = graph.edges.find((e) => e.kind === "jump");

    expect(jumpEdge).toBeDefined();
    expect(jumpEdge?.source).toBe("start");
    expect(jumpEdge?.target).toBe("chapter_2");
  });

  it("handles self-referential / cyclic variable assignments safely", async () => {
    const script = `
label loop:
    $ current_chapter = current_chapter
    jump expression current_chapter
`;
    const graph = await parseScriptToGraph(script);
    expect(graph.nodes.length).toBeGreaterThan(0);
  });
});

describe("Interactive Screen Actions & Visual Navigation", () => {
  it("extracts screen actions from textbutton, imagebutton, and timer constructs", () => {
    const screenBlock = `
screen main_menu:
    textbutton "Start Game" action Jump("start_label")
    imagebutton auto "gui/button_%s.png" action Show("options_screen")
    timer 3.5 action Return()
`;
    const extracted = extractScreenActionExpressions(screenBlock);
    expect(extracted.length).toBe(3);
    expect(extracted[0]!.expression).toContain('Jump("start_label")');
    expect(extracted[1]!.expression).toContain('Show("options_screen")');
    expect(extracted[2]!.expression).toContain("Return()");
    expect(extracted[2]!.timeout?.durationSeconds).toBe(3.5);
  });

  it("links screen call actions into flowchart edges", async () => {
    const script = `
label start:
    call screen main_menu

screen main_menu:
    textbutton "Play" action Jump("game_start")

label game_start:
    "Game begins"
`;
    const graph = await parseScriptToGraph(script);
    const jumpEdge = graph.edges.find((e) => e.target === "game_start");
    expect(jumpEdge).toBeDefined();
  });
});

describe("ATL (Animation & Transformation Language)", () => {
  it("extracts visual asset dependencies from ATL blocks and transform declarations", () => {
    const atlBlock = `
transform bounce:
    xalign 0.5
    "images/ball_frame1.png"
    pause 0.2
    "images/ball_frame2.png"
    contains "sparkle_effect.png" # inline comment
`;
    const assets = extractAtlVisualAssets(atlBlock);
    expect(assets.length).toBe(3);
    expect(assets.map((a) => a.asset)).toEqual([
      "images/ball_frame1.png",
      "images/ball_frame2.png",
      "sparkle_effect.png",
    ]);
  });
});
