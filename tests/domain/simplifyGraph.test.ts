import { describe, expect, it } from "vitest";
import { simplifyGraph } from "../../src/domain/transforms/simplify.ts";
import type { FlowEdge, FlowNode } from "../../src/domain";

describe("simplifyGraph", () => {
  const defaultOptions = {
    collapseLinearChains: false,
    inlineUtilities: false,
    inlineDetours: false,
    inlineStateToggles: false,
    inlineEmptyLabels: false,
    inlineDialogueThreshold: 0,
  };

  it("returns unchanged graph when no options are enabled", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      { id: "node2", type: "LABEL", label: "node2", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "node2", kind: "sequence" },
    ];
    const result = simplifyGraph(nodes, edges, defaultOptions);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it("inlines utility nodes while preserving start node and routing", () => {
    // start -> util -> target
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "util",
        type: "LABEL",
        label: "util",
        dialogueCount: 0,
        role: "utility",
      },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      {
        id: "e1",
        source: "start",
        target: "util",
        kind: "sequence",
        label: "to util",
      },
      { id: "e2", source: "util", target: "target", kind: "jump" },
    ];
    const options = { ...defaultOptions, inlineUtilities: true };
    const result = simplifyGraph(nodes, edges, options);

    // util is inlined, start and target remain
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.id)).not.toContain("util");

    // new edge start -> target should exist and carry kind/label properties
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("start");
    expect(result.edges[0].target).toBe("target");
    expect(result.edges[0].label).toBe("to util");
    expect(result.edges[0].kind).toBe("jump"); // prioritized jump over sequence
  });

  it("protects start node and terminal nodes from being inlined", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 0,
        role: "utility",
      },
      {
        id: "end",
        type: "LABEL",
        label: "end",
        dialogueCount: 0,
        role: "utility",
        isTerminalOutcome: true,
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "end", kind: "sequence" },
    ];
    const options = { ...defaultOptions, inlineUtilities: true };
    const result = simplifyGraph(nodes, edges, options);
    // start (entry) and end (terminal) are both protected and should NOT be inlined
    expect(result.nodes).toHaveLength(2);
  });

  it("inlines empty/low-dialogue labels under threshold", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 5 },
      { id: "low", type: "LABEL", label: "low", dialogueCount: 2 },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 5 },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "low", kind: "sequence" },
      { id: "e2", source: "low", target: "target", kind: "sequence" },
    ];

    // with threshold 3, low (dialogueCount = 2) should be inlined
    const options = {
      ...defaultOptions,
      inlineEmptyLabels: true,
      inlineDialogueThreshold: 3,
    };
    const result = simplifyGraph(nodes, edges, options);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.id)).not.toContain("low");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("start");
    expect(result.edges[0].target).toBe("target");
  });

  it("collapses consecutive linear label chains into a single node", () => {
    // start -> linear1 -> linear2 -> end
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "linear1",
        type: "LABEL",
        label: "linear1",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "linear2",
        type: "LABEL",
        label: "linear2",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "end",
        type: "LABEL",
        label: "end",
        dialogueCount: 1,
        chapter: "ch1",
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "linear1", kind: "sequence" },
      { id: "e2", source: "linear1", target: "linear2", kind: "sequence" },
      { id: "e3", source: "linear2", target: "end", kind: "sequence" },
    ];
    const options = { ...defaultOptions, collapseLinearChains: true };
    const result = simplifyGraph(nodes, edges, options);

    expect(result.nodes).toHaveLength(2); // start and linear1 (collapsed with linear2 and end)
    const linearNode = result.nodes.find((n) => n.id === "linear1")!;
    expect(linearNode.dialogueCount).toBe(3);
    expect(linearNode.collapsedLabels).toEqual(["linear2", "end"]);
  });

  it("collapses consecutive linear label chains regardless of edge order without losing collapsed labels", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "linear1",
        type: "LABEL",
        label: "linear1",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "linear2",
        type: "LABEL",
        label: "linear2",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "end",
        type: "LABEL",
        label: "end",
        dialogueCount: 1,
        chapter: "ch1",
      },
    ];
    // Put e3 (linear2 -> end) before e2 (linear1 -> linear2) to ensure linear2 & end merge first
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "linear1", kind: "sequence" },
      { id: "e3", source: "linear2", target: "end", kind: "sequence" },
      { id: "e2", source: "linear1", target: "linear2", kind: "sequence" },
    ];
    const options = { ...defaultOptions, collapseLinearChains: true };
    const result = simplifyGraph(nodes, edges, options);

    expect(result.nodes).toHaveLength(2);
    const linearNode = result.nodes.find((n) => n.id === "linear1")!;
    expect(linearNode.dialogueCount).toBe(3);
    expect(linearNode.collapsedLabels).toEqual(["linear2", "end"]);
  });

  it("inlines conditional nodes and logically merges their conditions using 'and'", () => {
    // start -[flag1]-> condNode -[flag2]-> target
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "condNode",
        type: "LABEL",
        label: "condNode",
        dialogueCount: 0,
        role: "utility",
      },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      {
        id: "e1",
        source: "start",
        target: "condNode",
        kind: "sequence",
        condition: {
          branchKind: "if",
          expression: "flag1",
          references: ["flag1"],
        },
      },
      {
        id: "e2",
        source: "condNode",
        target: "target",
        kind: "jump",
        condition: {
          branchKind: "if",
          expression: "flag2",
          references: ["flag2"],
        },
      },
    ];
    const options = { ...defaultOptions, inlineUtilities: true };
    const result = simplifyGraph(nodes, edges, options);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.id)).not.toContain("condNode");

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0];
    expect(edge.source).toBe("start");
    expect(edge.target).toBe("target");
    expect(edge.condition).toBeDefined();
    expect(edge.condition?.expression).toBe("(flag1) and (flag2)");
    expect(edge.condition?.references).toEqual(["flag1", "flag2"]);
  });
});
