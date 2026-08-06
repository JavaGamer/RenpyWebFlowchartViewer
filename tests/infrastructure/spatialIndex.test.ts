import { describe, expect, it } from "vitest";
import {
  createSpatialIndex,
  SpatialQuadtree,
} from "../../src/infrastructure/index.ts";
import type { CanvasNode } from "../../src/domain/index.ts";

describe("SpatialQuadtree Viewport Virtualization", () => {
  it("inserts and queries nodes within spatial bounding box", () => {
    const quadtree = new SpatialQuadtree({
      minX: 0,
      minY: 0,
      maxX: 1000,
      maxY: 1000,
    });

    quadtree.insert({
      id: "node1",
      bounds: { minX: 10, minY: 10, maxX: 100, maxY: 100 },
    });
    quadtree.insert({
      id: "node2",
      bounds: { minX: 500, minY: 500, maxX: 600, maxY: 600 },
    });

    const results = quadtree.queryRange({
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 200,
    });

    expect(results.has("node1")).toBe(true);
    expect(results.has("node2")).toBe(false);
  });

  it("creates spatial index from CanvasNode array and queries viewport range", () => {
    const nodes: CanvasNode[] = [
      {
        id: "a",
        type: "labelNode",
        position: { x: 50, y: 50 },
        data: {} as any,
      },
      {
        id: "b",
        type: "labelNode",
        position: { x: 2000, y: 2000 },
        data: {} as any,
      },
    ];

    const index = createSpatialIndex(nodes);
    const visibleInViewport = index.queryRange({
      minX: 0,
      minY: 0,
      maxX: 500,
      maxY: 500,
    });

    expect(visibleInViewport.has("a")).toBe(true);
    expect(visibleInViewport.has("b")).toBe(false);
  });
});
