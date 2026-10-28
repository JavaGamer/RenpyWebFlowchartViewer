import {
  type FlowEdge,
  type FlowNode,
  getNodeHeight,
  NODE_WIDTH,
} from "../../domain/index.ts";
import {
  type CachedChapterMicroPlacement,
  MAX_CHAPTER_CACHE_ENTRIES,
} from "./types.ts";

export const dagreMicroLayoutCache = new Map<
  string,
  CachedChapterMicroPlacement
>();
export const elkMicroLayoutCache = new Map<
  string,
  CachedChapterMicroPlacement
>();

export function setBoundedCacheEntry(
  cache: Map<string, CachedChapterMicroPlacement>,
  key: string,
  value: CachedChapterMicroPlacement,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= MAX_CHAPTER_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

export function getBoundedCacheEntry(
  cache: Map<string, CachedChapterMicroPlacement>,
  key: string,
): CachedChapterMicroPlacement | undefined {
  const existing = cache.get(key);
  if (existing) {
    // Refresh LRU order
    cache.delete(key);
    cache.set(key, existing);
  }
  return existing;
}

/**
 * Clears all internal per-chapter micro-layout caches (for Dagre and ELK).
 */
export function clearLayoutCaches(): void {
  dagreMicroLayoutCache.clear();
  elkMicroLayoutCache.clear();
}

export function computeChapterTopologySignature(
  cNodes: FlowNode[],
  cEdges: FlowEdge[],
): string {
  const nodeParts = cNodes.map((n) =>
    `${n.id}:${n.type}:${NODE_WIDTH}x${getNodeHeight(n)}:${n.role ?? ""}:${
      n.condition?.branchKind ?? ""
    }:${
      (n.id === "start" || n.label?.toLowerCase() === "start") ? "start" : ""
    }`
  );
  const edgeParts = cEdges.map((e) =>
    `${e.id}:${e.source}->${e.target}:${e.kind ?? ""}`
  );
  return `${nodeParts.join(",")}|${edgeParts.join(",")}`;
}
