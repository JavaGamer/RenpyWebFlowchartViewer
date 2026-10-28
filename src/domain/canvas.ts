import type {
  CallContext,
  EdgeKind,
  FlowEdge,
  FlowNode,
  NodeType,
} from "./graph.ts";

export type CanvasStyle = Record<string, string | number | undefined>;
export type CanvasPosition = "top" | "bottom" | "left" | "right";
export interface CanvasEdgeMarker {
  type: string;
  color?: string;
  width?: number;
  height?: number;
  markerUnits?: string;
  orient?: string;
  strokeWidth?: number;
}

export interface NodeData extends Record<string, unknown> {
  label: string;
  displayLabel?: string;
  dialogueCount: number;
  wordCount?: number;
  pauseDuration?: number;
  dialogueLines?: string[];
  dialogueLineNums?: number[];
  audioAssetCues?: FlowNode["audioAssetCues"];
  nodeType: NodeType;
  chapter?: string;
  parentLabelId?: string;
  role?: FlowNode["role"];
  isShadowed?: boolean;
  shadowOfId?: string;
  isTerminalOutcome?: boolean;
  conditionExpression?: string;
  conditionReferences?: string[];
  theme?: ThemeName;
  collapsedLabels?: string[];
  collapsedNodeIds?: string[];
  isOrphan?: boolean;
  characterDialogue?: FlowNode["characterDialogue"];
  isRouteHighlighted?: boolean;
  isRouteDimmed?: boolean;
  routeStepIndex?: number;
  isChapterContainer?: boolean;
  isCollapsed?: boolean;
  chapterNodeCount?: number;
  chapterTotalDialogueCount?: number;
  chapterTotalWordCount?: number;
  chapterTotalPauseDuration?: number;
  chapterSearchMatchCount?: number;
  containsActiveRoute?: boolean;
  mutations?: FlowNode["mutations"];
}

export interface EdgeData extends Record<string, unknown> {
  label: string;
  displayLabel?: string;
  kind?: "sequence" | "jump" | "call" | "call_return" | "fallthrough";
  condition?: FlowEdge["condition"];
  timeout?: FlowEdge["timeout"];
  conditionState?: ConditionReachability;
  callContext?: CallContext;
  isBackEdge?: boolean;
  isSelfLoop?: boolean;
  isLongSkip?: boolean;
  isFallthrough?: boolean;
  isLeft?: boolean;
  outerGutterCoord?: number;
  laneIndex?: number;
  parallelIndex?: number;
  parallelCount?: number;
  detourLaneIndex?: number;
  detourLaneCount?: number;
  detourSide?: "left" | "right" | "top" | "bottom";
  obstacles?: Array<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  svgPath?: string;
  labelPosition?: { x: number; y: number };
  bendPoints?: Array<{ x: number; y: number }>;
  routePoints?: Array<{ x: number; y: number }>;
  sections?: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}

export interface CanvasNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: NodeData;
  style?: CanvasStyle;
  className?: string;
  sourcePosition?: CanvasPosition;
  targetPosition?: CanvasPosition;
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
  style?: CanvasStyle;
  animated?: boolean;
  hidden?: boolean;
  deletable?: boolean;
  selectable?: boolean;
  data?: EdgeData;
  className?: string;
  sourceNode?: CanvasNode;
  targetNode?: CanvasNode;
  selected?: boolean;
  markerStart?: string | CanvasEdgeMarker;
  markerEnd?: string | CanvasEdgeMarker;
  zIndex?: number;
  ariaLabel?: string;
  interactionWidth?: number;
  focusable?: boolean;
}

export type EdgeKindFilter = EdgeKind;
export type ConditionReachability = "reachable" | "unreachable" | "unknown";
export type ConditionVisibilityMode = "fade" | "hide";

export type ThemeName = "violet" | "highContrast" | "colorblind" | "dark";
export type LayoutDirection = "TB" | "LR";
export type LayoutDensity = "compact" | "normal" | "spacious";
