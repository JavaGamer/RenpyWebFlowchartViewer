export type NodeType =
  | "LABEL"
  | "MENU"
  | "DECISION"
  | "SCREEN_CALL"
  | "SYNTAX_ERROR";
export type NodeRole =
  | "story"
  | "detour"
  | "utility"
  | "state_toggle"
  | "menu"
  | "decision"
  | "while_loop"
  | "for_loop"
  | "screen_call";
export type EdgeKind = "sequence" | "jump" | "call" | "call_return";
export type ConditionBranchKind = "if" | "elif" | "else" | "while" | "for";

export interface LabelParameter {
  name: string;
  defaultValue?: string;
}

export interface CallArgument {
  name?: string;
  value: string;
}

export interface ConditionMetadata {
  branchKind: ConditionBranchKind;
  expression?: string;
  references?: string[];
  decisionNodeId?: string;
}

export interface TimeoutMetadata {
  isTimeout: true;
  durationSeconds?: number;
}

export interface SourcePosition {
  /** 0-indexed line number */
  line: number;
  /** 0-indexed character offset within the line */
  character: number;
  /** 0-indexed absolute character offset from beginning of document */
  offset: number;
}

export interface SourceLocation {
  /** Chapter identifier or file path */
  file: string;
  /** Start position (inclusive) */
  start: SourcePosition;
  /** End position (exclusive) */
  end: SourcePosition;
}

export interface AudioAssetCue {
  type: "play" | "stop" | "queue" | "voice" | "scene" | "show" | "image";
  channel?: string;
  asset: string;
  raw: string;
  lineNum?: number;
  sourceLocation?: SourceLocation;
  resolvedPath?: string;
  isMissing?: boolean;
  isColor?: boolean;
}

export interface FlowAsset {
  name: string;
  type: "image" | "scene" | "audio";
  nodeIds?: string[];
}

/** A node in the flowchart graph. */
export interface FlowNode {
  id: string;
  /** 'LABEL' for `label name:` blocks; 'MENU' for `menu:` blocks. */
  type: NodeType;
  /** Strict role classification for LABEL nodes, or 'menu' for MENU nodes. */
  role?: NodeRole;
  /** Human-readable name shown in the chart. */
  label: string;
  /** Number of dialogue lines inside this block. */
  dialogueCount: number;
  /** Total word count from dialogue lines in this block. */
  wordCount?: number;
  /** Total pause duration in seconds from explicit Ren'Py pause tags (e.g. {w=2.5}). */
  pauseDuration?: number;
  /** Dialogue line text captured from say statements in this block. */
  dialogueLines?: string[];
  /** Optional audio and asset cues parsed in this block. */
  audioAssetCues?: AudioAssetCue[];
  /** Source chapter inferred from the .rpy filename. */
  chapter?: string;
  /** Parent label id for MENU nodes. */
  parentLabelId?: string;
  /** Optional condition metadata (primarily for DECISION nodes). */
  condition?: ConditionMetadata;
  /** True when this label is a non-canonical duplicate definition. */
  isShadowed?: boolean;
  /** Canonical label id that this shadowed node maps to for target resolution. */
  shadowOfId?: string;
  /** True when this label is a terminal story outcome. */
  isTerminalOutcome?: boolean;
  /** Internal line numbers of dialogue lines for sorting during parsing. */
  dialogueLineNums?: number[];
  /** Internal line number of the dialogue prompt that set this menu's label. */
  menuPromptLineNum?: number;
  /** Label names collapsed into this node during linear chain collapsing. */
  collapsedLabels?: string[];
  /** True when dialogue lines and audio asset cues have been loaded/hydrated. */
  isDetailsLoaded?: boolean;
  /** Detailed source ranges for all labels collapsed into this node. */
  collapsedLocations?: SourceLocation[];
  /** Dialogue stats grouped by character identifier. */
  characterDialogue?: Record<string, { lineCount: number; wordCount: number }>;
  /** True when this node is unreachable from entry points. */
  isOrphan?: boolean;
  /** Primary source location mapping for this node. */
  sourceLocation?: SourceLocation;
  /** Declared parameters for parameterized label definitions. */
  parameters?: LabelParameter[];
}

export interface CallContext {
  callContextId: string;
  callEdgeId: string;
  callSiteId: string;
  returnTargetId: string;
  arguments?: CallArgument[];
}

/** A directed edge in the flowchart graph. */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Edge semantics used by viewer toggles/export. */
  kind?: EdgeKind;
  /** Optional label shown on the edge (e.g. menu option text). */
  label?: string;
  /** Optional condition metadata for branches sourced from DECISION nodes. */
  condition?: ConditionMetadata;
  /** Optional timeout metadata for timer-driven navigation edges. */
  timeout?: TimeoutMetadata;
  /** True when static path evaluation proves this condition branch is unreachable. */
  conditionIsStaticallyFalse?: boolean;
  /** Primary source location mapping for this edge statement (jump/call/choice). */
  sourceLocation?: SourceLocation;
  /** Passed arguments for call statements. */
  arguments?: CallArgument[];
  /** Context tagging linking call and call_return edges to their origin stack frame. */
  callContext?: CallContext;
}
