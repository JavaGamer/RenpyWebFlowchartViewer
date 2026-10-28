import type { CanvasEdge, CanvasNode } from "../../domain/index.ts";
import type { AABB, SpatialItem } from "../spatialIndex.ts";

export interface LayoutResult {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  spatialItems?: SpatialItem[];
  spatialBounds?: AABB;
}

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkEdgeSection {
  id?: string;
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
  incomingShape?: string;
  outgoingShape?: string;
}

export interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: ElkEdgeSection[];
  junctionPoints?: ElkPoint[];
  layoutOptions?: Record<string, string>;
}

export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

export interface ElkInstance {
  layout(graph: ElkGraph): Promise<ElkGraph>;
}

export const PROGRESSIVE_FALLBACK_MAX_COLUMNS = 16;
export const MAX_CHAPTER_CACHE_ENTRIES = 128;

export interface CachedChapterMicroPlacement {
  width: number;
  height: number;
  childRelativePositions: Map<
    string,
    { x: number; y: number; height: number }
  >;
  relativeEdgeSections?: Map<
    string,
    { sections?: ElkEdgeSection[]; junctionPoints?: ElkPoint[] }
  >;
}
