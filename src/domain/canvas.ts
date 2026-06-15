import type { EdgeKind, FlowEdge, FlowNode } from "./graph.ts";
import type { CSSProperties } from "react";
import type { EdgeMarker, Position } from "@xyflow/react";

export interface NodeData extends Record<string, unknown> {
  label: string;
  dialogueCount: number;
  dialogueLines?: string[];
  audioAssetCues?: FlowNode["audioAssetCues"];
  nodeType: "LABEL" | "MENU" | "DECISION";
  chapter?: string;
  parentLabelId?: string;
  role?: FlowNode["role"];
  isShadowed?: boolean;
  shadowOfId?: string;
  isTerminalOutcome?: boolean;
  conditionExpression?: string;
  conditionReferences?: string[];
  theme?: ThemeName;
}

export interface EdgeData extends Record<string, unknown> {
  label: string;
  kind?: "sequence" | "jump" | "call" | "call_return";
  condition?: FlowEdge["condition"];
  timeout?: FlowEdge["timeout"];
  conditionState?: ConditionReachability;
}

export interface CanvasNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: NodeData;
  style?: CSSProperties;
  className?: string;
  sourcePosition?: Position;
  targetPosition?: Position;
  hidden?: boolean;
  selected?: boolean;
  dragging?: boolean;
  draggable?: boolean;
  selectable?: boolean;
  connectable?: boolean;
  deletable?: boolean;
  dragHandle?: string;
  width?: number;
  height?: number;
  parentId?: string;
  extent?: "parent" | [[number, number], [number, number]];
  expandParent?: boolean;
  ariaLabel?: string;
  focusable?: boolean;
  measured?: {
    width?: number;
    height?: number;
  };
}

export interface CanvasEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  style?: CSSProperties;
  animated?: boolean;
  hidden?: boolean;
  deletable?: boolean;
  selectable?: boolean;
  data?: EdgeData;
  className?: string;
  sourceNode?: CanvasNode;
  targetNode?: CanvasNode;
  selected?: boolean;
  markerStart?: string | EdgeMarker;
  markerEnd?: string | EdgeMarker;
  zIndex?: number;
  ariaLabel?: string;
  interactionWidth?: number;
  focusable?: boolean;
}

export type LabelNodeType = CanvasNode;
export type MenuNodeType = CanvasNode;
export type DecisionNodeType = CanvasNode;
export type LabeledEdgeType = CanvasEdge;

export type EdgeKindFilter = EdgeKind;
export type ConditionReachability = "reachable" | "unreachable" | "unknown";
export type ConditionVisibilityMode = "fade" | "hide";

export type ThemeName = "violet" | "highContrast" | "colorblind" | "dark";
export type LayoutDirection = "TB" | "LR";
export type LayoutDensity = "compact" | "normal" | "spacious";
