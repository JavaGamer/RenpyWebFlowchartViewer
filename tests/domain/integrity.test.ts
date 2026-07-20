import { describe, expect, it } from "vitest";
import {
  EDGE_KIND_FILTERS,
  normalizeEdgeKind,
  resolveGraphIntegrity,
} from "../../src/domain/transforms/integrity.ts";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";

describe("domain / transforms / integrity", () => {
  describe("normalizeEdgeKind", () => {
    it("returns valid edge kinds unchanged", () => {
      for (const kind of EDGE_KIND_FILTERS) {
        expect(normalizeEdgeKind(kind)).toBe(kind);
      }
    });

    it("falls back to sequence for undefined or unknown edge kinds", () => {
      expect(normalizeEdgeKind(undefined)).toBe("sequence");
      expect(normalizeEdgeKind("invalid_kind")).toBe("sequence");
      expect(normalizeEdgeKind("")).toBe("sequence");
    });
  });

  describe("resolveGraphIntegrity", () => {
    it("deduplicates nodes keeping only the first instance of duplicate ID", () => {
      const rawNodes: FlowNode[] = [
        { id: "node1", type: "LABEL", label: "First Node 1", dialogueCount: 1 },
        {
          id: "node1",
          type: "LABEL",
          label: "Duplicate Node 1",
          dialogueCount: 5,
        },
        { id: "node2", type: "LABEL", label: "Node 2", dialogueCount: 2 },
      ];
      const rawEdges: FlowEdge[] = [];

      const { nodes, edges } = resolveGraphIntegrity(rawNodes, rawEdges);
      expect(nodes.length).toBe(2);
      expect(nodes[0].label).toBe("First Node 1");
      expect(nodes[1].id).toBe("node2");
      expect(edges.length).toBe(0);
    });

    it("injects unresolved placeholder nodes when source or target is missing", () => {
      const rawNodes: FlowNode[] = [
        { id: "start", type: "LABEL", label: "Start", dialogueCount: 0 },
      ];
      const rawEdges: FlowEdge[] = [
        { id: "e1", source: "start", target: "missing_target", kind: "jump" },
        { id: "e2", source: "missing_source", target: "start", kind: "call" },
      ];

      const { nodes, edges } = resolveGraphIntegrity(rawNodes, rawEdges);
      expect(nodes.length).toBe(3);

      const targetPlaceholder = nodes.find((n) => n.id === "missing_target");
      expect(targetPlaceholder).toBeDefined();
      expect(targetPlaceholder?.chapter).toBe("__unresolved__");
      expect(targetPlaceholder?.label).toBe("(unresolved) missing_target");

      const sourcePlaceholder = nodes.find((n) => n.id === "missing_source");
      expect(sourcePlaceholder).toBeDefined();
      expect(sourcePlaceholder?.chapter).toBe("__unresolved__");

      expect(edges.length).toBe(2);
    });

    it("ignores edges without source or target", () => {
      const rawNodes: FlowNode[] = [
        { id: "node1", type: "LABEL", label: "Node 1", dialogueCount: 0 },
      ];
      const rawEdges: FlowEdge[] = [
        { id: "e1", source: "", target: "node1" },
        { id: "e2", source: "node1", target: "" },
      ];

      const { edges } = resolveGraphIntegrity(rawNodes, rawEdges);
      expect(edges.length).toBe(0);
    });

    it("deduplicates semantically identical edges and assigns derived ID if empty", () => {
      const rawNodes: FlowNode[] = [
        { id: "A", type: "LABEL", label: "A", dialogueCount: 0 },
        { id: "B", type: "LABEL", label: "B", dialogueCount: 0 },
      ];
      const rawEdges: FlowEdge[] = [
        { id: "", source: "A", target: "B", kind: "jump", label: "Option 1" },
        {
          id: "e_dup",
          source: "A",
          target: "B",
          kind: "jump",
          label: "Option 1",
        },
        {
          id: "e_diff",
          source: "A",
          target: "B",
          kind: "call",
          label: "Option 1",
        },
      ];

      const { edges } = resolveGraphIntegrity(rawNodes, rawEdges);
      expect(edges.length).toBe(2);
      expect(edges[0].id).toBe("jump_A__B");
      expect(edges[0].kind).toBe("jump");
      expect(edges[1].id).toBe("e_diff");
      expect(edges[1].kind).toBe("call");
    });
  });
});
