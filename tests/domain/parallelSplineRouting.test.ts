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

    // edge0 should bow left, edge1 should bow right
    expect(edge0.labelX).toBeLessThan(100);
    expect(edge1.labelX).toBeGreaterThan(100);

    // Lateral distance between labels should be at least 55px so badges never overlap
    expect(edge1.labelX - edge0.labelX).toBeGreaterThan(55);

    // Longitudinal staggering in Y
    expect(Math.abs(edge1.labelY - edge0.labelY)).toBeGreaterThan(20);
  });

  it("handles 3 parallel edges with centered edge and outer bowed edges in LR direction", () => {
    const edge0 = calculateParallelForwardSpline({
      sourceX: 50,
      sourceY: 100,
      targetX: 250,
      targetY: 100,
      direction: "LR",
      parallelIndex: 0,
      parallelCount: 3,
    });

    const edge1 = calculateParallelForwardSpline({
      sourceX: 50,
      sourceY: 100,
      targetX: 250,
      targetY: 100,
      direction: "LR",
      parallelIndex: 1,
      parallelCount: 3,
    });

    const edge2 = calculateParallelForwardSpline({
      sourceX: 50,
      sourceY: 100,
      targetX: 250,
      targetY: 100,
      direction: "LR",
      parallelIndex: 2,
      parallelCount: 3,
    });

    // edge0 bows upward (smaller Y), edge1 stays centered (Y=100), edge2 bows downward (larger Y)
    expect(edge0.labelY).toBeLessThan(100);
    expect(edge1.labelY).toBeCloseTo(100, 1);
    expect(edge2.labelY).toBeGreaterThan(100);

    // Longitudinal staggering in X
    expect(edge0.labelX).toBeLessThan(edge1.labelX);
    expect(edge1.labelX).toBeLessThan(edge2.labelX);
  });
});

describe("calculateObstructedForwardSpline", () => {
  it("returns null when no intermediate obstacle blocks the edge", () => {
    const res = calculateObstructedForwardSpline({
      sourceX: 134,
      sourceY: 300,
      targetX: 207,
      targetY: 380,
      direction: "TB",
      obstacles: [
        { id: "scene_2", x: 97, y: 380, width: 220, height: 90 },
      ],
    });
    expect(res).toBeNull();
  });

  it("routes around an intermediate rank node blocking a skip-rank TB edge", () => {
    // Matches the exact ReEyAr / branching menu layout where menu_1 (x=24..244, y=220..300)
    // connects to ending (x=24..244, y=550..640) while scene_2 sits at (x=97..317, y=380..470)
    const obstacle = { id: "scene_2", x: 97, y: 380, width: 220, height: 90 };
    const res = calculateObstructedForwardSpline({
      sourceX: 134,
      sourceY: 300,
      targetX: 134,
      targetY: 550,
      direction: "TB",
      obstacles: [obstacle],
    });

    expect(res).not.toBeNull();
    // Should detour to the left of scene_2 (x < 97 - 30)
    expect(res!.labelX).toBeLessThan(obstacle.x - 30);
    // Label Y should sit along the vertical bypass segment
    expect(res!.labelY).toBeGreaterThan(300);
    expect(res!.labelY).toBeLessThan(550);
    // Start and end bendPoints match handle coordinates
    expect(res!.bendPoints[0]).toEqual({ x: 134, y: 300 });
    expect(res!.bendPoints[res!.bendPoints.length - 1]).toEqual({
      x: 134,
      y: 550,
    });
  });

  it("routes around an intermediate rank node in LR direction", () => {
    const obstacle = { id: "scene_2", x: 380, y: 97, width: 220, height: 90 };
    const res = calculateObstructedForwardSpline({
      sourceX: 300,
      sourceY: 134,
      targetX: 680,
      targetY: 134,
      direction: "LR",
      obstacles: [obstacle],
    });

    expect(res).not.toBeNull();
    expect(res!.labelY).toBeLessThan(obstacle.y - 30);
    expect(res!.labelX).toBeGreaterThan(300);
    expect(res!.labelX).toBeLessThan(680);
  });

  it("prefers the right channel when source, obstacle, and target are collinear in TB", () => {
    const obstacle = { id: "scene_2", x: 40, y: 200, width: 220, height: 90 };
    const res = calculateObstructedForwardSpline({
      sourceX: 150,
      sourceY: 100,
      targetX: 150,
      targetY: 380,
      direction: "TB",
      obstacles: [obstacle],
    });

    expect(res).not.toBeNull();
    expect(res!.detourSide).toBe("right");
    expect(res!.labelX).toBeGreaterThan(obstacle.x + obstacle.width + 20);
  });

  it("staggers multiple skip-rank edges sharing the same detour corridor laterally and longitudinally", () => {
    const obstacle = { id: "scene_2", x: 97, y: 380, width: 220, height: 90 };
    const lane0 = calculateObstructedForwardSpline({
      sourceX: 134,
      sourceY: 300,
      targetX: 134,
      targetY: 550,
      direction: "TB",
      obstacles: [obstacle],
      laneIndex: 0,
      laneCount: 2,
      preferredSide: "left",
    });
    const lane1 = calculateObstructedForwardSpline({
      sourceX: 134,
      sourceY: 300,
      targetX: 134,
      targetY: 550,
      direction: "TB",
      obstacles: [obstacle],
      laneIndex: 1,
      laneCount: 2,
      preferredSide: "left",
    });

    expect(lane0).not.toBeNull();
    expect(lane1).not.toBeNull();
    // Lane 1 detours further left than Lane 0
    expect(lane1!.labelX).toBeLessThan(lane0!.labelX - 15);
    // Longitudinal staggering along Y prevents badge overlap
    expect(Math.abs(lane1!.labelY - lane0!.labelY)).toBeGreaterThan(30);
  });

  it("includes secondary obstacles hit during outward stepping in hitObstacles and ignores unchosen side obstacles (Bug R1)", () => {
    const primary = { id: "primary", x: 100, y: 220, width: 220, height: 80 };
    // Secondary obstacle sits to the left of primary and gets hit when stepping left
    const secondaryLeft = {
      id: "secondary_left",
      x: -140,
      y: 260,
      width: 220,
      height: 120,
    };
    // Far-right obstacle sits higher up (y=130) and is only on the right side
    const unchosenRight = {
      id: "unchosen_right",
      x: 340,
      y: 130,
      width: 220,
      height: 80,
    };

    const res = calculateObstructedForwardSpline({
      sourceX: 150,
      sourceY: 100,
      targetX: 150,
      targetY: 500,
      direction: "TB",
      obstacles: [primary, secondaryLeft, unchosenRight],
      preferredSide: "left",
    });

    expect(res).not.toBeNull();
    expect(res!.detourSide).toBe("left");
    const hitIds = res!.hitObstacles.map((o) => o.id);
    expect(hitIds).toContain("primary");
    expect(hitIds).toContain("secondary_left");
    expect(hitIds).not.toContain("unchosen_right");
    // Lead-out Y should be governed by primary (y = (100 + 220) / 2 = 160), not pulled up to unchosenRight (y=130 -> 115)
    expect(res!.bendPoints[1]!.y).toBe(160);
  });

  it("separates multi-lane detours across secondary obstacles and staggers lead-out/lead-in segments (Bug R2)", () => {
    const primary = { id: "primary", x: 100, y: 220, width: 220, height: 90 };
    const secondary = {
      id: "secondary",
      x: 60,
      y: 240,
      width: 220,
      height: 90,
    };

    const lane0 = calculateObstructedForwardSpline({
      sourceX: 150,
      sourceY: 100,
      targetX: 150,
      targetY: 450,
      direction: "TB",
      obstacles: [primary, secondary],
      laneIndex: 0,
      laneCount: 2,
      preferredSide: "left",
    });
    const lane1 = calculateObstructedForwardSpline({
      sourceX: 150,
      sourceY: 100,
      targetX: 150,
      targetY: 450,
      direction: "TB",
      obstacles: [primary, secondary],
      laneIndex: 1,
      laneCount: 2,
      preferredSide: "left",
    });

    expect(lane0).not.toBeNull();
    expect(lane1).not.toBeNull();
    // Both lanes must clear secondary (left edge 60) by effectiveClearance (44 and 72) and stay separated by laneStep (28px)
    expect(lane0!.labelX).toBe(16);
    expect(lane1!.labelX).toBe(-12);
    // Lead-out Y and lead-in Y are staggered between lane 0 and lane 1
    expect(lane0!.bendPoints[1]!.y).not.toBe(lane1!.bendPoints[1]!.y);
    expect(lane0!.bendPoints[3]!.y).not.toBe(lane1!.bendPoints[3]!.y);
  });

  it("allows left and top detours into negative canvas coordinates when that side is shorter (Bug N5)", () => {
    // Obstacle near x=0 where left detour goes negative (0 - 44 = -44)
    const obstacleTB = { id: "obs_tb", x: 0, y: 200, width: 220, height: 80 };
    const resTB = calculateObstructedForwardSpline({
      sourceX: 40,
      sourceY: 100,
      targetX: 40,
      targetY: 380,
      direction: "TB",
      obstacles: [obstacleTB],
    });
    expect(resTB).not.toBeNull();
    expect(resTB!.detourSide).toBe("left");
    expect(resTB!.labelX).toBe(-44);

    // Obstacle near y=0 in LR mode where top detour goes negative (0 - 44 = -44)
    const obstacleLR = { id: "obs_lr", x: 200, y: 0, width: 220, height: 80 };
    const resLR = calculateObstructedForwardSpline({
      sourceX: 100,
      sourceY: 20,
      targetX: 500,
      targetY: 20,
      direction: "LR",
      obstacles: [obstacleLR],
    });
    expect(resLR).not.toBeNull();
    expect(resLR!.detourSide).toBe("top");
    expect(resLR!.labelY).toBe(-44);
  });

  it("uses calculateParallelForwardSpline in applyElkLayout so parallel forward menu choices bow apart and stagger labels", async () => {
    const nodes: FlowNode[] = [
      {
        id: "menu_1",
        type: "MENU",
        label: "Choice Menu",
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
