import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser";

describe("parseRenpyFiles", () => {
  // ── Call parsing ─────────────────────────────────────────────────────────────

  it('parses a call statement and creates a directed call edge labeled "call"', async () => {
    const script = [
      "label main:",
      "    call subroutine",
      '    "back from sub"',
      "",
      "label subroutine:",
      '    "in sub"',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "call.rpy",
      content: script,
    }]);

    const callEdge = result.edges.find(
      (e) => e.source === "main" && e.target === "subroutine",
    );
    expect(callEdge).toBeDefined();
    expect(callEdge?.id).toMatch(/^call_/);
    expect(callEdge?.label).toBe("call");
    expect(callEdge?.kind).toBe("call");
  });

  it("call does not prevent a fallthrough sequence edge to the next label", async () => {
    const script = [
      "label caller:",
      "    call helper",
      "",
      "label after_caller:",
      '    "after"',
      "",
      "label helper:",
      '    "help"',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "call_fallthrough.rpy",
      content: script,
    }]);

    const fallthroughEdge = result.edges.find(
      (e) =>
        e.source === "caller" && e.target === "after_caller" &&
        e.label === "next",
    );
    expect(fallthroughEdge).toBeDefined();
  });

  it("does not suppress fallthrough when jump is inside a conditional branch", async () => {
    const script = [
      "label start:",
      "    if flag:",
      "        jump branch_a",
      '    "continue"',
      "",
      "label next_label:",
      '    "after conditional"',
      "",
      "label branch_a:",
      '    "branch"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "conditional_jump.rpy",
      content: script,
    }]);

    const decisionNode = result.nodes.find((node) => node.type === "DECISION");
    expect(decisionNode).toBeDefined();
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "start",
          target: decisionNode?.id,
          kind: "sequence",
        }),
        expect.objectContaining({
          source: decisionNode?.id,
          target: "branch_a",
          kind: "jump",
          condition: expect.objectContaining({
            branchKind: "if",
            expression: "flag",
          }),
        }),
        expect.objectContaining({
          source: "start",
          target: "next_label",
          label: "next",
        }),
      ]),
    );
  });

  it("does not suppress fallthrough when menu is inside a conditional branch", async () => {
    const script = [
      "label start:",
      "    if flag:",
      "        menu:",
      '            "Go to branch":',
      "                jump branch_a",
      '    "continue"',
      "",
      "label next_label:",
      '    "after conditional"',
      "",
      "label branch_a:",
      '    "branch"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "conditional_menu.rpy",
      content: script,
    }]);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "menu_1",
          target: "branch_a",
          kind: "jump",
        }),
        expect.objectContaining({
          source: "start",
          target: "next_label",
          label: "next",
        }),
      ]),
    );
  });

  it("does not suppress fallthrough when return is inside a conditional branch", async () => {
    const script = [
      "label start:",
      "    if flag:",
      "        return",
      '    "continue"',
      "",
      "label next_label:",
      '    "after conditional"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "conditional_return.rpy",
      content: script,
    }]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "start",
        target: "next_label",
        kind: "sequence",
        label: "next",
      }),
    );
  });

  it("emits an explicit decision node and conditional branch metadata for if/elif/else", async () => {
    const script = [
      "label start:",
      "    if flag_a:  # branch A",
      "        jump branch_a",
      "    elif flag_b:  # branch B",
      "        jump branch_b",
      "    else:  # fallback",
      "        jump branch_c",
      "",
      "label branch_a:",
      '    "A"',
      "",
      "label branch_b:",
      '    "B"',
      "",
      "label branch_c:",
      '    "C"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "conditional_branches.rpy",
      content: script,
    }]);
    const decisionNode = result.nodes.find((node) => node.type === "DECISION");
    expect(decisionNode).toBeDefined();

    const conditionalJumpEdges = result.edges.filter((edge) =>
      edge.source === decisionNode?.id && edge.kind === "jump"
    );
    expect(conditionalJumpEdges).toHaveLength(3);
    expect(conditionalJumpEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "branch_a",
          condition: expect.objectContaining({
            branchKind: "if",
            expression: "flag_a",
            references: ["flag_a"],
          }),
        }),
        expect.objectContaining({
          target: "branch_b",
          condition: expect.objectContaining({
            branchKind: "elif",
            expression: "flag_b",
            references: ["flag_b"],
          }),
        }),
        expect.objectContaining({
          target: "branch_c",
          condition: expect.objectContaining({
            branchKind: "else",
          }),
        }),
      ]),
    );
  });

  it("preserves full conditional expression text when it contains nested colons", async () => {
    const script = [
      "label start:",
      '    if route_map["a:b"] == {"k": "v:1"}:',
      "        jump branch_a",
      "    else:",
      "        jump branch_b",
      "",
      "label branch_a:",
      '    "A"',
      "",
      "label branch_b:",
      '    "B"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "conditional_nested_colons.rpy",
      content: script,
    }]);
    const decisionNode = result.nodes.find((node) => node.type === "DECISION");
    expect(decisionNode).toBeDefined();
    expect(decisionNode?.condition).toEqual(
      expect.objectContaining({
        branchKind: "if",
        expression: 'route_map["a:b"] == {"k": "v:1"}',
      }),
    );
  });

  it("creates a call edge labeled with the option text when call is inside a menu option", async () => {
    const script = [
      "label hub:",
      "    menu:",
      '        "Talk to Alice":',
      "            call alice_scene",
      "",
      "label alice_scene:",
      '    "hello"',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "menu_call.rpy",
      content: script,
    }]);

    const callEdge = result.edges.find((e) => e.target === "alice_scene");
    expect(callEdge).toBeDefined();
    expect(callEdge?.label).toBe("call: Talk to Alice");
  });

  it("adds synthetic call-return edges from called label back to caller label", async () => {
    const script = [
      "label main:",
      "    call helper",
      "",
      "label helper:",
      '    "in helper"',
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "call_return.rpy",
      content: script,
    }]);
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "main",
          target: "helper",
          kind: "call",
        }),
        expect.objectContaining({
          source: "helper",
          target: "main",
          kind: "call_return",
          label: "return",
        }),
      ]),
    );
  });

  it("does not add call-return edges when a callee only returns conditionally", async () => {
    const script = [
      "label main:",
      "    call helper",
      "",
      "label helper:",
      "    if flag:",
      "        return",
      '    "continue"',
      "",
      "label after_helper:",
      '    "done"',
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "conditional-call-return.rpy",
      content: script,
    }]);

    expect(result.edges).toContainEqual(
      expect.objectContaining({
        source: "main",
        target: "helper",
        kind: "call",
      }),
    );
    expect(
      result.edges.find((e) =>
        e.kind === "call_return" && e.source === "helper" && e.target === "main"
      ),
    ).toBeUndefined();
  });

  it("adds call-return edges for menu option call, renpy.call, and screen action Call with direct-call parity", async () => {
    const script = [
      "label menu_caller:",
      "    menu:",
      '        "Ask":',
      "            call helper",
      "",
      "label py_caller:",
      "    python:",
      '        renpy.call("helper")',
      "",
      "label screen_caller:",
      "    screen chooser():",
      '        textbutton "Go" action Call("helper")',
      "",
      "label helper:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "call-parity.rpy",
      content: script,
    }]);
    const menuNode = result.nodes.find((node) => node.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.id).toMatch(/^menu_/);

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "call",
          source: menuNode?.id,
          target: "helper",
        }),
        expect.objectContaining({
          kind: "call_return",
          source: "helper",
          target: menuNode?.id,
        }),
        expect.objectContaining({
          kind: "call",
          source: "py_caller",
          target: "helper",
        }),
        expect.objectContaining({
          kind: "call_return",
          source: "helper",
          target: "py_caller",
        }),
        expect.objectContaining({
          kind: "call",
          source: "screen_caller",
          target: "helper",
        }),
        expect.objectContaining({
          kind: "call_return",
          source: "helper",
          target: "screen_caller",
        }),
      ]),
    );
  });

  it("classifies label roles using strict rules and keeps role metadata on nodes", async () => {
    const script = [
      "label main:",
      "    menu:",
      '        "Talk":',
      "            call detour_scene",
      "",
      "label detour_scene:",
      '    "detour"',
      "    return",
      "",
      "label helper_only:",
      '    "utility"',
      "    return",
      "",
      "label state_toggle:",
      "    return",
      "",
    ].join("\n");

    const result = await parseRenpyFiles([{
      name: "roles.rpy",
      content: script,
    }]);
    const byId = new Map(result.nodes.map((n) => [n.id, n]));
    expect(byId.get("main")?.role).toBe("story");
    expect(byId.get("detour_scene")?.role).toBe("detour");
    expect(byId.get("helper_only")?.role).toBe("state_toggle");
    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode?.role).toBe("menu");
  });
});
