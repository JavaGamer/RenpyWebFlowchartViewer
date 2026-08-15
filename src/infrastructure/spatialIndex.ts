import type { CanvasNode } from "../domain/index.ts";
import { getNodeHeight } from "../domain/index.ts";

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
      this.subdivide();
      const remainingItems: SpatialItem[] = [];
      for (const it of this.items) {
        const idx = this.getChildIndex(it.bounds);
        if (idx !== -1) {
          this.children![idx]!.insert(it);
        } else {
          remainingItems.push(it);
        }
      }
      this.items = remainingItems;
    }
  }

  private subdivide(): void {
    const midX = (this.bounds.minX + this.bounds.maxX) / 2;
    const midY = (this.bounds.minY + this.bounds.maxY) / 2;

    this.children = [
      new SpatialQuadtree(
        {
          minX: this.bounds.minX,
          minY: this.bounds.minY,
          maxX: midX,
          maxY: midY,
        },
        this.maxItems,
        this.maxDepth,
        this.depth + 1,
      ),
      new SpatialQuadtree(
        {
          minX: midX,
          minY: this.bounds.minY,
          maxX: this.bounds.maxX,
          maxY: midY,
        },
        this.maxItems,
        this.maxDepth,
        this.depth + 1,
      ),
      new SpatialQuadtree(
        {
          minX: this.bounds.minX,
          minY: midY,
          maxX: midX,
          maxY: this.bounds.maxY,
        },
        this.maxItems,
        this.maxDepth,
        this.depth + 1,
      ),
      new SpatialQuadtree(
        {
          minX: midX,
          minY: midY,
          maxX: this.bounds.maxX,
          maxY: this.bounds.maxY,
        },
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

  public query(range: AABB, result: Set<string> = new Set()): Set<string> {
    if (!this.intersects(this.bounds, range)) {
      return result;
    }

    for (const item of this.items) {
      if (this.intersects(item.bounds, range)) {
        result.add(item.id);
      }
    }

    if (this.children) {
      for (const child of this.children) {
        child.query(range, result);
      }
    }

    return result;
  }

  public queryRange(range: AABB, result: Set<string> = new Set()): Set<string> {
    return this.query(range, result);
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
    const nodeData = node.data as {
      isShadowed?: boolean;
      isTerminalOutcome?: boolean;
      audioAssetCues?: unknown[];
    } | undefined;
    const height = node.measured?.height || node.height ||
      getNodeHeight({
        type: node.type === "labelNode"
          ? "LABEL"
          : node.type === "menuNode"
          ? "MENU"
          : "DECISION",
        isShadowed: nodeData?.isShadowed,
        isTerminalOutcome: nodeData?.isTerminalOutcome,
        audioAssetCues: nodeData?.audioAssetCues as
          | import("../domain/index.ts").AudioAssetCue[]
          | undefined,
      });

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
