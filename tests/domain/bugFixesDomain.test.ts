import { describe, expect, it } from "vitest";
import {
  buildVisibleEdges,
  buildVisibleNodes,
} from "../../src/domain/transforms/visibility.ts";
import { evaluateConditionExpression } from "../../src/domain/conditionLogic.ts";
import type { CanvasEdge, CanvasNode } from "../../src/domain/types.ts";

describe("Domain Bug Fixes Sweep", () => {
  it("enforces search scopes for digit queries in buildVisibleNodes", () => {
    const nodes: CanvasNode[] = [
      {
        id: "node_1",
        position: { x: 0, y: 0 },
        data: {
          label: "Chapter One",
          chapter: "ch1",
          dialogueCount: 10,
        },
      },
      {
        id: "node_2",
        position: { x: 0, y: 100 },
        data: {
          label: "Chapter Two",
          chapter: "ch2",
          dialogueCount: 10,
        },
      },
    ];

    // searchMatchNodeIds represents nodes matching search query AND active chapter scope filter (ch1)
    const searchMatchNodeIds = new Set(["node_1"]);
    const visible = buildVisibleNodes({
      nodes,
      search: "10",
      searchMatchNodeIds,
      collapsedChapters: {},
      collapsedLabelChildren: new Set(),
      minDialogue: 0,
      theme: "light",
    });

    const hiddenIds = visible.filter((n) => n.hidden).map((n) => n.id);
    expect(hiddenIds).toContain("node_2");
    expect(visible.find((n) => n.id === "node_1")?.hidden).toBeFalsy();
  });

  it("retains edges connected to visible viewport nodes during spatial culling", () => {
    const edges: CanvasEdge[] = [
      {
        id: "edge_1_2",
        source: "node_1",
        target: "node_2",
        data: { kind: "sequence" },
      },
    ];

    // Spatial culling includes node_1 (in viewport) but not node_2 (just outside viewport)
    const visibleNodeIds = new Set(["node_1"]);
    const nonHiddenNodeIds = new Set(["node_1", "node_2"]);

    const visibleEdges = buildVisibleEdges({
      edges,
      showCallReturns: true,
      visibleEdgeKinds: {
        sequence: true,
        jump: true,
        call: true,
        call_return: true,
        conditional: true,
        choice: true,
      },
      visibleNodeIds,
      nonHiddenNodeIds,
      edgeColor: "#000",
      largeGraphMode: false,
    });

    expect(visibleEdges.length).toBe(1);
    expect(visibleEdges[0].id).toBe("edge_1_2");
  });

  it("strictly checks decimal numeric strings in condition expressions", () => {
    // String equality comparison "0x10" vs "16" should be false (not coerced to decimal numeric equality)
    expect(evaluateConditionExpression('"0x10" == 16', {})).toBe("false");

    // Strictly decimal strings "16" vs "16.0" equal
    expect(evaluateConditionExpression("16 == 16.0", {})).toBe("true");
  });
});
