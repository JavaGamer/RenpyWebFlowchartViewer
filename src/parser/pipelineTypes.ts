import type {
  CallArgument,
  ConditionBranchKind as DomainConditionBranchKind,
  ConditionMetadata,
  EdgeKind,
  FlowAsset,
  FlowEdge,
  FlowNode,
  LanguageTranslationData,
  MutationOperator,
  ProjectTranslations,
  SourceLocation,
  VariableMutation,
} from "../domain/index.ts";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TokenTree } from "@renpy/ast/out/tokenizer/token-definitions.js";
import type { ParserVariant, ScreenActionRule } from "../config/parserRules.ts";
import type { MultiDirectedGraph } from "graphology";

export type { EdgeKind, FlowEdge, FlowNode, TextDocument, TokenTree };
export type ConditionalBranchKind = DomainConditionBranchKind;

export interface PendingCallReturn {
  returnTargetId: string;
  callTargetId: string;
  callEdgeId: string;
  callContextId: string;
  arguments?: CallArgument[];
}

export interface DynamicJumpRule {
  expressionPattern: string | RegExp;
  targets:
    | string[]
    | ((expression: string, state: ParseGraphState) => string[]);
}

export interface ExtractedScreenActionExpression {
  expression: string;
  timeout?: FlowEdge["timeout"];
}

export interface PendingConditionalHeader {
  kind: ConditionalBranchKind;
  indent: number;
  expression: string | null;
  sourceLocation?: SourceLocation;
}

export interface ConditionalDecisionContext {
  indent: number;
  decisionNodeId: string;
  sourceId: string | null;
  branchKind: ConditionalBranchKind;
  expression: string | null;
  references: string[];
  sourceLocation?: SourceLocation;
}

export interface ParseDiagnosticLocation {
  chapter?: string;
  construct?: string;
  sourceId?: string;
  targetId?: string;
  edgeId?: string;
  targetExpression?: string;
  sourceLocation?: SourceLocation;
}

export interface ParseDiagnosticContext {
  category?:
    | "invalid_node"
    | "duplicate_node"
    | "missing_edge_source"
    | "missing_edge_target"
    | "invalid_edge_kind"
    | "duplicate_semantic_edge"
    | "shadowed_label"
    | "shadowed_target_resolution"
    | "unreachable_label"
    | "infinite_loop"
    | "missing_return"
    | "uncalled_return"
    | "dead_branch"
    | "dead_menu_option"
    | "missing_asset"
    | "dangling_stack"
    | "call_cycle_deadlock"
    | "unused_variable"
    | "undeclared_variable"
    | "excessive_call_depth";
  detail?: string;
}

interface ParseDiagnosticBase {
  severity: "warning" | "error";
  message: string;
  location?: ParseDiagnosticLocation;
  context?: ParseDiagnosticContext;
  recoveryAction?: string;
}

export interface DynamicTargetParseDiagnostic extends ParseDiagnosticBase {
  code: "dynamic_target";
  location: {
    chapter: string;
    construct: string;
    targetExpression: string;
    sourceId?: string;
  };
}

export interface NormalizationParseDiagnostic extends ParseDiagnosticBase {
  code: "normalization";
  context: {
    category:
      | "invalid_node"
      | "duplicate_node"
      | "missing_edge_source"
      | "missing_edge_target"
      | "invalid_edge_kind"
      | "duplicate_semantic_edge"
      | "shadowed_label"
      | "shadowed_target_resolution"
      | "unreachable_label"
      | "infinite_loop"
      | "missing_return"
      | "uncalled_return"
      | "dead_branch"
      | "dead_menu_option"
      | "missing_asset"
      | "dangling_stack"
      | "call_cycle_deadlock"
      | "unused_variable"
      | "undeclared_variable"
      | "excessive_call_depth";
    detail?: string;
  };
}

export interface ShadowedLabelParseDiagnostic extends ParseDiagnosticBase {
  code: "shadowed_label";
}

export interface UnresolvedTargetParseDiagnostic extends ParseDiagnosticBase {
  code: "unresolved_target";
  location: {
    edgeId: string;
    sourceId: string;
    targetId: string;
  };
}

export interface MissingAssetParseDiagnostic extends ParseDiagnosticBase {
  code: "missing_asset";
  location?: ParseDiagnosticLocation;
}

export type ParseDiagnostic =
  | DynamicTargetParseDiagnostic
  | NormalizationParseDiagnostic
  | UnresolvedTargetParseDiagnostic
  | ShadowedLabelParseDiagnostic
  | MissingAssetParseDiagnostic;

export type VariableValue = string | boolean | number | null;

export interface InitVariableDescriptor {
  name: string;
  rawExpression: string;
  value: VariableValue | Map<string, string> | string[];
  kind: "define" | "default" | "python" | "persistent";
  priority: number;
  filePath: string;
  lineIndex: number;
  isPersistent: boolean;
}

export type {
  LanguageTranslationData,
  MutationOperator,
  ProjectTranslations,
  VariableMutation,
};

export interface ScreenActionTarget {
  construct:
    | "jump"
    | "call"
    | "set_variable"
    | "toggle_variable"
    | "show_menu"
    | "return"
    | "null_action";
  targetExpression: string;
  target?: string;
  caption?: string;
  timeout?: FlowEdge["timeout"];
  conditionExpression?: string;
  variableName?: string;
  variableValue?: VariableValue;
}

export interface ScreenDefinition {
  name: string;
  parameters?: string[];
  filePath: string;
  lineIndex: number;
  rawBody: string;
  actions: ScreenActionTarget[];
  hasReturnAction: boolean;
  isEngineChoiceScreen: boolean;
}

export interface PathVariableState {
  variables: Map<string, VariableValue>;
  persistent: Map<string, VariableValue>;
}

export interface ResolveTargetScanState {
  labelVariableLiteralTargets: Map<string, string>;
  labelVariableDictTargets: Map<string, Map<string, string>>;
  labelVariableListTargets: Map<string, string[]>;
  persistentTargets?: Map<string, string>;
}

export interface ParseScanState extends ResolveTargetScanState {
  currentLabelId: string | null;
  currentLabelIndent: number | null;
  currentLabelDeclaredName?: string | null;
  currentLabelBaseId?: string | null;
  currentLabelSceneIndex?: number;
  currentLabelHasSplit?: boolean;
  currentLabelHasContentSinceSceneBoundary?: boolean;
  currentSceneDialogueCount?: number;
  currentLabelStartLoc?: SourceLocation | null;
  currentLabelEndLoc?: SourceLocation | null;
  currentMenuStartLoc?: SourceLocation | null;
  menuStack: Array<{
    id: string;
    optionText: string | null;
    activeOptionCondition?: ConditionMetadata;
    options?: Array<{
      text: string;
      hasExit: boolean;
      condition?: ConditionMetadata;
    }>;
    sourceLocation?: SourceLocation;
  }>;
  pendingMenuFallthroughIds: string[];
  conditionalIndentStack: number[];
  pendingConditionalHeader: PendingConditionalHeader | null;
  conditionalDecisionStack: ConditionalDecisionContext[];
  labelHasExplicitExit: boolean;
  waitForLabelName: boolean;
  waitForJumpTarget: boolean;
  waitForJumpExpressionTarget: boolean;
  waitForCallTarget: boolean;
  waitForCallExpressionTarget?: boolean;
  waitForMenuNameForId: string | null;
  lastConditionalLine?: number;
  lastProcessedCustomLineNum?: number;
  currentPathState?: PathVariableState;
}

export interface ParseGraphState {
  graph: MultiDirectedGraph<FlowNode, FlowEdge>;
  nodes: FlowNode[];
  edges: FlowEdge[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  nodeMap: Map<string, FlowNode>;
  edgeMap: Map<string, FlowEdge>;
  pendingGraphEdgeIds: Set<string>;
  menuCounter: number;
  decisionCounter: number;
  allLabelIds: Set<string>;
  incomingByLabel: Map<string, Set<EdgeKind>>;
  outgoingByLabel: Map<string, Set<EdgeKind>>;
  hasReturnInLabel: Set<string>;
  hasReliableReturnInLabel: Set<string>;
  calledLabels: Set<string>;
  calledFromMenuOptionTargets: Set<string>;
  pendingCallReturns: PendingCallReturn[];
  canonicalLabelIdByName: Map<string, string>;
  labelDefinitionCountByName: Map<string, number>;
  labelsByChapter: Map<string, Map<string, string>>;
  globalLabelVariableLiteralTargets: Map<string, string>;
  globalLabelVariableDictTargets: Map<string, Map<string, string>>;
  globalLabelVariableListTargets: Map<string, string[]>;
  globalPersistentVariables?: Map<string, VariableValue>;
  initVariables?: Map<string, InitVariableDescriptor>;
  imageDefinitions?: Map<string, string>;
  nodeMutations?: Map<string, VariableMutation[]>;
  globalScreens: Set<string>;
  globalCharacters: Set<string>;
  diagnostics: ParseDiagnostic[];
  diagnosticIds: Set<string>;
  assets?: FlowAsset[];
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  dynamicJumpRules?: DynamicJumpRule[];
  maxCallStackDepth?: number;
  allConditionalExpressions?: Array<{
    expression: string;
    branchKind: string;
    chapter?: string;
    sourceId?: string;
    sourceLocation?: SourceLocation;
  }>;
  screenDefinitions?: Map<string, ScreenDefinition>;
  translations?: ProjectTranslations;
  availableLanguages?: string[];
}

export interface ParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  assets?: FlowAsset[];
  diagnostics?: ParseDiagnostic[];
  initVariables?: Map<string, InitVariableDescriptor>;
  nodeMutations?: Map<string, VariableMutation[]>;
  screenDefinitions?: Map<string, ScreenDefinition>;
  translations?: ProjectTranslations;
  availableLanguages?: string[];
}

export interface ParseProgress {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
}

export interface ParseInputFile {
  name: string;
  content: string | Uint8Array;
  relativePath?: string;
}

export interface ParseOptions {
  onProgress?: (progress: ParseProgress) => void;
  maxParallelFiles?: number;
  tokenizedCache?: Map<
    string,
    { chapter?: string; document: TextDocument; tokenTree: TokenTree }
  >;
  fileCacheKeys?: string[];
  captureDialogueLines?: boolean;
  deferDetails?: boolean;
  parserVariant?: ParserVariant;
  screenActionRules?: ScreenActionRule[];
  dynamicJumpRules?: DynamicJumpRule[];
  sceneSplitDialogueThreshold?: number;
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  maxCallStackDepth?: number;
  signal?: AbortSignal;
}

export interface TokenMetaFlags {
  menuDepth: number;
  hasLabelStatement: boolean;
  hasMenuStatement: boolean;
  hasMenuBlock: boolean;
  hasMenuOption: boolean;
  hasMenuOptionBlock: boolean;
  hasJumpStatement: boolean;
  hasCallStatement: boolean;
  hasPythonBlock: boolean;
  hasScreenBlock: boolean;
  hasSayNarrator: boolean;
  hasSayCharacter: boolean;
  hasSayStatement: boolean;
}
