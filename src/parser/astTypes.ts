/**
 * src/parser/astTypes.ts
 *
 * Intermediate Ren'Py Abstract Syntax Tree (AST) definitions.
 * Standardizes parsed script constructs before flowchart graph synthesis.
 */

export type RenpyAstNodeType =
  | "label"
  | "menu"
  | "jump"
  | "call"
  | "screen"
  | "python_block"
  | "condition"
  | "dialogue";

export interface BaseRenpyAstNode {
  type: RenpyAstNodeType;
  filePath: string;
  lineIndex: number;
  indent: number;
}

export interface AstLabelNode extends BaseRenpyAstNode {
  type: "label";
  name: string;
  isSubLabel: boolean;
  parentLabel?: string;
}

export interface AstMenuNode extends BaseRenpyAstNode {
  type: "menu";
  id: string;
  name?: string;
  options: Array<{
    text: string;
    target?: string;
    condition?: string;
  }>;
}

export interface AstJumpNode extends BaseRenpyAstNode {
  type: "jump";
  target: string;
  isExpression: boolean;
}

export interface AstCallNode extends BaseRenpyAstNode {
  type: "call";
  target: string;
  isExpression: boolean;
}

export interface AstScreenNode extends BaseRenpyAstNode {
  type: "screen";
  name: string;
  actions: string[];
}

export interface AstPythonBlockNode extends BaseRenpyAstNode {
  type: "python_block";
  body: string;
  isEarly: boolean;
}

export interface AstConditionNode extends BaseRenpyAstNode {
  type: "condition";
  branchKind: "if" | "elif" | "else";
  expression?: string;
  references: string[];
}

export type RenpyAstNode =
  | AstLabelNode
  | AstMenuNode
  | AstJumpNode
  | AstCallNode
  | AstScreenNode
  | AstPythonBlockNode
  | AstConditionNode;

export interface RenpyFileAst {
  filePath: string;
  contentHash: string;
  nodes: RenpyAstNode[];
}
