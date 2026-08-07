export type {
  AudioAssetCue,
  CallArgument,
  CallContext,
  ConditionBranchKind,
  ConditionMetadata,
  EdgeKind,
  FlowAsset,
  FlowEdge,
  FlowNode,
  LabelParameter,
  SourceLocation,
  SourcePosition,
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
  getLabelHeight,
  getNodeCenter,
  getNodeHeight,
  type GraphSimplificationOptions,
  NODE_HEIGHT_DECISION,
  NODE_HEIGHT_LABEL,
  NODE_HEIGHT_MENU,
  NODE_WIDTH,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  resolveGraphIntegrity,
  simplifyGraph,
} from "./transforms/index.ts";

export {
  buildMockFlagsFromVariableState,
  evaluateConditionExpression,
  extractConditionFlagRefs,
} from "./conditionLogic.ts";

export type {
  ConditionEvaluationResult,
  MockFlagValue,
} from "./conditionLogic.ts";

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
