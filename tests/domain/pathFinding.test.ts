import { describe, expect, it } from "vitest";
import { findPath } from "../../src/domain/transforms/pathFinding.ts";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";

describe("domain / transforms / pathFinding", () => {
  const dummyNodes: FlowNode[] = [
    { id: "A", type: "LABEL", label: "A", dialogueCount: 0 },
    { id: "B", type: "LABEL", label: "B", dialogueCount: 0 },
    { id: "C", type: "LABEL", label: "C", dialogueCount: 0 },
    { id: "D", type: "LABEL", label: "D", dialogueCount: 0 },
  ];

  it("returns unreachable if start or target node ID is missing", () => {
    const res1 = findPath(dummyNodes, [], "", "B");
    expect(res1).toEqual({
      reachable: false,
      pathNodes: [],
      pathEdges: [],
      visitedNodesCount: 0,
    });

    const res2 = findPath(dummyNodes, [], "A", "");
    expect(res2).toEqual({
      reachable: false,
      pathNodes: [],
      pathEdges: [],
      visitedNodesCount: 0,
    });
  });

  it("finds direct path between two connected nodes", () => {
    const edges: FlowEdge[] = [
      { id: "e1", source: "A", target: "B" },
    ];

    const res = findPath(dummyNodes, edges, "A", "B");
    expect(res.reachable).toBe(true);
    expect(res.pathNodes).toEqual(["A", "B"]);
    expect(res.pathEdges).toEqual(["e1"]);
    expect(res.visitedNodesCount).toBe(2);
  });

  it("finds multi-hop shortest path via BFS", () => {
    const edges: FlowEdge[] = [
      { id: "e_ab", source: "A", target: "B" },
      { id: "e_bc", source: "B", target: "C" },
      { id: "e_cd", source: "C", target: "D" },
      { id: "e_ad", source: "A", target: "D" }, // shorter direct route A -> D
    ];

    const res = findPath(dummyNodes, edges, "A", "D");
    expect(res.reachable).toBe(true);
    expect(res.pathNodes).toEqual(["A", "D"]);
    expect(res.pathEdges).toEqual(["e_ad"]);
  });

  it("handles cyclic graph without infinite loop", () => {
    const edges: FlowEdge[] = [
      { id: "e_ab", source: "A", target: "B" },
      { id: "e_ba", source: "B", target: "A" },
      { id: "e_bc", source: "B", target: "C" },
    ];

    const res = findPath(dummyNodes, edges, "A", "C");
    expect(res.reachable).toBe(true);
    expect(res.pathNodes).toEqual(["A", "B", "C"]);
    expect(res.pathEdges).toEqual(["e_ab", "e_bc"]);
  });

  it("returns unreachable when target cannot be reached", () => {
    const edges: FlowEdge[] = [
      { id: "e_ab", source: "A", target: "B" },
      { id: "e_cd", source: "C", target: "D" },
    ];

    const res = findPath(dummyNodes, edges, "A", "D");
    expect(res.reachable).toBe(false);
    expect(res.pathNodes).toEqual([]);
    expect(res.pathEdges).toEqual([]);
    expect(res.visitedNodesCount).toBe(2); // A, B visited
  });
});
