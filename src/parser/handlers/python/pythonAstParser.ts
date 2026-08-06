import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";

export interface PythonAssignment {
  variable: string;
  typeAnnotation?: string;
  valueExpression?: string;
  valueLiteral?: string;
  valueDict?: Map<string, string>;
  valueList?: string[];
  startIndex: number;
}

export interface PythonDirectCall {
  functionName: "jump" | "call";
  targetExpression: string;
  startIndex: number;
  endIndex: number;
}

export interface PythonParsedBlock {
  assignments: PythonAssignment[];
  directCalls: PythonDirectCall[];
}

function unquoteString(text: string): string {
  let trimmed = text.trim();
  const prefixMatch =
    /^(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[fF][rR]|[rR][fF]|[rR]|[uU]|[bB]|[fF])?/
      .exec(trimmed);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  if (prefix) {
    trimmed = trimmed.slice(prefix.length);
  }
  const isRaw = prefix.toLowerCase().includes("r");

  let rawInner: string;
  if (
    (trimmed.startsWith('"""') && trimmed.endsWith('"""') &&
      trimmed.length >= 6) ||
    (trimmed.startsWith("'''") && trimmed.endsWith("'''") &&
      trimmed.length >= 6)
  ) {
    rawInner = trimmed.slice(3, -3);
  } else if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    rawInner = trimmed.slice(1, -1);
  } else {
    return trimmed;
  }

  if (isRaw) return rawInner;

  let result = "";
  let i = 0;
  while (i < rawInner.length) {
    const char = rawInner[i]!;
    if (char === "\\") {
      i++;
      if (i < rawInner.length) {
        const nextChar = rawInner[i]!;
        if (nextChar === "n") result += "\n";
        else if (nextChar === "t") result += "\t";
        else if (nextChar === "r") result += "\r";
        else result += nextChar;
        i++;
      } else {
        result += "\\";
      }
    } else {
      result += char;
      i++;
    }
  }

  return result;
}

function extractNodeText(code: string, node: SyntaxNode): string {
  return code.slice(node.from, node.to);
}

function extractStringLiteral(
  code: string,
  node: SyntaxNode | null,
): string | undefined {
  if (!node) return undefined;
  if (node.name === "String" || node.name === "FormatString") {
    return unquoteString(extractNodeText(code, node));
  }
  return undefined;
}

function extractListLiteral(
  code: string,
  node: SyntaxNode | null,
): string[] | undefined {
  if (!node || node.name !== "ArrayExpression") return undefined;
  const items: string[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === "String" || child.name === "FormatString") {
      items.push(unquoteString(extractNodeText(code, child)));
    }
    child = child.nextSibling;
  }
  return items;
}

function extractDictLiteral(
  code: string,
  node: SyntaxNode | null,
): Map<string, string> | undefined {
  if (!node || node.name !== "DictionaryExpression") return undefined;
  const dict = new Map<string, string>();
  let child = node.firstChild;
  let prevChild: SyntaxNode | null = null;
  while (child) {
    if (child.name === ":" && prevChild) {
      const nextChild = child.nextSibling;
      if (
        (prevChild.name === "String" || prevChild.name === "FormatString") &&
        nextChild &&
        (nextChild.name === "String" || nextChild.name === "FormatString")
      ) {
        const key = unquoteString(extractNodeText(code, prevChild));
        const val = unquoteString(extractNodeText(code, nextChild));
        dict.set(key, val);
      }
    }
    prevChild = child;
    child = child.nextSibling;
  }
  return dict;
}

/**
 * Parses Python code using @lezer/python and extracts top-level assignments
 * and direct renpy.jump(...) / renpy.call(...) function calls via AST traversal.
 */
export function parsePythonBlock(code: string): PythonParsedBlock {
  const tree = parser.parse(code);
  const assignments: PythonAssignment[] = [];
  const directCalls: PythonDirectCall[] = [];

  tree.iterate({
    enter(nodeRef) {
      const node = nodeRef.node;

      // Handle AssignStatement and AugmentedAssignStatement (e.g. x = "val", x += 1, y: str = "val")
      if (
        node.name === "AssignStatement" ||
        node.name === "AugmentedAssignStatement"
      ) {
        const targetVariables: string[] = [];
        let typeAnnotation: string | undefined;
        let valueNode: SyntaxNode | null = null;

        let child = node.firstChild;
        while (child) {
          if (child.name === "VariableName") {
            targetVariables.push(extractNodeText(code, child));
          } else if (child.name === "TypeDef") {
            typeAnnotation = extractNodeText(code, child);
          } else if (
            child.name !== "Comment" &&
            child.name !== "AssignOp" &&
            child.name !== "UpdateOp" &&
            child.name !== ":" &&
            child.name !== "="
          ) {
            valueNode = child;
          }
          child = child.nextSibling;
        }

        if (
          valueNode && valueNode.name === "VariableName" &&
          targetVariables.length > 1 && node.name === "AssignStatement"
        ) {
          targetVariables.pop();
        }

        if (targetVariables.length > 0 && valueNode) {
          const valueExpression = extractNodeText(code, valueNode).trim();
          const valueLiteral = extractStringLiteral(code, valueNode);
          const valueList = extractListLiteral(code, valueNode);
          const valueDict = extractDictLiteral(code, valueNode);

          for (const variableName of targetVariables) {
            assignments.push({
              variable: variableName,
              typeAnnotation,
              valueExpression,
              valueLiteral,
              valueList,
              valueDict,
              startIndex: node.from,
            });
          }
        }
      }

      // Handle CallExpression (e.g. renpy.jump(...), renpy.call(...), renpy.jump_out_of_context(...))
      if (node.name === "CallExpression") {
        const calleeNode = node.firstChild;
        if (calleeNode && calleeNode.name === "MemberExpression") {
          const calleeText = extractNodeText(code, calleeNode);
          if (
            calleeText === "renpy.jump" ||
            calleeText === "renpy.call" ||
            calleeText === "renpy.jump_out_of_context"
          ) {
            const funcKind = (calleeText === "renpy.jump" ||
                calleeText === "renpy.jump_out_of_context")
              ? "jump"
              : "call";
            const argListNode = calleeNode.nextSibling;
            if (argListNode && argListNode.name === "ArgList") {
              // Extract argument text inside parentheses
              const argListText = extractNodeText(code, argListNode).trim();
              if (argListText.startsWith("(") && argListText.endsWith(")")) {
                const targetExpression = argListText.slice(1, -1).trim();
                directCalls.push({
                  functionName: funcKind,
                  targetExpression,
                  startIndex: node.from,
                  endIndex: node.to,
                });
              }
            }
          }
        }
      }
    },
  });

  return { assignments, directCalls };
}
