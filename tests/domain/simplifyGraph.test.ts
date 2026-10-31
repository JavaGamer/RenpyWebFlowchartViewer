import { describe, expect, it } from "vitest";
import { simplifyGraph } from "../../src/domain/transforms/simplify.ts";
import type { FlowEdge, FlowNode } from "../../src/domain";

describe("simplifyGraph", () => {
  it("preserves story graph topology intact", () => {
    const nodes: FlowNode[] = [
      { id: "start", type: "LABEL", label: "start", dialogueCount: 1 },
      { id: "node2", type: "LABEL", label: "node2", dialogueCount: 1 },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "start", target: "node2", kind: "sequence" },
    ];
    const result = simplifyGraph(nodes, edges);
    expect(result.nodes).toEqual(nodes);
    expect(result.edges).toEqual(edges);
  });
});
