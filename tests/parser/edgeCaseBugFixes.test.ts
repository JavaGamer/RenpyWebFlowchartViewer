import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import { normalizeGraphState } from "../../src/parser/graphNormalization.ts";
import { createGraphState } from "../../src/parser/pipelineState.ts";
import { evaluateConditionExpression } from "../../src/domain/conditionLogic.ts";
import { resolveGithubUrl } from "../../src/application/urlImporter.ts";
import type { FlowNode } from "../../src/domain/index.ts";

describe("Edge Case & Bug Fix Audits", () => {
  it("handles null or undefined file input safely in parseRenpyFiles", async () => {
    // @ts-expect-error testing null input
    const resultNull = await parseRenpyFiles(null);
    expect(resultNull.nodes).toEqual([]);
    expect(resultNull.edges).toEqual([]);

    // @ts-expect-error testing undefined input
    const resultUndefined = await parseRenpyFiles(undefined);
    expect(resultUndefined.nodes).toEqual([]);
  });

  it("handles empty or missing file content without throwing TypeError", async () => {
    const result = await parseRenpyFiles([
      { name: "empty.rpy", content: "" },
      // @ts-expect-error testing missing content property
      { name: "missing.rpy" },
    ]);
    expect(result.nodes).toBeDefined();
    expect(result.edges).toBeDefined();
  });

  it("filters state.hasReliableReturnInLabel during graph normalization", () => {
    const state = createGraphState();
    const validNode: FlowNode = {
      id: "label_valid",
      type: "LABEL",
      label: "valid",
      role: "story",
      dialogueCount: 0,
    };
    state.nodes = [validNode];
    state.hasReturnInLabel = new Set(["label_valid", "label_dropped"]);
    state.hasReliableReturnInLabel = new Set(["label_valid", "label_dropped"]);

    normalizeGraphState(state);

    expect(state.hasReturnInLabel.has("label_valid")).toBe(true);
    expect(state.hasReturnInLabel.has("label_dropped")).toBe(false);
    expect(state.hasReliableReturnInLabel.has("label_valid")).toBe(true);
    expect(state.hasReliableReturnInLabel.has("label_dropped")).toBe(false);
  });

  it("handles condition evaluation stack underflow gracefully without throwing errors", () => {
    // Missing operands for operator
    const res = evaluateConditionExpression("and", {});
    expect(res).toBe("unknown");
  });

  it("resolves script URLs containing query strings or hash fragments", () => {
    const resolved = resolveGithubUrl(
      "https://github.com/owner/repo/blob/main/script.rpy?v=123#L10",
    );
    expect(resolved).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/script.rpy?v=123#L10",
    );
  });

  it("remaps edge.target and removes self-loops during graph simplification", async () => {
    const { simplifyGraph } = await import(
      "../../src/domain/transforms/simplify.ts"
    );
    const nodes: FlowNode[] = [
      { id: "A", label: "A", type: "LABEL", dialogueCount: 1, chapter: "c1" },
      { id: "B", label: "B", type: "LABEL", dialogueCount: 1, chapter: "c1" },
      { id: "C", label: "C", type: "LABEL", dialogueCount: 1, chapter: "c1" },
      { id: "X", label: "X", type: "LABEL", dialogueCount: 1, chapter: "c2" },
    ];
    const edges = [
      { id: "e1", source: "A", target: "B", kind: "sequence" as const },
      { id: "e2", source: "B", target: "C", kind: "sequence" as const },
      { id: "e3", source: "C", target: "X", kind: "jump" as const },
      { id: "e4", source: "C", target: "B", kind: "jump" as const },
    ];

    const result = simplifyGraph(nodes, edges, {
      collapseLinearChains: true,
      inlineUtilities: false,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });

    // B and C collapse (C collapses into B).
    // e3 (C -> X) source C remapped to B => B -> X
    // e4 (C -> B) source C -> B, target B -> B => self loop B -> B (removed)
    const jumpEdges = result.edges.filter((e) => e.kind === "jump");
    expect(jumpEdges.length).toBe(1);
    expect(jumpEdges[0].source).toBe("B");
    expect(jumpEdges[0].target).toBe("X");
    expect(result.edges.some((e) => e.source === "B" && e.target === "B")).toBe(false);
  });

  it("preserves graph visibility when start node has incoming edges", async () => {
    const { buildConditionalVisibility } = await import(
      "../../src/domain/transforms/visibility.ts"
    );
    const edges = [
      { id: "e1", source: "start", target: "node2" },
      { id: "e2", source: "node2", target: "start" }, // loop back to start
      { id: "e3", source: "orphan", target: "orphan_child" },
    ];

    const res = buildConditionalVisibility({
      edges,
      mockFlags: {},
    });

    expect(res.hiddenNodeIds.has("start")).toBe(false);
    expect(res.hiddenNodeIds.has("node2")).toBe(false);
  });

  it("evaluates unary not correctly without misinterpreting numeric operations", () => {
    const notRes = evaluateConditionExpression("not flag1", {
      flag1: "true",
    });
    expect(notRes).toBe("false");

    const numericNegRes = evaluateConditionExpression("-5", {});
    expect(numericNegRes).toBe("unknown");
  });

  it("strips quotes from target expressions in resolveTargetLabelId", async () => {
    const { resolveTargetLabelId } = await import(
      "../../src/parser/handlers/jumpCallHandler.ts"
    );
    const state = createGraphState();
    state.canonicalLabelIdByName.set("start", "start");

    const res = resolveTargetLabelId(state, '"start"');
    expect(res.resolvedTargetId).toBe("start");
  });

  it("recognizes standard RenPy entry points in control flow reachability", async () => {
    const { runControlFlowAnalysis } = await import(
      "../../src/parser/controlFlowAnalysis.ts"
    );
    const state = createGraphState();
    state.nodes = [
      { id: "start", label: "start", type: "LABEL", dialogueCount: 1 },
      { id: "splashscreen", label: "splashscreen", type: "LABEL", dialogueCount: 1 },
    ];
    state.nodeMap = new Map(state.nodes.map((n) => [n.id, n]));

    runControlFlowAnalysis(state);

    const splashNode = state.nodes.find((n) => n.id === "splashscreen");
    expect(splashNode?.isOrphan).toBeUndefined();
  });

  it("escapes pipe characters and deduplicates node IDs in mermaid exporter", async () => {
    const { exportMermaid } = await import(
      "../../src/application/exporters/mermaidExporter.ts"
    );
    const nodes: FlowNode[] = [
      { id: "node-1", label: "Option A | Choice B", type: "LABEL", dialogueCount: 0 },
      { id: "node_1", label: "Duplicate ID", type: "LABEL", dialogueCount: 0 },
    ];
    const edges = [
      { id: "e1", source: "node-1", target: "node_1", label: "Path | Alt" },
    ];

    const mermaid = exportMermaid(nodes, edges);
    expect(mermaid).toContain("Option A &#124; Choice B");
    expect(mermaid).toContain("Path &#124; Alt");
    expect(mermaid).toContain("n_node_1_1"); // deduplicated ID
  });

  it("derives collapsed label children for DECISION and sub-nodes", async () => {
    const { deriveCollapsedLabelChildren } = await import(
      "../../src/ui/canvasHelpers.ts"
    );
    const nodes = [
      { id: "dec1", data: { nodeType: "DECISION", parentLabelId: "p1" } },
      { id: "sub1", data: { nodeType: "LABEL", parentLabelId: "p1", isSubLabel: true } },
    ];

    const collapsed = deriveCollapsedLabelChildren(nodes, { p1: true });
    expect(collapsed.has("dec1")).toBe(true);
    expect(collapsed.has("sub1")).toBe(true);
  });
});
