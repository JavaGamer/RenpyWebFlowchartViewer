import { describe, expect, it } from "vitest";
import {
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

    // Lateral distance between labels should be at least 25px
    expect(edge1.labelX - edge0.labelX).toBeGreaterThan(25);

    // Longitudinal staggering in Y
    expect(edge0.labelY).not.toBe(edge1.labelY);
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
