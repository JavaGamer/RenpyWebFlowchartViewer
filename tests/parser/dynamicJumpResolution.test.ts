import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Dynamic Jump & Call Resolution", () => {
  it("resolves dynamic jump expressions with pattern matching against known labels", async () => {
    const file = {
      name: "script.rpy",
      content: `
label start:
    $ ch_num = 1
    jump expression ("chapter_" + str(ch_num))

label chapter_1:
    "Welcome to Chapter 1"
    return

label chapter_2:
    "Welcome to Chapter 2"
    return
`,
    };

    const res = await parseRenpyFiles([file]);
    const jumpEdges = res.edges.filter((e) => e.kind === "jump");
    expect(jumpEdges.length).toBeGreaterThan(0);
    const targetIds = jumpEdges.map((e) => e.target);
    expect(targetIds).toContain("chapter_1");

    const dynamicDiagnostics = res.diagnostics?.filter(
      (d) => d.code === "dynamic_target",
    );
    expect(dynamicDiagnostics?.length ?? 0).toBe(0);
  });

  it("evaluates custom dynamicJumpRules from ParseOptions", async () => {
    const file = {
      name: "script.rpy",
      content: `
label start:
    jump expression my_dynamic_target

label chapter_a:
    return

label chapter_b:
    return
`,
    };

    const res = await parseRenpyFiles([file], {
      dynamicJumpRules: [
        {
          expressionPattern: "my_dynamic_target",
          targets: ["chapter_a", "chapter_b"],
        },
      ],
    });

    const jumpEdges = res.edges.filter((e) => e.kind === "jump");
    expect(jumpEdges.length).toBe(2);
    const targetIds = jumpEdges.map((e) => e.target);
    expect(targetIds).toContain("chapter_a");
    expect(targetIds).toContain("chapter_b");

    const dynamicDiagnostics = res.diagnostics?.filter(
      (d) => d.code === "dynamic_target",
    );
    expect(dynamicDiagnostics?.length ?? 0).toBe(0);
  });
});
