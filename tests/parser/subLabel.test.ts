import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Sub-label Scoping (.sub_label)", () => {
  it("resolves sub-label definitions and jumps within parent label scope", async () => {
    const script = [
      "label main_story:",
      '    "Welcome to the main story."',
      "    jump .sub_choice",
      "",
      "label .sub_choice:",
      '    "This is a local sub-label."',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "script.rpy",
      content: script,
    }]);

    const parentNode = result.nodes.find((n) => n.id === "main_story");
    const subNode = result.nodes.find((n) => n.id === "main_story.sub_choice");

    expect(parentNode).toBeDefined();
    expect(subNode).toBeDefined();
    expect(subNode?.label).toBe(".sub_choice");
    expect(subNode?.isSubLabel).toBe(true);
    expect(subNode?.parentLabelScope).toBe("main_story");

    const jumpEdge = result.edges.find(
      (e) => e.source === "main_story" && e.target === "main_story.sub_choice",
    );
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge?.kind).toBe("jump");
  });
});
