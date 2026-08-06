import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Call Context Tagging & Resolution", () => {
  it("tags call and call_return edges with matching callContext metadata", async () => {
    const script = [
      "label label_a:",
      "    call shared_minigame(score=10)",
      "    jump label_b",
      "",
      "label label_b:",
      "    call shared_minigame(score=20)",
      "    jump end_label",
      "",
      "label shared_minigame(score=0):",
      '    "playing minigame"',
      "    return",
      "",
      "label end_label:",
      '    "done"',
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "shared_subroutine.rpy", content: script },
    ]);

    const callEdges = result.edges.filter((e) => e.kind === "call");
    const returnEdges = result.edges.filter((e) => e.kind === "call_return");

    expect(callEdges).toHaveLength(2);
    expect(returnEdges).toHaveLength(2);

    const callA = callEdges.find((e) => e.source === "label_a");
    const callB = callEdges.find((e) => e.source === "label_b");

    expect(callA?.callContext).toBeDefined();
    expect(callA?.callContext?.callSiteId).toBe("label_a");
    expect(callA?.callContext?.returnTargetId).toBe("label_a");

    expect(callB?.callContext).toBeDefined();
    expect(callB?.callContext?.callSiteId).toBe("label_b");
    expect(callB?.callContext?.returnTargetId).toBe("label_b");

    const retA = returnEdges.find((e) => e.target === "label_a");
    const retB = returnEdges.find((e) => e.target === "label_b");

    expect(retA?.callContext).toBeDefined();
    expect(retA?.callContext?.callEdgeId).toBe(callA?.id);
    expect(retA?.callContext?.callContextId).toBe(
      callA?.callContext?.callContextId,
    );

    expect(retB?.callContext).toBeDefined();
    expect(retB?.callContext?.callEdgeId).toBe(callB?.id);
    expect(retB?.callContext?.callContextId).toBe(
      callB?.callContext?.callContextId,
    );
  });

  it("generates distinct call edge IDs for multiple call statements in the same label", async () => {
    const script = [
      "label multi_caller:",
      "    call helper",
      '    "between calls"',
      "    call helper",
      "    return",
      "",
      "label helper:",
      "    return",
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "multi_call.rpy", content: script },
    ]);

    const callEdges = result.edges.filter(
      (e) => e.source === "multi_caller" && e.target === "helper",
    );
    expect(callEdges.length).toBeGreaterThanOrEqual(2);
    expect(callEdges[0]!.id).not.toBe(callEdges[1]!.id);
  });

  it("materializes call_return edges for called subroutines with explicit returns", async () => {
    const script = [
      "label caller:",
      "    call sub_with_return",
      "    jump done",
      "",
      "label sub_with_return:",
      "    return",
      "",
      "label done:",
      '    "finished"',
    ].join("\n");

    const result = await parseRenpyFiles([
      { name: "explicit_return.rpy", content: script },
    ]);

    const returnEdge = result.edges.find(
      (e) => e.source === "sub_with_return" && e.target === "caller",
    );
    expect(returnEdge).toBeDefined();
    expect(returnEdge?.kind).toBe("call_return");
  });

  it("remaps callContext callSiteId and returnTargetId when scene splitting occurs", async () => {
    // Place call BEFORE scene statement and dialogue threshold to trigger scene split
    const lines = [
      "label long_scene:",
      "    call sub_helper",
    ];
    for (let i = 0; i < 18; i++) {
      lines.push(`    "dialogue line ${i}"`);
    }
    lines.push("    scene bg main_menu");
    lines.push('    "after scene split"');
    lines.push("");
    lines.push("label sub_helper:");
    lines.push("    return");

    const result = await parseRenpyFiles([
      { name: "scene_split.rpy", content: lines.join("\n") },
    ]);

    const callEdge = result.edges.find((e) => e.kind === "call");
    const returnEdge = result.edges.find((e) => e.kind === "call_return");

    expect(callEdge).toBeDefined();
    expect(callEdge?.callContext).toBeDefined();
    expect(callEdge?.callContext?.callSiteId).toBe("long_scene__scene_1");
    expect(callEdge?.callContext?.returnTargetId).toBe("long_scene__scene_1");

    expect(returnEdge).toBeDefined();
    expect(returnEdge?.callContext).toBeDefined();
    expect(returnEdge?.callContext?.returnTargetId).toBe("long_scene__scene_1");
  });
});
