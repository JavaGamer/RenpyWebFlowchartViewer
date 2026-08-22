import { describe, expect, it, vi } from "vitest";
import {
  buildFilletedOrthogonalPath,
  calculateBackEdgeSpline,
  calculateSelfLoopArc,
  detectBackEdge,
  type FlowEdge,
  type FlowNode,
  Position,
} from "../../src/domain/index.ts";
import {
  applyDagreLayout,
  applyElkLayout,
  setElkInstance,
} from "../../src/infrastructure/layoutEngines.ts";
import { buildVisibleEdges } from "../../src/domain/transforms/visibility.ts";

describe("Smart Loop & Back-Edge Spline Routing", () => {
  describe("detectBackEdge", () => {
    it("detects upward flow as back-edge in TB direction", () => {
      // Source node at y=300, target node at y=100 (jumping back up)
      expect(
        detectBackEdge({ x: 100, y: 300 }, { x: 100, y: 100 }, "TB"),
      ).toBe(true);

      // Same rank forward flow left-to-right (x=100 to x=200, y=100) -> not a back-edge
      expect(
        detectBackEdge({ x: 100, y: 100 }, { x: 200, y: 100 }, "TB"),
      ).toBe(false);

      // Same rank reverse flow right-to-left (x=200 to x=100, y=100) -> is a back-edge
      expect(
        detectBackEdge({ x: 200, y: 100 }, { x: 100, y: 100 }, "TB"),
      ).toBe(true);

      // Downward flow (source at y=100, target at y=300)
      expect(
        detectBackEdge({ x: 100, y: 100 }, { x: 100, y: 300 }, "TB"),
      ).toBe(false);
    });

    it("detects leftward flow as back-edge in LR direction", () => {
      // Source at x=400, target at x=100 (jumping back left)
      expect(
        detectBackEdge({ x: 400, y: 100 }, { x: 100, y: 100 }, "LR"),
      ).toBe(true);

      // Same column downward flow (y=100 to y=200, x=100) -> not a back-edge
      expect(
        detectBackEdge({ x: 100, y: 100 }, { x: 100, y: 200 }, "LR"),
      ).toBe(false);

      // Same column upward reverse flow (y=200 to y=100, x=100) -> is a back-edge
      expect(
        detectBackEdge({ x: 100, y: 200 }, { x: 100, y: 100 }, "LR"),
      ).toBe(true);

      // Forward flow in LR (source at x=100, target at x=400)
      expect(
        detectBackEdge({ x: 100, y: 100 }, { x: 400, y: 100 }, "LR"),
      ).toBe(false);
    });

    it("always treats self-loops as back-edges", () => {
      expect(
        detectBackEdge({ x: 100, y: 100 }, { x: 100, y: 100 }, "TB", true),
      ).toBe(true);
    });
  });

  describe("calculateBackEdgeSpline", () => {
    it("generates a smooth C-curve cubic bezier routing along lateral clearance channel in TB mode", () => {
      const res = calculateBackEdgeSpline({
        sourceX: 320,
        sourceY: 400,
        targetX: 320,
        targetY: 100,
        sourcePosition: Position.Right,
        targetPosition: Position.Right,
        direction: "TB",
        laneIndex: 0,
      });

      expect(res.path).toContain("M 320 400 C");
      expect(res.path).toContain("320 100");
      // Label should be placed out in the clearance gutter (x > 320)
      expect(res.labelX).toBeGreaterThan(320);
      expect(res.labelY).toBeGreaterThanOrEqual(100);
      expect(res.labelY).toBeLessThanOrEqual(400);
    });

    it("routes multi-column back-edges cleanly through the outermost lateral gutter", () => {
      // Source in column 2 (x=500), target in column 1 (x=100)
      const res = calculateBackEdgeSpline({
        sourceX: 500,
        sourceY: 400,
        targetX: 100,
        targetY: 100,
        direction: "TB",
        laneIndex: 0,
      });

      // Both control points must align to max(500, 100) + offset to avoid slicing through column 1.5
      expect(res.path).toMatch(/C (\d+) 400, \1 100/);
      expect(res.labelX).toBeGreaterThan(500);
    });

    it("applies lane offsets to parallel back-edges to prevent overlapping", () => {
      const lane0 = calculateBackEdgeSpline({
        sourceX: 320,
        sourceY: 400,
        targetX: 320,
        targetY: 100,
        direction: "TB",
        laneIndex: 0,
      });

      const lane1 = calculateBackEdgeSpline({
        sourceX: 320,
        sourceY: 400,
        targetX: 320,
        targetY: 100,
        direction: "TB",
        laneIndex: 1,
      });

      expect(lane1.labelX).toBeGreaterThan(lane0.labelX);
    });

    it("routes along top/bottom gutters in LR mode", () => {
      const res = calculateBackEdgeSpline({
        sourceX: 500,
        sourceY: 150,
        targetX: 100,
        targetY: 150,
        direction: "LR",
        laneIndex: 0,
      });

      expect(res.path).toContain("M 500 150 C");
      expect(res.path).toContain("100 150");
      // Label Y should be outside the node row
      expect(res.labelY).toBeGreaterThan(150);
    });
  });

  describe("calculateSelfLoopArc", () => {
    it("generates a clean horseshoe arc for self-loop edges", () => {
      const res = calculateSelfLoopArc({
        sourceX: 320,
        sourceY: 140,
        targetX: 210,
        targetY: 100,
        direction: "TB",
        laneIndex: 0,
      });

      expect(res.path).toContain("M 320 140 C");
      expect(res.path).toContain("210 100");
      expect(res.labelX).toBeGreaterThan(320);
    });
  });

  describe("buildFilletedOrthogonalPath", () => {
    it("creates an SVG path with quadratic fillets from orthogonal points", () => {
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 300 },
      ];

      const res = buildFilletedOrthogonalPath(points, 10);
      expect(res.path).toContain("M 100 100");
      expect(res.path).toContain("Q 200 100");
      expect(res.path).toContain("L 200 300");
      expect(res.labelX).toBe(200);
      expect(res.labelY).toBe(200);
    });

    it("emits straight line segments for collinear waypoints without quadratic fillets", () => {
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 300, y: 100 },
      ];

      const res = buildFilletedOrthogonalPath(points, 10);
      expect(res.path).not.toContain("Q");
      expect(res.path).toBe("M 100 100 L 200 100 L 300 100");
    });

    it("handles 2-point straight segments", () => {
      const res = buildFilletedOrthogonalPath([
        { x: 100, y: 100 },
        { x: 100, y: 200 },
      ]);
      expect(res.path).toBe("M 100 100 L 100 200");
      expect(res.labelX).toBe(100);
      expect(res.labelY).toBe(150);
    });
  });

  describe("applyDagreLayout with Smart Loop Routing", () => {
    it("tags cyclic back-edges with isBackEdge and assigns proper side handles", () => {
      const rawNodes: FlowNode[] = [
        {
          id: "start",
          type: "LABEL",
          label: "start",
          dialogueCount: 2,
          role: "story",
        },
        {
          id: "loop_node",
          type: "DECISION",
          label: "while count < 5",
          dialogueCount: 0,
          role: "while_loop",
          condition: { branchKind: "while", expression: "count < 5" },
        },
        {
          id: "body",
          type: "LABEL",
          label: "body",
          dialogueCount: 1,
          role: "story",
        },
      ];

      const rawEdges: FlowEdge[] = [
        { id: "e1", source: "start", target: "loop_node", kind: "sequence" },
        { id: "e2", source: "loop_node", target: "body", kind: "sequence" },
        // Back-edge from body back to loop_node
        { id: "e3", source: "body", target: "loop_node", kind: "jump" },
      ];

      const { nodes, edges } = applyDagreLayout(rawNodes, rawEdges, "TB");

      expect(nodes).toHaveLength(3);
      expect(edges).toHaveLength(3);

      const backEdge = edges.find((e) => e.id === "e3");
      expect(backEdge).toBeDefined();
      expect(backEdge?.data?.isBackEdge).toBe(true);
      expect(backEdge?.sourceHandle).toBe("source-right");
      expect(backEdge?.targetHandle).toBe("target-right");
      expect(backEdge?.data?.svgPath).toBeDefined();
      expect(backEdge?.data?.labelPosition).toBeDefined();
    });
  });

  describe("applyElkLayout with Dedicated Loop Rules & Orthogonal Routing", () => {
    it("applies orthogonal routing, feedback edges, and shifts coordinates on translation alignment", async () => {
      const mockElkInstance = {
        layout: vi.fn().mockImplementation(async (graph) => {
          const laidOutChildren = graph.children.map(
            (
              c: { id: string; width: number; height: number },
              idx: number,
            ) => ({
              ...c,
              x: 100,
              y: idx * 200,
            }),
          );
          const laidOutEdges = graph.edges.map((e: { id: string }) => ({
            ...e,
            sections: [
              {
                startPoint: { x: 210, y: 240 },
                endPoint: { x: 210, y: 40 },
                bendPoints: [
                  { x: 380, y: 240 },
                  { x: 380, y: 40 },
                ],
              },
            ],
          }));
          return {
            ...graph,
            children: laidOutChildren,
            edges: laidOutEdges,
          };
        }),
      };

      setElkInstance(
        mockElkInstance as unknown as Parameters<typeof setElkInstance>[0],
      );

      const rawNodes: FlowNode[] = [
        {
          id: "while_head",
          type: "DECISION",
          label: "while True",
          dialogueCount: 0,
          role: "while_loop",
          condition: { branchKind: "while", expression: "True" },
        },
        {
          id: "body_node",
          type: "LABEL",
          label: "Loop Body",
          dialogueCount: 2,
          role: "story",
        },
      ];

      const rawEdges: FlowEdge[] = [
        {
          id: "e_enter",
          source: "while_head",
          target: "body_node",
          kind: "sequence",
        },
        {
          id: "e_repeat",
          source: "body_node",
          target: "while_head",
          kind: "jump",
        },
      ];

      const { nodes, edges } = await applyElkLayout(rawNodes, rawEdges, "TB", {
        previousPositions: new Map([["while_head", { x: 50, y: 50 }]]),
      });

      expect(mockElkInstance.layout).toHaveBeenCalledTimes(1);
      const passedGraph = mockElkInstance.layout.mock.calls[0]![0];
      expect(passedGraph.layoutOptions["org.eclipse.elk.edgeRouting"]).toBe(
        "ORTHOGONAL",
      );
      expect(passedGraph.layoutOptions["org.eclipse.elk.layered.feedbackEdges"])
        .toBe("true");

      // Verify while_head received FIXED_SIDE portConstraints
      const whileHeadElkNode = passedGraph.children.find(
        (c: { id: string }) => c.id === "while_head",
      );
      expect(
        whileHeadElkNode?.layoutOptions?.["org.eclipse.elk.portConstraints"],
      )
        .toBe("FIXED_SIDE");

      expect(nodes).toHaveLength(2);
      expect(edges).toHaveLength(2);

      const repeatEdge = edges.find((e) => e.id === "e_repeat");
      expect(repeatEdge).toBeDefined();
      expect(repeatEdge?.data?.isBackEdge).toBe(true);
      expect(repeatEdge?.sourceHandle).toBeDefined();
      expect(repeatEdge?.targetHandle).toBeDefined();
      expect(repeatEdge?.data?.svgPath).toBeDefined();
      expect(repeatEdge?.data?.bendPoints).toHaveLength(4);

      // Clean up mock
      setElkInstance(null);
    });
  });

  describe("buildVisibleEdges Memoization", () => {
    it("preserves smart back-edge data and invalidates cache when handles or paths change", () => {
      const initialEdges = [
        {
          id: "e1",
          source: "n1",
          target: "n2",
          type: "labeled",
          sourceHandle: "source-right",
          targetHandle: "target-right",
          data: {
            label: "repeat",
            kind: "jump" as const,
            isBackEdge: true,
            svgPath: "M 0 0 C 10 10 20 20 30 30",
            labelPosition: { x: 15, y: 15 },
          },
        },
      ];

      const visibleNodeIds = new Set(["n1", "n2"]);
      const visibleEdgeKinds = {
        sequence: true,
        jump: true,
        call: true,
        call_return: true,
      };

      const firstPass = buildVisibleEdges({
        edges: initialEdges,
        showCallReturns: true,
        visibleEdgeKinds,
        visibleNodeIds,
        edgeColor: "#cbd5e1",
        largeGraphMode: false,
      });

      expect(firstPass).toHaveLength(1);
      expect(firstPass[0]!.sourceHandle).toBe("source-right");
      expect(firstPass[0]!.data?.svgPath).toBe("M 0 0 C 10 10 20 20 30 30");

      const previousMap = new Map([["e1", firstPass[0]!]]);

      // When identical, memo cache returns previous instance
      const secondPass = buildVisibleEdges({
        edges: initialEdges,
        showCallReturns: true,
        visibleEdgeKinds,
        visibleNodeIds,
        edgeColor: "#cbd5e1",
        largeGraphMode: false,
        previousById: previousMap,
      });

      expect(secondPass[0]).toBe(firstPass[0]);

      // When handle changes, cache updates cleanly
      const modifiedEdges = [
        {
          ...initialEdges[0]!,
          sourceHandle: "source-bottom",
          data: {
            ...initialEdges[0]!.data,
            svgPath: "M 0 0 L 100 100",
          },
        },
      ];

      const thirdPass = buildVisibleEdges({
        edges: modifiedEdges,
        showCallReturns: true,
        visibleEdgeKinds,
        visibleNodeIds,
        edgeColor: "#cbd5e1",
        largeGraphMode: false,
        previousById: previousMap,
      });

      expect(thirdPass[0]).not.toBe(firstPass[0]);
      expect(thirdPass[0]!.sourceHandle).toBe("source-bottom");
      expect(thirdPass[0]!.data?.svgPath).toBe("M 0 0 L 100 100");
    });
  });
});
