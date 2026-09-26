import { describe, expect, it } from "vitest";
import {
  calculateObstructedForwardSpline,
  calculateParallelForwardSpline,
} from "../../src/domain/splineRouting.ts";

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
});
