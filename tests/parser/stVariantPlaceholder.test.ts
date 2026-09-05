import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/index.ts";

describe("ST variant: placeholder statement and timedchoice correctness", () => {
  it("prevents fallthrough when placeholder is used in a label", async () => {
    const script = `
label start:
    "Welcome to the start."
    jump incomplete_route

label incomplete_route:
    "This route is not finished yet."
    placeholder

label another_label:
    "This should NOT be reachable by sequence fallthrough from incomplete_route."
    return
`;

    const result = await parseRenpyFiles([{
      name: "st_placeholder.rpy",
      content: script,
    }], { parserVariant: "st", sceneSplitDialogueThreshold: 0 });

    const incompleteNode = result.nodes.find((n) =>
      n.id.includes("incomplete_route")
    );
    const anotherNode = result.nodes.find((n) =>
      n.id.includes("another_label")
    );

    expect(incompleteNode).toBeDefined();
    expect(anotherNode).toBeDefined();

    // Verify there is no sequence edge from incomplete_route to another_label
    const fallthroughEdge = result.edges.find(
      (e) => e.source === incompleteNode?.id && e.target === anotherNode?.id,
    );
    expect(fallthroughEdge).toBeUndefined();

    // Verify incomplete_route is marked as a terminal outcome
    expect(incompleteNode?.isTerminalOutcome).toBe(true);
  });

  it("handles placeholder wip syntax", async () => {
    const script = `
label wip_route:
    "Working on this."
    placeholder wip

label next_route:
    "Independent route."
    return
`;

    const result = await parseRenpyFiles([{
      name: "st_placeholder_wip.rpy",
      content: script,
    }], { parserVariant: "st", sceneSplitDialogueThreshold: 0 });

    const wipNode = result.nodes.find((n) => n.id.includes("wip_route"));
    const nextNode = result.nodes.find((n) => n.id.includes("next_route"));

    const fallthrough = result.edges.find(
      (e) => e.source === wipNode?.id && e.target === nextNode?.id,
    );
    expect(fallthrough).toBeUndefined();
    expect(wipNode?.isTerminalOutcome).toBe(true);
  });

  it("handles placeholder inside menu options", async () => {
    const script = `
label choose_path:
    menu:
        "Finished path":
            jump finished_label
        "Unfinished path":
            placeholder

label finished_label:
    "Done."
    return

label after_menu_fallthrough:
    "Should not fall through from unfinished path."
    return
`;

    const result = await parseRenpyFiles([{
      name: "st_menu_placeholder.rpy",
      content: script,
    }], { parserVariant: "st", sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const afterNode = result.nodes.find((n) =>
      n.id.includes("after_menu_fallthrough")
    );
    expect(afterNode).toBeDefined();

    // Ensure menu option with placeholder does NOT fall through to after_menu_fallthrough
    const fallthroughEdge = result.edges.find(
      (e) => e.source === menuNode?.id && e.target === afterNode?.id,
    );
    expect(fallthroughEdge).toBeUndefined();
  });

  it("labels timedchoice timeout edge with timeout duration or custom title", async () => {
    const script = `
label test_timed:
    timedchoice 3.0 timeout_label "Don't press" # inline comment
    menu:
        "Press button":
            jump pressed_label

label timeout_label:
    "Timed out."
    return

label pressed_label:
    "Pressed."
    return
`;

    const result = await parseRenpyFiles([{
      name: "st_timed.rpy",
      content: script,
    }], { parserVariant: "st", sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();

    const timeoutEdge = result.edges.find(
      (e) => e.source === menuNode?.id && e.target.includes("timeout_label"),
    );
    expect(timeoutEdge).toBeDefined();
    expect(timeoutEdge?.timeout).toEqual({
      isTimeout: true,
      durationSeconds: 3.0,
    });
    expect(timeoutEdge?.label).toBe("Don't press");
  });

  it("handles timedchoice titles with parentheses and fallback when no title provided", async () => {
    const script = `
label test_timed_parens:
    timedchoice 2.5 timeout_parens "Hurry (Quick!)"
    menu:
        "Option":
            jump opt_target

label timeout_parens:
    return

label opt_target:
    return
`;

    const result = await parseRenpyFiles([{
      name: "st_timed_parens.rpy",
      content: script,
    }], { parserVariant: "st", sceneSplitDialogueThreshold: 0 });

    const menuNode = result.nodes.find((n) => n.type === "MENU");
    const timeoutEdge = result.edges.find(
      (e) => e.source === menuNode?.id && e.target.includes("timeout_parens"),
    );
    expect(timeoutEdge).toBeDefined();
    expect(timeoutEdge?.label).toBe("Hurry (Quick!)");
  });

  it("handles placeholder with inline comment in ST variant", async () => {
    const script = `
label unfinished_with_comment:
    "Some text."
    placeholder # WIP: will finish later

label subsequent_label:
    "Should not be reached via sequence."
    return
`;

    const result = await parseRenpyFiles([{
      name: "st_comment.rpy",
      content: script,
    }], { parserVariant: "st", sceneSplitDialogueThreshold: 0 });

    const unfinishedNode = result.nodes.find((n) =>
      n.id.includes("unfinished_with_comment")
    );
    const subNode = result.nodes.find((n) => n.id.includes("subsequent_label"));
    expect(unfinishedNode?.isTerminalOutcome).toBe(true);

    const fallthroughEdge = result.edges.find(
      (e) => e.source === unfinishedNode?.id && e.target === subNode?.id,
    );
    expect(fallthroughEdge).toBeUndefined();
  });

  it("ensures standard Ren'Py variant is NOT affected by placeholder variables or character dialogue", async () => {
    const script = `
define placeholder = Character("Placeholder Person")

label standard_start:
    $ placeholder = 1
    placeholder "Hello, I am a character named placeholder!"
    "Normal dialogue."

label standard_target:
    "Reached via fallthrough sequence."
    return
`;

    // Test with default (undefined) and explicit "renpy" variant
    for (const variant of [undefined, "renpy"] as const) {
      const result = await parseRenpyFiles([{
        name: "standard_script.rpy",
        content: script,
      }], {
        parserVariant: variant,
        sceneSplitDialogueThreshold: 0,
        captureDialogueLines: true,
      });

      const startNode = result.nodes.find((n) =>
        n.id.includes("standard_start")
      );
      const targetNode = result.nodes.find((n) =>
        n.id.includes("standard_target")
      );

      expect(startNode).toBeDefined();
      expect(targetNode).toBeDefined();

      // In standard Ren'Py, $ placeholder = 1 and dialogue do NOT terminate the label
      expect(startNode?.isTerminalOutcome).toBeFalsy();

      // Sequence fallthrough must exist
      const sequenceEdge = result.edges.find(
        (e) =>
          e.source === startNode?.id &&
          e.target === targetNode?.id &&
          e.kind === "sequence",
      );
      expect(sequenceEdge).toBeDefined();

      // Character dialogue from 'placeholder' is preserved
      expect(startNode?.dialogueCount).toBeGreaterThanOrEqual(2);
      expect(startNode?.dialogueLines).toContain(
        "Hello, I am a character named placeholder!",
      );
    }
  });

  it("verifies synthetic scenario with placeholder and timedchoice has no invalid sequence edge", async () => {
    const script = `
label route_choice:
    timedchoice 1.1 timeout_target
    menu:
        "Branch A":
            jump route_a
        "Branch B":
            jump route_b

label route_a:
    "Route A ongoing."
    return

label route_b:
    "Route B unfinished."
    placeholder

label timeout_target:
    scene bg_room
    "Timeout reached."
    return
`;

    const result = await parseRenpyFiles([{
      name: "synthetic_case.rpy",
      content: script,
    }], { parserVariant: "st" });

    // Verify route_b exists and is marked as terminal outcome
    const routeBNode = result.nodes.find((n) => n.id.includes("route_b"));
    expect(routeBNode).toBeDefined();
    expect(routeBNode?.isTerminalOutcome).toBe(true);

    // Verify there is NO sequence edge from route_b to timeout_target
    const invalidEdge = result.edges.find(
      (e) =>
        e.source.includes("route_b") &&
        e.target.includes("timeout_target"),
    );
    expect(invalidEdge).toBeUndefined();

    // Verify timeout_target is reached via timeout jump
    const timeoutIncoming = result.edges.filter((e) =>
      e.target.includes("timeout_target")
    );
    expect(timeoutIncoming.length).toBe(1);
    expect(timeoutIncoming[0]!.kind).toBe("jump");
    expect(timeoutIncoming[0]!.timeout?.isTimeout).toBe(true);
    expect(timeoutIncoming[0]!.timeout?.durationSeconds).toBe(1.1);
    expect(timeoutIncoming[0]!.label).toBe("Timeout (1.1s)");
  });
});
