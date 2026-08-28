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
  LanguageTranslationData,
  MutationOperator,
  ProjectTranslations,
  SourceLocation,
  SourcePosition,
  VariableMutation,
} from "./graph.ts";

export type {
  CanvasEdge,
  CanvasNode,
  ChapterNodeType,
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

export { Position } from "@xyflow/react";

export {
  buildConditionalVisibility,
  buildVisibleEdges,
  buildVisibleNodes,
  CHAPTER_CONTAINER_PADDING,
  CHAPTER_HEADER_HEIGHT,
  CHAPTER_NODE_PREFIX,
  CHAPTER_SUMMARY_HEIGHT,
  CHAPTER_SUMMARY_WIDTH,
  type ChapterAggregates,
  type ClusterBoundingBox,
  computeChapterAggregates,
  computeClusterBoundingBox,
  extractChapterName,
  getChapterId,
  getLabelHeight,
  getNodeCenter,
  getNodeHeight,
  type GraphSimplificationOptions,
  groupNodesByChapter,
  isChapterId,
  NODE_HEIGHT_DECISION,
  NODE_HEIGHT_LABEL,
  NODE_HEIGHT_MENU,
  NODE_WIDTH,
  normalizeChildPosition,
  PROGRESSIVE_LAYOUT_NODE_LIMIT,
  redirectEdgesForCollapsedChapters,
  resolveGraphIntegrity,
  simplifyGraph,
} from "./transforms/index.ts";

export {
  evaluatePythonAstExpression,
  extractDictLiteral,
  extractListLiteral,
  extractNodeText,
  extractStringLiteral,
  parsePythonBlock,
  unquoteString,
} from "./pythonAstEvaluator.ts";
export type {
  PythonAssignment,
  PythonAstEvaluationResult,
  PythonDirectCall,
  PythonParsedBlock,
} from "./pythonAstEvaluator.ts";

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

export { compareDeterministicStrings, compareFiles } from "./sortUtils.ts";

export { createPerfTracker } from "./perf.ts";
export type { PerfEvent, PerfTrackerOptions } from "./perf.ts";

export type {
  ChapterPacingStats,
  CharacterPacingStats,
  EndingSummary,
  EndingType,
  HighlightedRoute,
  MonologueSection,
  PointOfNoReturn,
  ProjectNarrativeReport,
  RouteChoiceStep,
  StoryRoute,
} from "./analytics.ts";

export type {
  RouteSolverHeuristic,
  RouteSolverOptions,
  SolvedStep,
  SolvedStepType,
  SolvedWalkthrough,
} from "./analytics/index.ts";

export {
  classifyEndingTypeHeuristic,
  computeChapterPacing,
  computeCharacterDistribution,
  computeMonologueSections,
  computeReverseReachability,
  discoverTerminalEndings,
  enumerateStoryRoutes,
  generateProjectNarrativeReport,
  identifyPointsOfNoReturn,
  solveRouteToTarget,
} from "./analytics/index.ts";

export {
  buildFilletedOrthogonalPath,
  calculateBackEdgeSpline,
  calculateSelfLoopArc,
  detectBackEdge,
} from "./splineRouting.ts";
export type {
  BackEdgeSplineParams,
  SelfLoopArcParams,
  SplineResult,
} from "./splineRouting.ts";
