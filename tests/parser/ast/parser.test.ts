import { describe, expect, it } from "vitest";
import { parseRenpyScript } from "../../../src/parser/ast/parser.ts";
import type {
  IfStatementAst,
  JumpStatementAst,
  LabelStatementAst,
  MenuStatementAst,
  PythonStatementAst,
  SayStatementAst,
} from "../../../src/parser/ast/types.ts";

describe("RenpyParser (AST)", () => {
  it("parses global and local labels with proper lexical scoping", () => {
    const script = [
      "label prologue:",
      '    "Intro dialogue"',
      "    jump .ask_question",
      "",
      "label .ask_question:",
      '    "Local question"',
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script, "story.rpy");
    expect(ast.statements).toHaveLength(2);

    const prologue = ast.statements[0] as LabelStatementAst;
    expect(prologue.kind).toBe("label");
    expect(prologue.name).toBe("prologue");
    expect(prologue.canonicalName).toBe("prologue");
    expect(prologue.isLocal).toBe(false);

    const jumpStmt = prologue.body.find((s) =>
      s.kind === "jump"
    ) as JumpStatementAst;
    expect(jumpStmt).toBeDefined();
    expect(jumpStmt.target).toBe("prologue.ask_question");

    const localLabel = ast.statements[1] as LabelStatementAst;
    expect(localLabel.kind).toBe("label");
    expect(localLabel.name).toBe(".ask_question");
    expect(localLabel.canonicalName).toBe("prologue.ask_question");
    expect(localLabel.isLocal).toBe(true);
  });

  it("extracts dialogue lines, speakers, attributes, and pause durations", () => {
    const script = [
      "label scene_one:",
      '    "Narrator line with pause {w=2.0} inside."',
      '    eileen happy "Glad to see you!"',
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const label = ast.statements[0] as LabelStatementAst;

    const say1 = label.body[0] as SayStatementAst;
    expect(say1.kind).toBe("say");
    expect(say1.character).toBeUndefined();
    expect(say1.pauseDuration).toBe(2.0);

    const say2 = label.body[1] as SayStatementAst;
    expect(say2.kind).toBe("say");
    expect(say2.character).toBe("eileen");
    expect(say2.attributes).toEqual(["happy"]);
    expect(say2.text).toBe("Glad to see you!");
  });

  it("parses menus with narrator prompts and conditional choices", () => {
    const script = [
      "label decision_hub:",
      "    menu:",
      '        "What path should we choose?"',
      '        "Go left" if has_compass:',
      "            jump left_path",
      '        "Go right":',
      "            jump right_path",
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const label = ast.statements[0] as LabelStatementAst;
    const menu = label.body.find((s) => s.kind === "menu") as MenuStatementAst;

    expect(menu).toBeDefined();
    expect(menu.prompt).toBe("What path should we choose?");
    expect(menu.items).toHaveLength(2);

    expect(menu.items[0]!.text).toBe("Go left");
    expect(menu.items[0]!.condition).toBe("has_compass");
    const choiceJump = menu.items[0]!.body[0] as JumpStatementAst;
    expect(choiceJump.kind).toBe("jump");
    expect(choiceJump.target).toBe("left_path");

    expect(menu.items[1]!.text).toBe("Go right");
    expect(menu.items[1]!.condition).toBeUndefined();
  });

  it("extracts python control flow and mutations from $ and python: blocks", () => {
    const script = [
      "label check_status:",
      '    $ renpy.jump("bonus_stage")',
      "    $ player_points += 50",
      "    python:",
      '        renpy.call("subroutine_audit")',
      '        status_code = "OK"',
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const label = ast.statements[0] as LabelStatementAst;

    const dollar1 = label.body[0] as PythonStatementAst;
    expect(dollar1.kind).toBe("python");
    expect(dollar1.embeddedJumps).toHaveLength(1);
    expect(dollar1.embeddedJumps[0]!.target).toBe("bonus_stage");

    const dollar2 = label.body[1] as PythonStatementAst;
    expect(dollar2.mutations).toHaveLength(1);
    expect(dollar2.mutations[0]!.variableName).toBe("player_points");
    expect(dollar2.mutations[0]!.operator).toBe("+=");
    expect(dollar2.mutations[0]!.value).toBe("50");

    const pyBlock = label.body[2] as PythonStatementAst;
    expect(pyBlock.embeddedCalls).toHaveLength(1);
    expect(pyBlock.embeddedCalls[0]!.target).toBe("subroutine_audit");
    expect(pyBlock.mutations).toHaveLength(1);
    expect(pyBlock.mutations[0]!.variableName).toBe("status_code");
  });

  it("parses if / elif / else branch structures", () => {
    const script = [
      "label branch_test:",
      "    if score > 10:",
      "        jump good_route",
      "    elif score == 10:",
      "        jump neutral_route",
      "    else:",
      "        jump bad_route",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const label = ast.statements[0] as LabelStatementAst;
    const ifStmt = label.body[0] as IfStatementAst;

    expect(ifStmt.kind).toBe("if");
    expect(ifStmt.branches).toHaveLength(3);

    expect(ifStmt.branches[0]!.branchKind).toBe("if");
    expect(ifStmt.branches[0]!.condition).toBe("score > 10");

    expect(ifStmt.branches[1]!.branchKind).toBe("elif");
    expect(ifStmt.branches[1]!.condition).toBe("score == 10");

    expect(ifStmt.branches[2]!.branchKind).toBe("else");
  });

  it("parses call screen statements", () => {
    const script = [
      "label map_screen:",
      "    call screen navigation_hub",
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const label = ast.statements[0] as LabelStatementAst;
    const callScreen = label.body[0];

    expect(callScreen.kind).toBe("call_screen");
    expect((callScreen as { screenName: string }).screenName).toBe(
      "navigation_hub",
    );
  });

  it("parses parameterized labels", () => {
    const script = [
      'label chapter_intro(chapter_num, title="Default"): ',
      '    "Starting chapter"',
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const label = ast.statements[0] as LabelStatementAst;

    expect(label.parameters).toBeDefined();
    expect(label.parameters).toHaveLength(2);
    expect(label.parameters![0]!.name).toBe("chapter_num");
    expect(label.parameters![1]!.name).toBe("title");
  });
});
