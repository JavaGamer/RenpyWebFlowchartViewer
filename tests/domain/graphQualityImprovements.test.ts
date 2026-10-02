import { describe, expect, it } from "vitest";
import {
  type CanvasNode,
  type FlowEdge,
  type FlowNode,
  NODE_WIDTH,
  normalizeForkRejoinGeometry,
} from "../../src/domain/index.ts";
import {
  applyDagreLayout,
  applyTwoTierDagreLayout,
} from "../../src/infrastructure/layoutEngines.ts";
import { parseRenpyFiles } from "../../src/parser/parser.ts";

describe("Graph Quality Improvements", () => {
  describe("Phase 4: Symmetrical Diamond Geometry (normalizeForkRejoinGeometry)", () => {
    it("equalizes immediate branch head Y tiers and centers the rejoin node along the branch centroid", () => {
      const nodes: CanvasNode[] = [
        {
          id: "fork",
          position: { x: 300, y: 50 },
          data: { label: "Decision", nodeType: "DECISION" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "branch_a",
          position: { x: 100, y: 180 },
          data: { label: "Choice A" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "branch_b",
          position: { x: 500, y: 210 },
          data: { label: "Choice B" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "rejoin",
          position: { x: 100, y: 350 },
          data: { label: "Rejoin" },
          width: NODE_WIDTH,
          height: 80,
        },
      ];

      const edges: FlowEdge[] = [
        { id: "e1", source: "fork", target: "branch_a", kind: "jump" },
        { id: "e2", source: "fork", target: "branch_b", kind: "jump" },
        { id: "e3", source: "branch_a", target: "rejoin", kind: "jump" },
        { id: "e4", source: "branch_b", target: "rejoin", kind: "jump" },
      ];

      normalizeForkRejoinGeometry(nodes, edges, "TB");

      const nodeA = nodes.find((n) => n.id === "branch_a")!;
      const nodeB = nodes.find((n) => n.id === "branch_b")!;
      const rejoinNode = nodes.find((n) => n.id === "rejoin")!;

      // Both branch heads must be equalized to the deeper tier (Y=210)
      expect(nodeA.position.y).toBe(210);
      expect(nodeB.position.y).toBe(210);

      // Rejoin node must be centered horizontally between branch_a (x=100..320) and branch_b (x=500..720)
      // Span is minX=100, maxX=720, centroid is 410. Centered node at 410 - 110 = 300
      expect(rejoinNode.position.x).toBe(300);
    });

    it("equalizes branch heads in LR layout along the X-axis", () => {
      const nodes: CanvasNode[] = [
        {
          id: "fork",
          position: { x: 50, y: 300 },
          data: { label: "Decision", nodeType: "DECISION" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "branch_a",
          position: { x: 180, y: 100 },
          data: { label: "Choice A" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "branch_b",
          position: { x: 210, y: 500 },
          data: { label: "Choice B" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "rejoin",
          position: { x: 350, y: 100 },
          data: { label: "Rejoin" },
          width: NODE_WIDTH,
          height: 80,
        },
      ];

      const edges: FlowEdge[] = [
        { id: "e1", source: "fork", target: "branch_a", kind: "jump" },
        { id: "e2", source: "fork", target: "branch_b", kind: "jump" },
        { id: "e3", source: "branch_a", target: "rejoin", kind: "jump" },
        { id: "e4", source: "branch_b", target: "rejoin", kind: "jump" },
      ];

      normalizeForkRejoinGeometry(nodes, edges, "LR");

      const nodeA = nodes.find((n) => n.id === "branch_a")!;
      const nodeB = nodes.find((n) => n.id === "branch_b")!;
      const rejoinNode = nodes.find((n) => n.id === "rejoin")!;

      expect(nodeA.position.x).toBe(210);
      expect(nodeB.position.x).toBe(210);
      // Span is minY=100, maxY=580, centroid is 340. Centered node at 340 - 40 = 300
      expect(rejoinNode.position.y).toBe(300);
    });
  });

  describe("Phase 5: Orthogonal Bus Reconvergence for Multi-Inflow Nodes", () => {
    it("routes reconverging forward edges through an orthogonal bus bar before target", async () => {
      const script = [
        "label start:",
        "    menu:",
        '        "Option A":',
        "            jump choice_a",
        '        "Option B":',
        "            jump choice_b",
        "",
        "label choice_a:",
        '    "Dialogue A"',
        "    jump common_target",
        "",
        "label choice_b:",
        '    "Dialogue B"',
        "    jump common_target",
        "",
        "label common_target:",
        '    "Converged"',
        "    return",
      ].join("\n");

      const parsed = await parseRenpyFiles([
        { name: "bus_test.rpy", content: script },
      ]);

      const layout = applyDagreLayout(parsed.nodes, parsed.edges, "TB");
      const commonTargetNode = layout.nodes.find(
        (n) => n.id === "common_target",
      )!;
      const incomingEdges = layout.edges.filter(
        (e) => e.target === "common_target",
      );

      expect(incomingEdges).toHaveLength(2);

      for (const edge of incomingEdges) {
        expect(edge.data?.svgPath).toBeDefined();
        expect(edge.data?.bendPoints).toBeDefined();
        const pts = edge.data!.bendPoints!;
        // The waypoints must drop down to Y_bus = commonTargetNode.position.y - 28
        const expectedYBus = commonTargetNode.position.y - 28;
        const busWaypoints = pts.filter(
          (p) => Math.abs(p.y - expectedYBus) < 1.0,
        );
        expect(busWaypoints.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("staggers midpoint labels along orthogonal bus lines to avoid collision", async () => {
      const rawNodes: FlowNode[] = [
        { id: "a", type: "LABEL", label: "A", dialogueCount: 1 },
        { id: "b", type: "LABEL", label: "B", dialogueCount: 1 },
        { id: "target", type: "LABEL", label: "Target", dialogueCount: 1 },
      ];
      const rawEdges: FlowEdge[] = [
        {
          id: "e1",
          source: "a",
          target: "target",
          kind: "jump",
          label: "Path 1",
        },
        {
          id: "e2",
          source: "b",
          target: "target",
          kind: "jump",
          label: "Path 2",
        },
      ];

      const layout = applyDagreLayout(rawNodes, rawEdges, "TB");
      const edge1 = layout.edges.find((e) => e.id === "e1")!;
      const edge2 = layout.edges.find((e) => e.id === "e2")!;

      expect(edge1.data?.labelPosition).toBeDefined();
      expect(edge2.data?.labelPosition).toBeDefined();

      const p1 = edge1.data!.labelPosition!;
      const p2 = edge2.data!.labelPosition!;
      const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      // The labels must be separated cleanly
      expect(distance).toBeGreaterThan(15);
    });
  });

  describe("Phase 5: Lateral Expressway Gutters (Outer Clearance Channels)", () => {
    it("routes back-edges through the left gutter clearance channel in TB mode", () => {
      const rawNodes: FlowNode[] = [
        { id: "start", type: "LABEL", label: "Start", dialogueCount: 1 },
        { id: "step1", type: "LABEL", label: "Step 1", dialogueCount: 1 },
        {
          id: "loop_head",
          type: "LABEL",
          label: "Loop Head",
          dialogueCount: 1,
        },
      ];
      const rawEdges: FlowEdge[] = [
        { id: "e1", source: "start", target: "step1", kind: "sequence" },
        { id: "e2", source: "step1", target: "loop_head", kind: "sequence" },
        // Back edge: target is upstream of source
        { id: "e_back", source: "loop_head", target: "start", kind: "jump" },
      ];

      const layout = applyDagreLayout(rawNodes, rawEdges, "TB");
      const backEdge = layout.edges.find((e) => e.id === "e_back")!;

      expect(backEdge).toBeDefined();
      expect(backEdge.data?.isBackEdge).toBe(true);
      expect(backEdge.sourceHandle).toBe("source-left");
      expect(backEdge.targetHandle).toBe("target-left");
      expect(backEdge.data?.isLeft).toBe(true);
      expect(backEdge.data?.outerGutterCoord).toBeLessThan(
        layout.spatialBounds!.minX,
      );
    });

    it("routes multi-tier forward skips through the right gutter expressway", () => {
      const rawNodes: FlowNode[] = [
        { id: "n1", type: "LABEL", label: "Top", dialogueCount: 1 },
        {
          id: "n2",
          type: "LABEL",
          label: "Middle 1",
          dialogueCount: 5,
          wordCount: 200,
        },
        {
          id: "n3",
          type: "LABEL",
          label: "Middle 2",
          dialogueCount: 5,
          wordCount: 200,
        },
        {
          id: "n4",
          type: "LABEL",
          label: "Middle 3",
          dialogueCount: 5,
          wordCount: 200,
        },
        {
          id: "n5",
          type: "LABEL",
          label: "Middle 4",
          dialogueCount: 5,
          wordCount: 200,
        },
        {
          id: "n_target",
          type: "LABEL",
          label: "Bottom Exit",
          dialogueCount: 1,
        },
      ];

      // A long forward skip from n1 directly to n_target jumping over 4 tiers
      const rawEdges: FlowEdge[] = [
        { id: "seq1", source: "n1", target: "n2", kind: "sequence" },
        { id: "seq2", source: "n2", target: "n3", kind: "sequence" },
        { id: "seq3", source: "n3", target: "n4", kind: "sequence" },
        { id: "seq4", source: "n4", target: "n5", kind: "sequence" },
        { id: "seq5", source: "n5", target: "n_target", kind: "sequence" },
        { id: "long_skip", source: "n1", target: "n_target", kind: "jump" },
      ];

      const layout = applyDagreLayout(rawNodes, rawEdges, "TB");
      const skipEdge = layout.edges.find((e) => e.id === "long_skip")!;

      expect(skipEdge).toBeDefined();
      expect(skipEdge.data?.isLongSkip).toBe(true);
      expect(skipEdge.sourceHandle).toBe("source-right");
      expect(skipEdge.targetHandle).toBe("target-right");
      expect(skipEdge.data?.isLeft).toBe(false);
      expect(skipEdge.data?.outerGutterCoord).toBeGreaterThan(
        layout.spatialBounds!.maxX,
      );
    });
  });

  describe("Phase 3: Fallthrough Edge Semantics and Cross-File Diagnostics", () => {
    it("emits cross_file_fallthrough warning diagnostic when a label implicitly falls through across files", async () => {
      const file1 = [
        "label chapter1_end:",
        '    "Final line in chapter 1 without jump or return"',
      ].join("\n");

      const file2 = [
        "label chapter2_start:",
        '    "First line in chapter 2"',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([
        { name: "chap1.rpy", content: file1 },
        { name: "chap2.rpy", content: file2 },
      ]);

      const diag = result.diagnostics.find(
        (d) => d.context?.category === "cross_file_fallthrough",
      );
      expect(diag).toBeDefined();
      expect(diag?.severity).toBe("warning");
      expect(diag?.message).toContain("implicitly falls through");

      const fallthroughEdge = result.edges.find(
        (e) => e.source === "chapter1_end" && e.target === "chapter2_start",
      );
      expect(fallthroughEdge).toBeDefined();
      expect(fallthroughEdge?.kind).toBe("fallthrough");
      expect(fallthroughEdge?.isFallthrough).toBe(true);
    });

    it("marks intra-chapter sequence transitions with isFallthrough", async () => {
      const file = [
        "label step1:",
        '    "step 1 dialogue"',
        "",
        "label step2:",
        '    "step 2 dialogue"',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([
        { name: "story.rpy", content: file },
      ]);

      const edge = result.edges.find(
        (e) => e.source === "step1" && e.target === "step2",
      );
      expect(edge).toBeDefined();
      expect(edge?.kind).toBe("sequence");
      expect(edge?.isFallthrough).toBe(true);
    });

    it("detects cross-file fallthrough when a label ends with a subroutine call (Defect 6)", async () => {
      const file1 = [
        "label subroutine_somewhere:",
        '    "Subroutine line"',
        "    return",
        "",
        "label file1_end:",
        '    "Line before call"',
        "    call subroutine_somewhere",
      ].join("\n");

      const file2 = [
        "label file2_start:",
        '    "First line in file 2"',
        "    return",
      ].join("\n");

      const result = await parseRenpyFiles([
        { name: "f1.rpy", content: file1 },
        { name: "f2.rpy", content: file2 },
      ]);

      const diag = result.diagnostics.find(
        (d) =>
          d.context?.category === "cross_file_fallthrough" &&
          d.location?.sourceId === "file1_end" &&
          d.location?.targetId === "file2_start",
      );
      expect(diag).toBeDefined();
      expect(diag?.severity).toBe("warning");

      const fallthroughEdge = result.edges.find(
        (e) => e.source === "file1_end" && e.target === "file2_start",
      );
      expect(fallthroughEdge).toBeDefined();
      expect(fallthroughEdge?.kind).toBe("fallthrough");
    });
  });

  describe("Adversarial Defect Regressions", () => {
    it("Defect 1: LR mode routes long skips and back-edges through Y gutters with lane-offset bendPoints", () => {
      const rawNodes: FlowNode[] = [
        { id: "n1", type: "LABEL", label: "Start", dialogueCount: 1 },
        { id: "n2", type: "LABEL", label: "Step 1", dialogueCount: 1 },
        { id: "n3", type: "LABEL", label: "Step 2", dialogueCount: 1 },
        { id: "n4", type: "LABEL", label: "Step 3", dialogueCount: 1 },
        { id: "n5", type: "LABEL", label: "End", dialogueCount: 1 },
      ];
      const rawEdges: FlowEdge[] = [
        { id: "s1", source: "n1", target: "n2", kind: "sequence" },
        { id: "s2", source: "n2", target: "n3", kind: "sequence" },
        { id: "s3", source: "n3", target: "n4", kind: "sequence" },
        { id: "s4", source: "n4", target: "n5", kind: "sequence" },
        { id: "skip", source: "n1", target: "n5", kind: "jump" },
        { id: "back", source: "n4", target: "n2", kind: "jump" },
      ];

      const layout = applyDagreLayout(rawNodes, rawEdges, "LR");
      const skipEdge = layout.edges.find((e) => e.id === "skip")!;
      const backEdge = layout.edges.find((e) => e.id === "back")!;

      expect(skipEdge.data?.bendPoints).toBeDefined();
      const skipPts = skipEdge.data!.bendPoints!;
      // In LR mode, long skip waypoints must drop to Y = bottom gutter (greater than maxY)
      expect(skipPts[1]!.y).toBeGreaterThan(layout.spatialBounds!.maxY);
      expect(skipPts[2]!.y).toBeGreaterThan(layout.spatialBounds!.maxY);

      expect(backEdge.data?.bendPoints).toBeDefined();
      const backPts = backEdge.data!.bendPoints!;
      // In LR mode, back edge waypoints must rise to Y = top gutter (less than minY)
      expect(backPts[1]!.y).toBeLessThan(layout.spatialBounds!.minY);
      expect(backPts[2]!.y).toBeLessThan(layout.spatialBounds!.minY);
    });

    it("Defect 2 & 3: Bus reconvergence clamps slot offsets to node boundaries and ignores insufficient clearance", () => {
      const rawNodes: FlowNode[] = [
        { id: "src1", type: "LABEL", label: "Source 1", dialogueCount: 1 },
        { id: "src2", type: "LABEL", label: "Source 2", dialogueCount: 1 },
        { id: "tgt", type: "LABEL", label: "Target", dialogueCount: 1 },
      ];
      const rawEdges: FlowEdge[] = [
        { id: "e1", source: "src1", target: "tgt", kind: "jump" },
        { id: "e2", source: "src2", target: "tgt", kind: "jump" },
      ];

      const layout = applyDagreLayout(rawNodes, rawEdges, "TB");
      const tgtNode = layout.nodes.find((n) => n.id === "tgt")!;
      const incoming = layout.edges.filter((e) => e.target === "tgt");

      for (const e of incoming) {
        if (e.data?.bendPoints) {
          const lastPt = e.data.bendPoints[e.data.bendPoints.length - 1]!;
          // End point X must stay strictly within target node width
          expect(lastPt.x).toBeGreaterThanOrEqual(tgtNode.position.x + 10);
          expect(lastPt.x).toBeLessThanOrEqual(
            tgtNode.position.x + NODE_WIDTH - 10,
          );
        }
      }
    });

    it("Defect 4: normalizeForkRejoinGeometry handles negative coordinate spaces correctly", () => {
      const nodes: CanvasNode[] = [
        {
          id: "fork",
          position: { x: -200, y: -300 },
          data: { label: "Fork" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "branch1",
          position: { x: -350, y: -150 },
          data: { label: "B1" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "branch2",
          position: { x: -50, y: -100 },
          data: { label: "B2" },
          width: NODE_WIDTH,
          height: 80,
        },
        {
          id: "join",
          position: { x: -200, y: 0 },
          data: { label: "Join" },
          width: NODE_WIDTH,
          height: 80,
        },
      ];
      const edges: FlowEdge[] = [
        { id: "e1", source: "fork", target: "branch1", kind: "jump" },
        { id: "e2", source: "fork", target: "branch2", kind: "jump" },
        { id: "e3", source: "branch1", target: "join", kind: "jump" },
        { id: "e4", source: "branch2", target: "join", kind: "jump" },
      ];

      normalizeForkRejoinGeometry(nodes, edges, "TB");

      const b1 = nodes.find((n) => n.id === "branch1")!;
      const b2 = nodes.find((n) => n.id === "branch2")!;

      // Both branch heads should be aligned to maxY = -100 (NOT 0!)
      expect(b1.position.y).toBe(-100);
      expect(b2.position.y).toBe(-100);
    });

    it("Defect 5: Chapter-local gutters keep intra-chapter edges inside container bounds", () => {
      const nodes: FlowNode[] = [
        {
          id: "c1_a",
          type: "LABEL",
          label: "A",
          chapter: "chap1",
          dialogueCount: 1,
        },
        {
          id: "c1_b",
          type: "LABEL",
          label: "B",
          chapter: "chap1",
          dialogueCount: 1,
        },
        {
          id: "c2_a",
          type: "LABEL",
          label: "C",
          chapter: "chap2",
          dialogueCount: 1,
        },
        {
          id: "c2_b",
          type: "LABEL",
          label: "D",
          chapter: "chap2",
          dialogueCount: 1,
        },
      ];
      const edges: FlowEdge[] = [
        { id: "e_c1", source: "c1_a", target: "c1_b", kind: "sequence" },
        { id: "e_c2_fwd", source: "c2_a", target: "c2_b", kind: "sequence" },
        // Back edge inside chapter 2
        { id: "e_c2_back", source: "c2_b", target: "c2_a", kind: "jump" },
      ];

      const layout = applyTwoTierDagreLayout(nodes, edges, "TB");
      const c2BackEdge = layout.edges.find((e) => e.id === "e_c2_back")!;
      const c2NodeA = layout.nodes.find((n) => n.id === "c2_a")!;

      // In compound mode, the back edge gutter coordinate should be near Chapter 2's nodes,
      // not pushed all the way to Chapter 1's minX (which is far to the left)
      expect(c2BackEdge.data?.outerGutterCoord).toBeDefined();
      if (c2NodeA.parentId) {
        const parent2 = layout.nodes.find((n) => n.id === c2NodeA.parentId)!;
        expect(c2BackEdge.data!.outerGutterCoord!).toBeGreaterThanOrEqual(
          parent2.position.x - 60,
        );
      }
    });
  });
});
