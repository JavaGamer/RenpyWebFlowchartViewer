export type {
  ConditionMetadata,
  EdgeKind,
  FlowEdge,
  FlowNode,
} from "./graph.ts";

export type {
  CanvasEdge,
  CanvasNode,
  ConditionReachability,
  ConditionVisibilityMode,
  DecisionNodeType,
  EdgeData,
  EdgeKindFilter,
  LabeledEdgeType,
  LabelNodeType,
  LayoutDensity,
  LayoutDirection,
  MenuNodeType,
  NodeData,
  ThemeName,
} from "./canvas.ts";

export {
  buildConditionalVisibility,
  buildVisibleEdges,
  buildVisibleNodes,
  findPath,
  getLabelHeight,
  getNodeCenter,
  getNodeHeight,
  type GraphSimplificationOptions,
  NODE_HEIGHT_DECISION,
  NODE_HEIGHT_LABEL,
  NODE_HEIGHT_MENU,
  NODE_WIDTH,
  type PathResult,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  resolveGraphIntegrity,
  simplifyGraph,
} from "./transforms/index.ts";

export { extractConditionFlagRefs } from "./conditionLogic.ts";

export type { MockFlagValue } from "./conditionLogic.ts";

export {
  BaseDomainError,
  FileReadError,
  LayoutError,
  ParseError,
  UploadValidationError,
} from "./errors.ts";

export { compareDeterministicStrings } from "./sortUtils.ts";

export { createPerfTracker } from "./perf.ts";
export type { PerfEvent, PerfTrackerOptions } from "./perf.ts";
