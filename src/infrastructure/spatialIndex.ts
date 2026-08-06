import type { CanvasNode } from "../domain/index.ts";

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialItem {
  id: string;
  bounds: AABB;
}

export class SpatialQuadtree {
  private readonly bounds: AABB;
  private readonly maxItems: number;
  private readonly maxDepth: number;
  private readonly depth: number;
  private items: SpatialItem[] = [];
  private children: SpatialQuadtree[] | null = null;

  constructor(bounds: AABB, maxItems = 16, maxDepth = 8, depth = 0) {
    this.bounds = bounds;
    this.maxItems = maxItems;
    this.maxDepth = maxDepth;
    this.depth = depth;
  }

  public insert(item: SpatialItem): void {
    if (!this.intersects(this.bounds, item.bounds)) {
      return;
    }

    if (this.children) {
      for (const child of this.children) {
        child.insert(item);
      }
      return;
    }

    this.items.push(item);

    if (this.items.length > this.maxItems && this.depth < this.maxDepth) {
      this.subdivide();
      for (const existingItem of this.items) {
        for (const child of this.children!) {
          child.insert(existingItem);
        }
      }
      this.items = [];
    }
  }

  public queryRange(
    range: AABB,
    resultSet: Set<string> = new Set(),
  ): Set<string> {
    if (!this.intersects(this.bounds, range)) {
      return resultSet;
    }

    for (const item of this.items) {
      if (this.intersects(item.bounds, range)) {
        resultSet.add(item.id);
      }
    }

    if (this.children) {
      for (const child of this.children) {
        child.queryRange(range, resultSet);
      }
    }

    return resultSet;
  }

  private subdivide(): void {
    const { minX, minY, maxX, maxY } = this.bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    this.children = [
      new SpatialQuadtree(
        { minX, minY, maxX: midX, maxY: midY },
        this.maxItems,
        this.maxDepth,
        this.depth + 1,
      ),
      new SpatialQuadtree(
        { minX: midX, minY, maxX, maxY: midY },
        this.maxItems,
        this.maxDepth,
        this.depth + 1,
      ),
      new SpatialQuadtree(
        { minX, minY: midY, maxX: midX, maxY },
        this.maxItems,
        this.maxDepth,
        this.depth + 1,
      ),
      new SpatialQuadtree(
        { minX: midX, minY: midY, maxX, maxY },
        this.maxItems,
        this.maxDepth,
        this.depth + 1,
      ),
    ];
  }

  private intersects(a: AABB, b: AABB): boolean {
    return (
      a.minX <= b.maxX &&
      a.maxX >= b.minX &&
      a.minY <= b.maxY &&
      a.maxY >= b.minY
    );
  }
}

export function createSpatialIndex(nodes: CanvasNode[]): SpatialQuadtree {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const items: SpatialItem[] = [];

  for (const node of nodes) {
    const x = node.position.x;
    const y = node.position.y;
    const width = node.measured?.width ?? node.width ?? 220;
    const height = node.measured?.height ?? node.height ?? 120;

    const bounds: AABB = {
      minX: x,
      minY: y,
      maxX: x + width,
      maxY: y + height,
    };

    items.push({ id: node.id, bounds });

    if (bounds.minX < minX) minX = bounds.minX;
    if (bounds.minY < minY) minY = bounds.minY;
    if (bounds.maxX > maxX) maxX = bounds.maxX;
    if (bounds.maxY > maxY) maxY = bounds.maxY;
  }

  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 1000;
    maxY = 1000;
  }

  const quadtree = new SpatialQuadtree({ minX, minY, maxX, maxY });
  for (const item of items) {
    quadtree.insert(item);
  }

  return quadtree;
}
