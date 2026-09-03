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

  it("preserves mutations across collapsed linear chains", () => {
    // A -> B -> C (linear chain eligible for collapsing)
    const nodes: FlowNode[] = [
      {
        id: "nodeA",
        type: "LABEL",
        label: "nodeA",
        dialogueCount: 1,
        mutations: [
          {
            variableName: "affection",
            operator: "+=",
            value: 1,
            rawExpression: "1",
            nodeId: "nodeA",
            lineNum: 10,
          },
        ],
      },
      {
        id: "nodeB",
        type: "LABEL",
        label: "nodeB",
        dialogueCount: 1,
        mutations: [
          {
            variableName: "gold",
            operator: "*=",
            value: 2,
            rawExpression: "2",
            nodeId: "nodeB",
            lineNum: 20,
          },
        ],
      },
      {
        id: "nodeC",
        type: "LABEL",
        label: "nodeC",
        dialogueCount: 1,
        mutations: [
          {
            variableName: "has_key",
            operator: "toggle",
            value: true,
            rawExpression: "not has_key",
            nodeId: "nodeC",
            lineNum: 30,
          },
        ],
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "nodeA", target: "nodeB", kind: "sequence" },
      { id: "e2", source: "nodeB", target: "nodeC", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      collapseLinearChains: true,
    });

    expect(result.nodes).toHaveLength(1);
    const collapsedNode = result.nodes[0];
    expect(collapsedNode.id).toBe("nodeA");
    expect(collapsedNode.mutations).toBeDefined();
    expect(collapsedNode.mutations).toHaveLength(3);
    expect(
      collapsedNode.mutations?.some(
        (m) => m.variableName === "affection" && m.operator === "+=",
      ),
    ).toBe(true);
    expect(
      collapsedNode.mutations?.some(
        (m) => m.variableName === "gold" && m.operator === "*=",
      ),
    ).toBe(true);
    expect(
      collapsedNode.mutations?.some(
        (m) => m.variableName === "has_key" && m.operator === "toggle",
      ),
    ).toBe(true);
  });

  it("migrates mutations from inlined state toggle nodes to predecessor", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 1,
      },
      {
        id: "toggle_flag",
        type: "LABEL",
        label: "toggle_flag",
        dialogueCount: 0,
        role: "state_toggle",
        mutations: [
          {
            variableName: "visited_room",
            operator: "=",
            value: true,
            rawExpression: "True",
            nodeId: "toggle_flag",
            lineNum: 5,
          },
        ],
      },
      {
        id: "end",
        type: "LABEL",
        label: "end",
        dialogueCount: 1,
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "toggle_flag", kind: "sequence" },
      { id: "e2", source: "toggle_flag", target: "end", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      inlineStateToggles: true,
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.id)).not.toContain("toggle_flag");
    const startNode = result.nodes.find((n) => n.id === "start");
    expect(startNode?.mutations).toBeDefined();
    expect(
      startNode?.mutations?.some(
        (m) => m.variableName === "visited_room" && m.value === true,
      ),
    ).toBe(true);
  });

  it("adversarial: preserves parallel edges with different arguments when inlining nodes", () => {
    // start -> utilA -> target with arg="modeA"
    // start -> utilB -> target with arg="modeB"
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "utilA",
        type: "LABEL",
        label: "utilA",
        dialogueCount: 0,
        role: "utility",
      },
      {
        id: "utilB",
        type: "LABEL",
        label: "utilB",
        dialogueCount: 0,
        role: "utility",
      },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      {
        id: "e1",
        source: "start",
        target: "utilA",
        kind: "call",
        arguments: [{ name: "mode", value: "'A'" }],
      },
      { id: "e2", source: "utilA", target: "target", kind: "sequence" },
      {
        id: "e3",
        source: "start",
        target: "utilB",
        kind: "call",
        arguments: [{ name: "mode", value: "'B'" }],
      },
      { id: "e4", source: "utilB", target: "target", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      inlineUtilities: true,
    });

    expect(result.nodes.map((n) => n.id)).toEqual(["start", "target"]);
    expect(result.edges).toHaveLength(2);
    const argValues = result.edges.map((e) => e.arguments?.[0]?.value).sort();
    expect(argValues).toEqual(["'A'", "'B'"]);
  });

  it("adversarial: preserves non-inlined parallel edges with different callContext when inlining is active", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 1 },
      {
        id: "dummyUtil",
        type: "LABEL",
        label: "dummyUtil",
        dialogueCount: 0,
        role: "utility",
      },
    ];
    const edges: FlowEdge[] = [
      {
        id: "e1",
        source: "start",
        target: "target",
        kind: "call",
        callContext: { callSiteId: "start", returnTargetId: "ret1" },
      },
      {
        id: "e2",
        source: "start",
        target: "target",
        kind: "call",
        callContext: { callSiteId: "start", returnTargetId: "ret2" },
      },
      { id: "e3", source: "start", target: "dummyUtil", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      inlineUtilities: true,
    });

    const targetEdges = result.edges.filter((e) => e.target === "target");
    expect(targetEdges).toHaveLength(2);
    const returnTargets = targetEdges.map((e) => e.callContext?.returnTargetId)
      .sort();
    expect(returnTargets).toEqual(["ret1", "ret2"]);
  });

  it("adversarial: preserves parallel edges with different timeouts", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 1 },
      {
        id: "dummyUtil",
        type: "LABEL",
        label: "dummyUtil",
        dialogueCount: 0,
        role: "utility",
      },
    ];
    const edges: FlowEdge[] = [
      {
        id: "e1",
        source: "start",
        target: "target",
        kind: "sequence",
        timeout: { isTimeout: true, durationSeconds: 5 },
      },
      { id: "e2", source: "start", target: "target", kind: "sequence" },
      { id: "e3", source: "start", target: "dummyUtil", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      inlineUtilities: true,
    });

    const targetEdges = result.edges.filter((e) => e.target === "target");
    expect(targetEdges).toHaveLength(2);
    expect(targetEdges.some((e) => e.timeout?.isTimeout)).toBe(true);
    expect(targetEdges.some((e) => !e.timeout)).toBe(true);
  });

  it("adversarial: does not skip distinct paths through chained inlined nodes when arguments differ", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "util1",
        type: "LABEL",
        label: "util1",
        dialogueCount: 0,
        role: "utility",
      },
      {
        id: "util2",
        type: "LABEL",
        label: "util2",
        dialogueCount: 0,
        role: "utility",
      },
      {
        id: "util3",
        type: "LABEL",
        label: "util3",
        dialogueCount: 0,
        role: "utility",
      },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      {
        id: "e1",
        source: "start",
        target: "util1",
        kind: "call",
        arguments: [{ name: "opt", value: "1" }],
      },
      { id: "e2", source: "util1", target: "util3", kind: "sequence" },
      {
        id: "e3",
        source: "start",
        target: "util2",
        kind: "call",
        arguments: [{ name: "opt", value: "2" }],
      },
      { id: "e4", source: "util2", target: "util3", kind: "sequence" },
      { id: "e5", source: "util3", target: "target", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      inlineUtilities: true,
    });

    expect(result.nodes.map((n) => n.id)).toEqual(["start", "target"]);
    expect(result.edges).toHaveLength(2);
    const values = result.edges.map((e) => e.arguments?.[0]?.value).sort();
    expect(values).toEqual(["1", "2"]);
  });

  it("adversarial: handles cyclic inlined utilities without infinite loops or dropping exits", () => {
    // start -> utilA <-> utilB -> target
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      {
        id: "utilA",
        type: "LABEL",
        label: "utilA",
        dialogueCount: 0,
        role: "utility",
      },
      {
        id: "utilB",
        type: "LABEL",
        label: "utilB",
        dialogueCount: 0,
        role: "utility",
      },
      { id: "target", type: "LABEL", label: "target", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "utilA", kind: "sequence" },
      { id: "e2", source: "utilA", target: "utilB", kind: "sequence" },
      { id: "e3", source: "utilB", target: "utilA", kind: "sequence" },
      { id: "e4", source: "utilB", target: "target", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      inlineUtilities: true,
    });

    expect(result.nodes.map((n) => n.id)).toEqual(["start", "target"]);
    expect(
      result.edges.some((e) => e.source === "start" && e.target === "target"),
    ).toBe(true);
  });

  it("adversarial: combineSourceLocations handles multi-file linear collapsing respecting root file", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "rootNode",
        type: "LABEL",
        label: "rootNode",
        dialogueCount: 1,
        chapter: "ch1",
        sourceLocation: {
          file: "fileB.rpy",
          start: { line: 20, character: 0, offset: 200 },
          end: { line: 30, character: 0, offset: 300 },
        },
      },
      {
        id: "linear1",
        type: "LABEL",
        label: "linear1",
        dialogueCount: 1,
        chapter: "ch1",
        sourceLocation: {
          file: "fileA.rpy",
          start: { line: 5, character: 0, offset: 50 },
          end: { line: 10, character: 0, offset: 100 },
        },
      },
      {
        id: "linear2",
        type: "LABEL",
        label: "linear2",
        dialogueCount: 1,
        chapter: "ch1",
        sourceLocation: {
          file: "fileB.rpy",
          start: { line: 35, character: 0, offset: 350 },
          end: { line: 50, character: 0, offset: 500 },
        },
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "rootNode", kind: "sequence" },
      { id: "e2", source: "rootNode", target: "linear1", kind: "sequence" },
      { id: "e3", source: "linear1", target: "linear2", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      collapseLinearChains: true,
    });

    const collapsed = result.nodes.find((n) => n.id === "rootNode")!;
    expect(collapsed).toBeDefined();
    expect(collapsed.sourceLocation?.file).toBe("fileB.rpy");
    expect(collapsed.sourceLocation?.start.line).toBe(20);
    expect(collapsed.sourceLocation?.end.line).toBe(50);
  });

  it("adversarial: combineSourceLocations selects dominant file when root node has no location", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "rootNode",
        type: "LABEL",
        label: "rootNode",
        dialogueCount: 1,
        chapter: "ch1",
      },
      {
        id: "linear1",
        type: "LABEL",
        label: "linear1",
        dialogueCount: 1,
        chapter: "ch1",
        sourceLocation: {
          file: "fileA.rpy",
          start: { line: 1, character: 0, offset: 10 },
          end: { line: 2, character: 0, offset: 20 },
        },
      },
      {
        id: "linear2",
        type: "LABEL",
        label: "linear2",
        dialogueCount: 1,
        chapter: "ch1",
        sourceLocation: {
          file: "fileB.rpy",
          start: { line: 100, character: 0, offset: 1000 },
          end: { line: 150, character: 0, offset: 1500 },
        },
      },
      {
        id: "linear3",
        type: "LABEL",
        label: "linear3",
        dialogueCount: 1,
        chapter: "ch1",
        sourceLocation: {
          file: "fileB.rpy",
          start: { line: 151, character: 0, offset: 1510 },
          end: { line: 200, character: 0, offset: 2000 },
        },
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "rootNode", kind: "sequence" },
      { id: "e2", source: "rootNode", target: "linear1", kind: "sequence" },
      { id: "e3", source: "linear1", target: "linear2", kind: "sequence" },
      { id: "e4", source: "linear2", target: "linear3", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      collapseLinearChains: true,
    });

    const collapsed = result.nodes.find((n) => n.id === "rootNode")!;
    expect(collapsed).toBeDefined();
    expect(collapsed.sourceLocation?.file).toBe("fileB.rpy");
    expect(collapsed.sourceLocation?.start.line).toBe(100);
    expect(collapsed.sourceLocation?.end.line).toBe(200);
  });

  it("adversarial: preserves chapter boundaries and never collapses linear chains across chapters", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "LABEL",
        label: "start",
        dialogueCount: 1,
        chapter: "prologue",
      },
      {
        id: "ch1_node",
        type: "LABEL",
        label: "ch1_node",
        dialogueCount: 1,
        chapter: "chapter1",
      },
      {
        id: "ch2_node",
        type: "LABEL",
        label: "ch2_node",
        dialogueCount: 1,
        chapter: "chapter2",
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "ch1_node", kind: "sequence" },
      { id: "e2", source: "ch1_node", target: "ch2_node", kind: "sequence" },
    ];

    const result = simplifyGraph(nodes, edges, {
      ...defaultOptions,
      collapseLinearChains: true,
    });

    // ch1_node and ch2_node must NOT be collapsed together because their chapters differ
    expect(result.nodes).toHaveLength(3);
  });
});
