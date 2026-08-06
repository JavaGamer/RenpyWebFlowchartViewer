import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Native Script Loops (while / for)", () => {
  it("classifies while_loop and for_loop roles on decision nodes", async () => {
    const file = {
      name: "script.rpy",
      content: `
label start:
    $ i = 0
    while i < 3:
        "Loop body"
        $ i += 1

    for ch in ["ch1", "ch2"]:
        "Chapter [ch]"
    return
`,
    };

    const res = await parseRenpyFiles([file]);
    const whileNode = res.nodes.find(
      (n) => n.type === "DECISION" && n.condition?.branchKind === "while",
    );
    expect(whileNode).toBeDefined();
    expect(whileNode?.role).toBe("while_loop");

    const forNode = res.nodes.find(
      (n) => n.type === "DECISION" && n.condition?.branchKind === "for",
    );
    expect(forNode).toBeDefined();
    expect(forNode?.role).toBe("for_loop");

    const infiniteLoopDiagnostics = res.diagnostics?.filter(
      (d) => d.context?.category === "infinite_loop",
    );
    expect(infiniteLoopDiagnostics?.length ?? 0).toBe(0);
  });
});
