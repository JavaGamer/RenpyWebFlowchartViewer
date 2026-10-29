import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRenpyScript } from "../../../src/parser/ast/parser.ts";
import { buildStoryGraph } from "../../../src/parser/graph/graphBuilder.ts";
import { linkProjectGraphs } from "../../../src/parser/graph/globalLinker.ts";

function loadFixture(name: string): string {
  const fixturesDir = resolve(import.meta.dirname, "../../fixtures");
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

describe("StoryGraphBuilder & GlobalLinker", () => {
  it("builds clean label nodes and jump edges without synthetic scenes", () => {
    const script = [
      "label start:",
      '    "Intro dialogue line 1"',
      '    "Intro dialogue line 2"',
      "    jump chapter1",
      "",
      "label chapter1:",
      '    "Chapter 1 content"',
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script, "story.rpy");
    const graph = buildStoryGraph(ast);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.id)).toEqual(["start", "chapter1"]);

    const startNode = graph.nodes.find((n) => n.id === "start")!;
    expect(startNode.dialogueCount).toBe(2);
    expect(startNode.dialogueLines).toEqual([
      "Intro dialogue line 1",
      "Intro dialogue line 2",
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!).toMatchObject({
      source: "start",
      target: "chapter1",
      kind: "jump",
    });
  });

  it("creates a dedicated MenuNode with choice branch edges", () => {
    const script = [
      "label hub:",
      "    menu:",
      '        "What to do?"',
      '        "Take high road":',
      "            jump high_road",
      '        "Take low road":',
      "            jump low_road",
      "",
      "label high_road:",
      '    "High road"',
      "    return",
      "",
      "label low_road:",
      '    "Low road"',
      "    return",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const graph = buildStoryGraph(ast);

    const menuNode = graph.nodes.find((n) => n.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode!.label).toBe("What to do?");

    const choiceEdges = graph.edges.filter((e) => e.source === menuNode!.id);
    expect(choiceEdges).toHaveLength(2);

    expect(choiceEdges).toContainEqual(
      expect.objectContaining({
        target: "high_road",
        label: "Take high road",
        kind: "jump",
      }),
    );
    expect(choiceEdges).toContainEqual(
      expect.objectContaining({
        target: "low_road",
        label: "Take low road",
        kind: "jump",
      }),
    );
  });

  it("creates a single continuation node only when menu choices continue to subsequent statements", () => {
    const script = [
      "label investigation:",
      '    "Look around the room."',
      "    menu:",
      '        "Inspect desk":',
      "            $ found_clue = True",
      '        "Inspect closet":',
      '            "Nothing here."',
      '    "After inspecting, we leave the room."',
      "    jump hallway",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const graph = buildStoryGraph(ast);

    const labels = graph.nodes.filter((n) => n.type === "LABEL");
    expect(labels).toHaveLength(2);

    const primaryLabel = labels.find((n) => n.id === "investigation")!;
    const contLabel = labels.find((n) => n.id.includes("__cont_"))!;

    expect(primaryLabel).toBeDefined();
    expect(contLabel).toBeDefined();
    expect(contLabel.dialogueLines).toContain(
      "After inspecting, we leave the room.",
    );

    // The continuation node has the jump to hallway
    const exitEdge = graph.edges.find((e) => e.target === "hallway");
    expect(exitEdge).toBeDefined();
    expect(exitEdge!.source).toBe(contLabel.id);
  });

  it("emits guarded edges for conditional jumps with ConditionMetadata", () => {
    const script = [
      "label check_keys:",
      "    if has_gold_key:",
      "        jump treasury",
      "    elif has_iron_key:",
      "        jump dungeon",
      "    else:",
      "        jump courtyard",
    ].join("\n");

    const ast = parseRenpyScript(script);
    const graph = buildStoryGraph(ast);

    // ZERO decision nodes created on canvas!
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.id).toBe("check_keys");

    expect(graph.edges).toHaveLength(3);
    const goldEdge = graph.edges.find((e) => e.target === "treasury")!;
    expect(goldEdge.condition).toBeDefined();
    expect(goldEdge.condition!.expression).toBe("has_gold_key");
    expect(goldEdge.condition!.branchKind).toBe("if");

    const ironEdge = graph.edges.find((e) => e.target === "dungeon")!;
    expect(ironEdge.condition!.expression).toBe("has_iron_key");
    expect(ironEdge.condition!.branchKind).toBe("elif");

    const courtEdge = graph.edges.find((e) => e.target === "courtyard")!;
    expect(courtEdge.condition!.branchKind).toBe("else");
  });

  it("links subroutine calls and returns deterministically across files", () => {
    const file1Ast = parseRenpyScript(
      [
        "label main_story:",
        '    "Before calling helper."',
        "    call helper_routine",
        '    "After returning from helper."',
        "    jump finale",
      ].join("\n"),
      "main.rpy",
    );

    const file2Ast = parseRenpyScript(
      [
        "label helper_routine:",
        '    "Doing helper work."',
        "    return",
      ].join("\n"),
      "helper.rpy",
    );

    const frag1 = buildStoryGraph(file1Ast);
    const frag2 = buildStoryGraph(file2Ast);

    const linked = linkProjectGraphs([frag1, frag2]);

    const callEdge = linked.edges.find((e) => e.kind === "call")!;
    expect(callEdge).toBeDefined();
    expect(callEdge.source).toBe("main_story");
    expect(callEdge.target).toBe("helper_routine");

    const returnEdge = linked.edges.find((e) => e.kind === "call_return")!;
    expect(returnEdge).toBeDefined();
    expect(returnEdge.source).toBe("helper_routine");
    expect(returnEdge.target).toBe("main_story");
  });

  it("parses and links real fixture nested-menus.rpy cleanly", () => {
    const fixtureContent = loadFixture("nested-menus.rpy");
    const ast = parseRenpyScript(fixtureContent, "nested-menus.rpy");
    const graph = buildStoryGraph(ast);

    const menuNodes = graph.nodes.filter((n) => n.type === "MENU");
    expect(menuNodes).toHaveLength(2);

    const jumpToAccepted = graph.edges.find((e) => e.target === "accepted");
    expect(jumpToAccepted).toBeDefined();
    expect(jumpToAccepted!.label).toBe("Accept quest");

    const jumpToDeclined = graph.edges.filter(
      (e) => e.target === "declined" && e.kind === "jump",
    );
    expect(jumpToDeclined).toHaveLength(2);

    const fallthroughFromAccepted = graph.edges.find(
      (e) =>
        e.source === "accepted" && e.target === "declined" &&
        e.kind === "fallthrough",
    );
    expect(fallthroughFromAccepted).toBeDefined();
  });
});
