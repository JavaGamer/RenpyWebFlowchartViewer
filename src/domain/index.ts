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
  getNodeCenter,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  simplifyGraph,
  type GraphSimplificationOptions,
  NODE_WIDTH,
  getLabelHeight,
  getNodeHeight,
  resolveGraphIntegrity,
  NODE_HEIGHT_LABEL,
  NODE_HEIGHT_MENU,
  NODE_HEIGHT_DECISION,
} from "./transforms/index.ts";

export { extractConditionFlagRefs } from "./conditionLogic.ts";

export type { MockFlagValue } from "./conditionLogic.ts";

export {
  BaseDomainError,
  FileReadError,
  UploadValidationError,
  ParseError,
  LayoutError,
} from "./errors.ts";

export { compareDeterministicStrings } from "./sortUtils.ts";
