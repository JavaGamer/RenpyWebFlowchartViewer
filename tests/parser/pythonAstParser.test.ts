import { describe, expect, it } from "vitest";
import { parsePythonBlock } from "../../src/parser/handlers/python/pythonAstParser.ts";
import {
  extractLiteralTarget,
  parseDictLiteral,
} from "../../src/parser/handlers/jumpCallHandler.ts";

describe("pythonAstParser adversarial review fixes", () => {
  it("extracts simple variable assignments", () => {
    const code = `target = "chapter_1"`;
    const result = parsePythonBlock(code);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({
      variable: "target",
      valueLiteral: "chapter_1",
    });
  });

  it("extracts typed variable assignments", () => {
    const code = `target: str = "chapter_2"`;
    const result = parsePythonBlock(code);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({
      variable: "target",
      typeAnnotation: ": str",
      valueLiteral: "chapter_2",
    });
  });

  it("handles chained assignments correctly (a = b = 'label')", () => {
    const code = `a = b = "common_label"`;
    const result = parsePythonBlock(code);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0]?.variable).toBe("a");
    expect(result.assignments[0]?.valueLiteral).toBe("common_label");
    expect(result.assignments[1]?.variable).toBe("b");
    expect(result.assignments[1]?.valueLiteral).toBe("common_label");
  });

  it("handles string prefixes correctly (r, f, b, u)", () => {
    const code = `
raw_str = r"raw_target"
f_str = f"f_target"
bytes_str = b"bytes_target"
`;
    const result = parsePythonBlock(code);
    expect(result.assignments).toHaveLength(3);
    expect(result.assignments[0]?.valueLiteral).toBe("raw_target");
    expect(result.assignments[1]?.valueLiteral).toBe("f_target");
    expect(result.assignments[2]?.valueLiteral).toBe("bytes_target");
  });

  it("aligns dict literals without misaligning key-value pairs when non-string values exist", () => {
    const code =
      `routes = {"good": "good_end", "dynamic": dynamic_var, "bad": "bad_end", "count": 42}`;
    const result = parsePythonBlock(code);
    expect(result.assignments).toHaveLength(1);
    const dict = result.assignments[0]?.valueDict;
    expect(dict).toBeDefined();
    expect(dict?.get("good")).toBe("good_end");
    expect(dict?.get("bad")).toBe("bad_end");
    expect(dict?.has("dynamic")).toBe(false);
    expect(dict?.has("count")).toBe(false);
  });

  it("extracts list and dict literal assignments", () => {
    const code = `
routes = {"good": "good_end", "bad": "bad_end"}
scenes = ["scene_1", "scene_2"]
`;
    const result = parsePythonBlock(code);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments[0]?.variable).toBe("routes");
    expect(result.assignments[0]?.valueDict?.get("good")).toBe("good_end");
    expect(result.assignments[0]?.valueDict?.get("bad")).toBe("bad_end");

    expect(result.assignments[1]?.variable).toBe("scenes");
    expect(result.assignments[1]?.valueList).toEqual(["scene_1", "scene_2"]);
  });

  it("extracts renpy.jump and renpy.call direct function calls", () => {
    const code = `
renpy.jump("start_label")
renpy.call("sub_routine")
`;
    const result = parsePythonBlock(code);
    expect(result.directCalls).toHaveLength(2);
    expect(result.directCalls[0]).toMatchObject({
      functionName: "jump",
      targetExpression: '"start_label"',
    });
    expect(result.directCalls[1]).toMatchObject({
      functionName: "call",
      targetExpression: '"sub_routine"',
    });
  });

  it("extracts literal targets with f-strings and raw strings in extractLiteralTarget", () => {
    expect(extractLiteralTarget(`f"my_target"`)).toBe("my_target");
    expect(extractLiteralTarget(`r"my_raw_target"`)).toBe("my_raw_target");
    expect(extractLiteralTarget(`fr"my_fr_target"`)).toBe("my_fr_target");
  });

  it("parses dict literals with mixed non-string values in parseDictLiteral without returning null", () => {
    const dict = parseDictLiteral(
      `{"valid": "target_1", "number": 123, "valid2": "target_2"}`,
    );
    expect(dict).toBeDefined();
    expect(dict?.get("valid")).toBe("target_1");
    expect(dict?.get("valid2")).toBe("target_2");
    expect(dict?.has("number")).toBe(false);
  });
});
