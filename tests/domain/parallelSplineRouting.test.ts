import { describe, expect, it } from "vitest";
import {
  calculateObstructedForwardSpline,
  calculateParallelForwardSpline,
} from "../../src/domain/splineRouting.ts";
import { applyElkLayout } from "../../src/infrastructure/layoutEngines.ts";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";

describe("calculateParallelForwardSpline", () => {
  it("returns fallback bezier when parallelCount <= 1", () => {
    const res = calculateParallelForwardSpline({
      sourceX: 100,
      sourceY: 50,
      targetX: 100,
      targetY: 250,
      direction: "TB",
      parallelIndex: 0,
      parallelCount: 1,
    });

    expect(res.path).toContain("M 100 50 C 100 150, 100 150, 100 250");
    expect(res.labelX).toBe(100);
    expect(res.labelY).toBe(150);
  });

  it("symmetrically separates two parallel edges in TB direction", () => {
    const edge0 = calculateParallelForwardSpline({
      sourceX: 100,
      sourceY: 50,
      targetX: 100,
      targetY: 250,
      direction: "TB",
      parallelIndex: 0,
      parallelCount: 2,
    });

    const edge1 = calculateParallelForwardSpline({
      sourceX: 100,
      sourceY: 50,
      targetX: 100,
      targetY: 250,
      direction: "TB",
      parallelIndex: 1,
      parallelCount: 2,
    });

    expect(edge0.labelX).toBeLessThan(100);
    expect(edge1.labelX).toBeGreaterThan(100);
    expect(Math.abs(edge0.labelX - 100)).toBeCloseTo(
      Math.abs(edge1.labelX - 100),
      1,
    );
  });

  it("symmetrically separates two parallel edges in LR direction", () => {
    const edge0 = calculateParallelForwardSpline({
      sourceX: 50,
      sourceY: 100,
      targetX: 250,
      targetY: 100,
      direction: "LR",
      parallelIndex: 0,
      parallelCount: 2,
    });

    const edge1 = calculateParallelForwardSpline({
      sourceX: 50,
      sourceY: 100,
      targetX: 250,
      targetY: 100,
      direction: "LR",
      parallelIndex: 1,
      parallelCount: 2,
    });

    expect(edge0.labelY).toBeLessThan(100);
    expect(edge1.labelY).toBeGreaterThan(100);
  });
});

describe("calculateObstructedForwardSpline", () => {
  it("returns null in clean story graphs to let standard layered layout position edges", () => {
    const res = calculateObstructedForwardSpline({
      sourceX: 134,
      sourceY: 300,
      targetX: 207,
      targetY: 380,
      direction: "TB",
      obstacles: [
        { id: "obs_1", x: 97, y: 380, width: 220, height: 90 },
      ],
    });
    expect(res).toBeNull();
  });

  it("uses calculateParallelForwardSpline in applyElkLayout so parallel forward menu choices bow apart and stagger labels", async () => {
    const nodes: FlowNode[] = [
      {
        id: "menu_1",
        type: "MENU",
        label: "Choice Hub",
        dialogueCount: 0,
        chapter: "ch1",
      },
      {
        id: "after_choice",
        type: "LABEL",
        label: "after_choice",
        dialogueCount: 2,
        chapter: "ch1",
      },
    ];
    const edges: FlowEdge[] = [
      {
        id: "seq_menu_1__after_choice_Yes",
        source: "menu_1",
        target: "after_choice",
        kind: "sequence",
        label: "Yes",
      },
      {
        id: "seq_menu_1__after_choice_No",
        source: "menu_1",
        target: "after_choice",
        kind: "sequence",
        label: "No",
      },
    ];

    const elkLayout = await applyElkLayout(nodes, edges, "TB", {
      enableCompoundContainers: true,
    });
    const yesEdge = elkLayout.edges.find((e) => e.data?.label === "Yes")!;
    const noEdge = elkLayout.edges.find((e) => e.data?.label === "No")!;

    expect(yesEdge.data?.parallelCount).toBe(2);
    expect(noEdge.data?.parallelCount).toBe(2);
    expect(yesEdge.data?.svgPath).toContain("C ");
    expect(noEdge.data?.svgPath).toContain("C ");
    expect(yesEdge.data?.labelPosition?.x).not.toBe(
      noEdge.data?.labelPosition?.x,
    );
    expect(yesEdge.data?.labelPosition?.y).not.toBe(
      noEdge.data?.labelPosition?.y,
    );
  });
});
