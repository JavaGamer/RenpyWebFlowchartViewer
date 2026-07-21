import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser";
import { extractPythonFunctionDefs, parsePythonBlockAst } from "../../src/parser/pythonAstParser";

describe("Phase 2: Python AST & Advanced Screen Action Engine", () => {
  it("parses Python function defs and AST calls", () => {
    const code = `
def dispatch_route(choice):
    renpy.call_in_new_context("route_" + choice)
    renpy.pop_call()
    TARGET_MAP["start"]()
`;
    const defs = extractPythonFunctionDefs(code);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("dispatch_route");

    const astCalls = parsePythonBlockAst(code);
    expect(astCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "call_in_new_context" }),
        expect.objectContaining({ type: "pop_call" }),
        expect.objectContaining({ type: "dict_jump", dictName: "TARGET_MAP" }),
      ]),
    );
  });

  it("extracts renpy.call_in_new_context and dict jumps in rpy script parsing", async () => {
    const files = [
      {
        name: "python_ast.rpy",
        content: `
label start:
    python:
        renpy.call_in_new_context("sub_routine")
        LABEL_MAP["chapter1"]()

label sub_routine:
    "Subroutine text"
    return

label chapter1:
    "Chapter 1 text"
`,
      },
    ];

    const result = await parseRenpyFiles(files);
    const subRoutineEdge = result.edges.find((e) => e.target === "sub_routine");
    expect(subRoutineEdge).toBeDefined();

    const chapter1Edge = result.edges.find((e) => e.target === "chapter1");
    expect(chapter1Edge).toBeDefined();
  });

  it("handles composite screen action arrays and ShowMenu actions", async () => {
    const files = [
      {
        name: "screen_actions.rpy",
        content: `
screen navigation():
    textbutton "Start Game" action [SetVariable("x", 1), Jump("chapter1")]
    textbutton "Open Menu" action ShowMenu("save_screen")

label start:
    "Start"

label chapter1:
    "Chapter 1"

label save_screen:
    "Save Screen"
`,
      },
    ];

    const result = await parseRenpyFiles(files);
    const chapter1Edge = result.edges.find((e) => e.target === "chapter1");
    expect(chapter1Edge).toBeDefined();

    const saveScreenEdge = result.edges.find((e) => e.target === "save_screen");
    expect(saveScreenEdge).toBeDefined();
  });
});
