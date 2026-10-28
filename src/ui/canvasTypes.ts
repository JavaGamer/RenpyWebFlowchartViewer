import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { EdgeData, NodeData } from "../domain/index.ts";

export type FlowchartNode = Node<NodeData>;
export type FlowchartEdge = Edge<EdgeData>;

export type LabelNodeType = FlowchartNode;
export type MenuNodeType = FlowchartNode;
export type DecisionNodeType = FlowchartNode;
export type ChapterNodeType = FlowchartNode;
export type LabeledEdgeType = FlowchartEdge;

export function toFlowchartNodes(
  nodes: import("../domain/index.ts").CanvasNode[],
): FlowchartNode[] {
  return nodes as unknown as FlowchartNode[];
}

export function toFlowchartEdges(
  edges: import("../domain/index.ts").CanvasEdge[],
): FlowchartEdge[] {
  return edges as unknown as FlowchartEdge[];
}

export interface CanvasMetrics {
  visibleNodeCount: number;
  visibleEdgeCount: number;
  dialogueLineSearchEnabled: boolean;
  isLargeExportTarget: boolean;
  /** Total word count across all parsed nodes (not affected by filters). */
  totalWordCount: number;
  /** Total pause duration across all parsed nodes (not affected by filters). */
  totalPauseDuration: number;
  /** Word count across currently visible (non-hidden, non-filtered) nodes. */
  visibleWordCount: number;
  /** Pause duration across currently visible nodes. */
  visiblePauseDuration: number;
}

export interface CanvasCallbacksRegistry {
  onSearchInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}
