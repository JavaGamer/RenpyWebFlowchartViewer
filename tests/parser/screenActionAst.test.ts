import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Composite Screen Action AST Unwrapping", () => {
  it("unwraps nested action lists and Confirm wrappers in screens", async () => {
    const script = [
      "label start:",
      "    screen navigation_menu:",
      '        textbutton "Start" action [SetVariable("started", True), Jump("chapter_one")]',
      '        textbutton "Quit" action Confirm("Quit game?", yes=Jump("exit_game"), no=Call("cancel_menu"))',
      "    call screen navigation_menu",
      "    return",
      "",
      "label chapter_one:",
      '    "Beginning chapter 1"',
      "    return",
      "",
      "label exit_game:",
      '    "Goodbye"',
      "    return",
      "",
      "label cancel_menu:",
      '    "Cancelled"',
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "screens.rpy",
      content: script,
    }]);

    const jumpEdgeList = result.edges.find((e) => e.target === "chapter_one" && e.originType === "screen");
    const confirmYesEdge = result.edges.find((e) => e.target === "exit_game" && e.originType === "screen");
    const confirmNoEdge = result.edges.find((e) => e.target === "cancel_menu" && e.originType === "screen");

    expect(jumpEdgeList).toBeDefined();
    expect(jumpEdgeList?.originType).toBe("screen");

    expect(confirmYesEdge).toBeDefined();
    expect(confirmYesEdge?.originType).toBe("screen");

    expect(confirmNoEdge).toBeDefined();
    expect(confirmNoEdge?.originType).toBe("screen");
  });
});
