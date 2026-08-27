import { describe, expect, it } from "vitest";
import {
  computeSpatialItemsAndBounds,
  createSpatialIndex,
  createSpatialIndexFromItems,
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
        data: {} as CanvasNode["data"],
      },
      {
        id: "b",
        type: "labelNode",
        position: { x: 2000, y: 2000 },
        data: {} as CanvasNode["data"],
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

  it("precomputes spatial items and bounds for fast worker hydration", () => {
    const nodes: CanvasNode[] = [
      {
        id: "node_x",
        type: "labelNode",
        position: { x: 100, y: 150 },
        width: 220,
        height: 80,
        data: {} as CanvasNode["data"],
      },
      {
        id: "node_y",
        type: "menuNode",
        position: { x: 800, y: 900 },
        width: 220,
        height: 120,
        data: {} as CanvasNode["data"],
      },
    ];

    const { items, bounds } = computeSpatialItemsAndBounds(nodes);
    expect(items.length).toBe(2);
    expect(items[0]!.id).toBe("node_x");
    expect(items[0]!.bounds.minX).toBe(100);
    expect(items[0]!.bounds.minY).toBe(150);
    expect(items[1]!.id).toBe("node_y");
    expect(bounds.minX).toBe(100);
    expect(bounds.minY).toBe(150);
    expect(bounds.maxX).toBeGreaterThanOrEqual(1020);
    expect(bounds.maxY).toBeGreaterThanOrEqual(1020);

    const hydratedIndex = createSpatialIndexFromItems(items, bounds);
    const queryResult = hydratedIndex.queryRange({
      minX: 50,
      minY: 50,
      maxX: 400,
      maxY: 400,
    });

    expect(queryResult.has("node_x")).toBe(true);
    expect(queryResult.has("node_y")).toBe(false);
  });
});
