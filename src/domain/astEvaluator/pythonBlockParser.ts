import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import type {
  PythonAssignment,
  PythonDirectCall,
  PythonParsedBlock,
} from "./types.ts";
import {
  extractDictLiteral,
  extractListLiteral,
  extractNodeText,
  extractStringLiteral,
  getNonSeparatorChildren,
  isVariableNegationOf,
} from "./evalLiteral.ts";

/**
 * Parses Python code using @lezer/python and extracts top-level assignments
 * (including multi-variable tuple/list unpacking, chained assignments, and augmented assignments)
 * and direct renpy.jump/call calls.
 */
export function parsePythonBlock(rawCode: string): PythonParsedBlock {
  const code = rawCode.replace(/^(\s*)\$\s*/gm, "$1");
  const tree = parser.parse(code);
  const assignments: PythonAssignment[] = [];
  const directCalls: PythonDirectCall[] = [];

  tree.iterate({
    enter(nodeRef) {
      const node = nodeRef.node;

      // Handle AssignStatement, UpdateStatement, and AugmentedAssignStatement (e.g. x = "val", count += 1, x, y = 1, 2)
      if (
        node.name === "AssignStatement" ||
        node.name === "UpdateStatement" ||
        node.name === "AugmentedAssignStatement"
      ) {
        let typeAnnotation: string | undefined;

        let child = node.firstChild;
        while (child) {
          if (child.name === "TypeDef") {
            typeAnnotation = extractNodeText(code, child);
          }
          child = child.nextSibling;
        }

        const allChildren: SyntaxNode[] = [];
        let curr = node.firstChild;
        let assignOpIndex = -1;
        let detectedOp:
          | "="
          | "+="
          | "-="
          | "*="
          | "/="
          | "%="
          | "//="
          | "**=" = "=";
        while (curr) {
          if (
            curr.name === "AssignOp" ||
            curr.name === "UpdateOp" ||
            curr.name.includes("=")
          ) {
            assignOpIndex = allChildren.length;
            const opText = extractNodeText(code, curr).trim();
            if (opText === "+=") detectedOp = "+=";
            else if (opText === "-=") detectedOp = "-=";
            else if (opText === "*=") detectedOp = "*=";
            else if (opText === "/=") detectedOp = "/=";
            else if (opText === "%=") detectedOp = "%=";
            else if (opText === "//=") detectedOp = "//=";
            else if (opText === "**=") detectedOp = "**=";
            else detectedOp = "=";
          } else if (
            curr.name !== "(" &&
            curr.name !== ")" &&
            curr.name !== "[" &&
            curr.name !== "]" &&
            curr.name !== "{" &&
            curr.name !== "}" &&
            curr.name !== "," &&
            curr.name !== ":" &&
            curr.name !== "Comment"
          ) {
            allChildren.push(curr);
          }
          curr = curr.nextSibling;
        }

        if (assignOpIndex > 0 && assignOpIndex < allChildren.length) {
          const lhsChildren = allChildren.slice(0, assignOpIndex);
          const rhsChildren = allChildren.slice(assignOpIndex);

          const lhsVars: SyntaxNode[] = [];
          for (const c of lhsChildren) {
            if (c.name === "TupleExpression" || c.name === "ArrayExpression") {
              lhsVars.push(
                ...getNonSeparatorChildren(c).filter((n) =>
                  n.name === "VariableName" || n.name === "MemberExpression"
                ),
              );
            } else if (
              c.name === "VariableName" || c.name === "MemberExpression"
            ) {
              lhsVars.push(c);
            }
          }

          const rhsVals: SyntaxNode[] = [];
          for (const c of rhsChildren) {
            if (c.name === "TupleExpression" || c.name === "ArrayExpression") {
              rhsVals.push(...getNonSeparatorChildren(c));
            } else {
              rhsVals.push(c);
            }
          }

          if (lhsVars.length > 1 && lhsVars.length === rhsVals.length) {
            for (let i = 0; i < lhsVars.length; i++) {
              const varNode = lhsVars[i]!;
              const valNode = rhsVals[i]!;
              const varName = extractNodeText(code, varNode);
              const valueExpression = extractNodeText(code, valNode).trim();
              const valueLiteral = extractStringLiteral(code, valNode);
              const valueList = extractListLiteral(code, valNode);
              const valueDict = extractDictLiteral(code, valNode);
              let op:
                | "="
                | "+="
                | "-="
                | "*="
                | "/="
                | "%="
                | "//="
                | "**="
                | "toggle" = detectedOp;
              if (
                op === "=" && isVariableNegationOf(valueExpression, varName)
              ) {
                op = "toggle";
              }

              assignments.push({
                variable: varName,
                operator: op,
                typeAnnotation,
                valueExpression,
                valueLiteral,
                valueList,
                valueDict,
                startIndex: node.from,
              });
            }
          } else if (lhsVars.length > 0 && rhsChildren.length > 0) {
            const firstRhs = rhsChildren[0]!;
            const lastRhs = rhsChildren[rhsChildren.length - 1]!;
            const rawRhsExpr = code.slice(firstRhs.from, lastRhs.to).trim();
            const valueLiteral = extractStringLiteral(code, lastRhs);
            const valueList = extractListLiteral(code, lastRhs);
            const valueDict = extractDictLiteral(code, lastRhs);

            for (const varNode of lhsVars) {
              const variableName = extractNodeText(code, varNode);
              const valueExpression = rawRhsExpr;
              let op:
                | "="
                | "+="
                | "-="
                | "*="
                | "/="
                | "%="
                | "//="
                | "**="
                | "toggle" = detectedOp;
              if (
                op === "=" && isVariableNegationOf(rawRhsExpr, variableName)
              ) {
                op = "toggle";
              }
              assignments.push({
                variable: variableName,
                operator: op,
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
      }

      // Handle CallExpression (e.g. renpy.jump(...), renpy.call(...))
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
