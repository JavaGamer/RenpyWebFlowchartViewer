/**
 * src/parser/ast/types.ts
 *
 * Concrete TypeScript AST interfaces and token definitions
 * for Ren'Py scripts.
 */

// ============================================================================
// Source Locations & Positions
// ============================================================================

export interface AstPosition {
  /** 0-indexed line number */
  line: number;
  /** 0-indexed column offset */
  column: number;
  /** 0-indexed character offset from document start */
  offset: number;
}

export interface AstSourceLocation {
  file: string;
  start: AstPosition;
  end: AstPosition;
}

// ============================================================================
// Token Definitions for the Indentation Lexer
// ============================================================================

export type TokenType =
  | "INDENT"
  | "DEDENT"
  | "NEWLINE"
  | "EOF"
  // Keywords
  | "LABEL"
  | "MENU"
  | "JUMP"
  | "CALL"
  | "RETURN"
  | "IF"
  | "ELIF"
  | "ELSE"
  | "WHILE"
  | "SCREEN"
  | "INIT"
  | "PYTHON"
  | "PASS"
  | "SCENE"
  | "SHOW"
  | "HIDE"
  | "PLAY"
  | "STOP"
  | "QUEUE"
  | "VOICE"
  // Literals & Identifiers
  | "IDENTIFIER"
  | "STRING"
  | "NUMBER"
  // Symbols
  | "COLON"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "COMMA"
  | "DOT"
  | "EQUALS"
  | "DOLLAR"
  // Special/Raw
  | "RAW_TEXT";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  offset: number;
  endOffset: number;
}

// ============================================================================
// Root Script AST
// ============================================================================

export interface RenpyScriptAst {
  file: string;
  statements: TopLevelStatementAst[];
}

export type TopLevelStatementAst =
  | LabelStatementAst
  | ScreenStatementAst
  | InitStatementAst
  | PythonBlockAst;

// ============================================================================
// Label & Top-Level Statements
// ============================================================================

export interface LabelParameterAst {
  name: string;
  defaultValue?: string;
}

export interface LabelStatementAst {
  kind: "label";
  name: string;
  /** Fully qualified canonical name (e.g. "chapter1.choice_a" for local labels) */
  canonicalName: string;
  isLocal: boolean;
  parameters?: LabelParameterAst[];
  body: StatementAst[];
  sourceLocation: AstSourceLocation;
}

// ============================================================================
// Statement ASTs Inside Blocks
// ============================================================================

export type StatementAst =
  | SayStatementAst
  | MenuStatementAst
  | JumpStatementAst
  | CallStatementAst
  | ReturnStatementAst
  | IfStatementAst
  | WhileStatementAst
  | PythonStatementAst
  | CallScreenStatementAst
  | AssetCueStatementAst
  | PassStatementAst;

export interface SayStatementAst {
  kind: "say";
  character?: string;
  text: string;
  attributes?: string[];
  pauseDuration?: number;
  sourceLocation: AstSourceLocation;
}

export interface MenuItemAst {
  text: string;
  condition?: string;
  arguments?: string[];
  body: StatementAst[];
  sourceLocation: AstSourceLocation;
}

export interface MenuStatementAst {
  kind: "menu";
  prompt?: string;
  promptSpeaker?: string;
  items: MenuItemAst[];
  sourceLocation: AstSourceLocation;
}

export interface JumpStatementAst {
  kind: "jump";
  target: string;
  isExpression: boolean;
  isLocal: boolean;
  isPythonOrigin?: boolean;
  sourceLocation: AstSourceLocation;
}

export interface CallArgumentAst {
  name?: string;
  value: string;
}

export interface CallStatementAst {
  kind: "call";
  target: string;
  isExpression: boolean;
  isLocal: boolean;
  arguments?: CallArgumentAst[];
  isPythonOrigin?: boolean;
  sourceLocation: AstSourceLocation;
}

export interface ReturnStatementAst {
  kind: "return";
  expression?: string;
  sourceLocation: AstSourceLocation;
}

export interface IfBranchAst {
  branchKind: "if" | "elif" | "else";
  condition?: string;
  body: StatementAst[];
  sourceLocation: AstSourceLocation;
}

export interface IfStatementAst {
  kind: "if";
  branches: IfBranchAst[];
  sourceLocation: AstSourceLocation;
}

export interface WhileStatementAst {
  kind: "while";
  condition: string;
  body: StatementAst[];
  sourceLocation: AstSourceLocation;
}

export interface VariableMutationAst {
  variableName: string;
  operator: string;
  value: string;
  rawExpression: string;
}

export interface PythonStatementAst {
  kind: "python";
  code: string;
  isOneLiner: boolean;
  mutations: VariableMutationAst[];
  embeddedJumps: JumpStatementAst[];
  embeddedCalls: CallStatementAst[];
  sourceLocation: AstSourceLocation;
}

export interface CallScreenStatementAst {
  kind: "call_screen";
  screenName: string;
  arguments?: string[];
  sourceLocation: AstSourceLocation;
}

export interface AssetCueStatementAst {
  kind: "asset_cue";
  cueType: "scene" | "show" | "hide" | "play" | "stop" | "queue" | "voice";
  channel?: string;
  asset: string;
  raw: string;
  sourceLocation: AstSourceLocation;
}

export interface PassStatementAst {
  kind: "pass";
  sourceLocation: AstSourceLocation;
}

export interface ScreenActionAst {
  actionName: string;
  target?: string;
  arguments?: string[];
}

export interface ScreenStatementAst {
  kind: "screen";
  name: string;
  actions: ScreenActionAst[];
  sourceLocation: AstSourceLocation;
}

export interface InitStatementAst {
  kind: "init";
  priority?: number;
  body: StatementAst[];
  sourceLocation: AstSourceLocation;
}

export interface PythonBlockAst {
  kind: "python_block";
  isEarly: boolean;
  code: string;
  sourceLocation: AstSourceLocation;
}
