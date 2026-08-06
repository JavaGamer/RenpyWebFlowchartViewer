import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Parameterized Labels & Call Arguments", () => {
  it("parses label parameter declarations and call arguments", async () => {
    const file = {
      name: "script.rpy",
      content: `
label start:
    call chapter_1("Alex", chapter_id=2)
    return

label chapter_1(player_name, chapter_id=1):
    if chapter_id == 2:
        "Special Chapter 2 Dialogue"
    return
`,
    };

    const res = await parseRenpyFiles([file]);
    const chapterNode = res.nodes.find((n) => n.id === "chapter_1");
    expect(chapterNode).toBeDefined();
    expect(chapterNode?.parameters).toBeDefined();
    expect(chapterNode?.parameters?.length).toBe(2);
    expect(chapterNode?.parameters?.[0]?.name).toBe("player_name");
    expect(chapterNode?.parameters?.[1]?.name).toBe("chapter_id");
    expect(chapterNode?.parameters?.[1]?.defaultValue).toBe("1");

    const callEdge = res.edges.find((e) =>
      e.kind === "call" && e.target === "chapter_1"
    );
    expect(callEdge).toBeDefined();
    expect(callEdge?.arguments).toBeDefined();
    expect(callEdge?.arguments?.length).toBe(2);

    const falseEdges = res.edges.filter((e) => e.conditionIsStaticallyFalse);
    expect(falseEdges.length).toBe(0);
  });
});
