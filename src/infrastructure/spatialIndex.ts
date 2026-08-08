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

  private getChildIndex(b: AABB): number {
    const midX = (this.bounds.minX + this.bounds.maxX) / 2;
    const midY = (this.bounds.minY + this.bounds.maxY) / 2;
    const top = b.maxY <= midY;
    const bottom = b.minY >= midY;
    const left = b.maxX <= midX;
    const right = b.minX >= midX;

    if (left && top) return 0;
    if (right && top) return 1;
    if (left && bottom) return 2;
    if (right && bottom) return 3;
    return -1;
  }

  public insert(item: SpatialItem): void {
    if (!this.intersects(this.bounds, item.bounds)) {
      return;
    }

    if (this.children) {
      const idx = this.getChildIndex(item.bounds);
      if (idx !== -1) {
        this.children[idx]!.insert(item);
        return;
      }
      this.items.push(item);
      return;
    }

    this.items.push(item);

    if (this.items.length > this.maxItems && this.depth < this.maxDepth) {
      const firstItem = this.items[0];
      const allIdentical = firstItem && this.items.every(
        (it) =>
          it.bounds.minX === firstItem.bounds.minX &&
          it.bounds.minY === firstItem.bounds.minY,
      );
      if (!allIdentical) {
        this.subdivide();
        const oldItems = this.items;
        this.items = [];
        for (const existingItem of oldItems) {
          const idx = this.getChildIndex(existingItem.bounds);
          if (idx !== -1) {
            this.children![idx]!.insert(existingItem);
          } else {
            this.items.push(existingItem);
          }
        }
      }
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
    const width = node.measured?.width || node.width || 220;
    const height = node.measured?.height || node.height || 120;

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
