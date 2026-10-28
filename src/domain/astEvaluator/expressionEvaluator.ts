import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import type { PythonAstEvaluationResult } from "./types.ts";
import {
  COMPARISON_OPS,
  extractNodeText,
  extractStringLiteral,
  getNonSeparatorChildren,
  isOpNode,
  isPythonTruthy,
  unquoteString,
} from "./evalLiteral.ts";
import { applySingleBinaryOp } from "./evalBinaryOp.ts";
import {
  collectCandidateStringsFromTarget,
  evalBuiltinCall,
  evalMemberAccess,
  evalSubscript,
} from "./evalSubscript.ts";

/**
 * Evaluates a Python expression AST statically using @lezer/python.
 * Correctly evaluates condition expressions, ternary operations, function calls,
 * collections (list, tuple, dict), indexing/subscripting, chained comparisons,
 * arithmetic, comparison, and logical operators.
 */
export function evaluatePythonAstExpression(
  expressionText: string,
  environment: Record<string, unknown> = {},
): PythonAstEvaluationResult {
  const trimmed = expressionText.trim();
  if (!trimmed) {
    return {
      value: undefined,
      isStaticallyEvaluated: false,
      stringCandidates: [],
    };
  }

  try {
    const tree = parser.parse(trimmed);
    const root = tree.topNode;

    const stringCandidates: string[] = [];

    const evalNode = (node: SyntaxNode): { value: unknown; ok: boolean } => {
      if (!node) return { value: undefined, ok: false };

      const nodeKind = node.name;

      if (nodeKind === "Script" || nodeKind === "ExpressionStatement") {
        const child = node.firstChild;
        return child ? evalNode(child) : { value: undefined, ok: false };
      }

      if (nodeKind === "ParenthesizedExpression") {
        const children = getNonSeparatorChildren(node);
        return children[0]
          ? evalNode(children[0])
          : { value: undefined, ok: false };
      }

      if (nodeKind === "String" || nodeKind === "FormatString") {
        const strVal = unquoteString(extractNodeText(trimmed, node));
        stringCandidates.push(strVal);
        return { value: strVal, ok: true };
      }

      if (nodeKind === "Number") {
        const text = extractNodeText(trimmed, node);
        const num = Number(text);
        return { value: num, ok: !isNaN(num) };
      }

      if (nodeKind === "None") {
        return { value: null, ok: true };
      }

      if (nodeKind === "Boolean" || nodeKind === "VariableName") {
        const text = extractNodeText(trimmed, node);
        if (text === "True" || text === "true") {
          return { value: true, ok: true };
        }
        if (text === "False" || text === "false") {
          return { value: false, ok: true };
        }
        if (
          text === "None" || text === "none" || text === "null" ||
          text === "Null"
        ) {
          return { value: null, ok: true };
        }

        if (Object.prototype.hasOwnProperty.call(environment, text)) {
          const envVal = environment[text];
          if (typeof envVal === "string") stringCandidates.push(envVal);
          return { value: envVal, ok: true };
        }
        return { value: undefined, ok: false };
      }

      // Handle ArrayExpression and TupleExpression literals
      if (nodeKind === "ArrayExpression" || nodeKind === "TupleExpression") {
        const children = getNonSeparatorChildren(node);
        const arr: unknown[] = [];
        let allOk = true;
        for (const child of children) {
          const res = evalNode(child);
          if (res.ok) {
            arr.push(res.value);
            if (typeof res.value === "string") stringCandidates.push(res.value);
          } else {
            allOk = false;
          }
        }
        return { value: arr, ok: allOk };
      }

      // Handle DictionaryExpression literals
      if (nodeKind === "DictionaryExpression") {
        const dict: Record<string, unknown> = {};
        let child = node.firstChild;
        let prevKeyNode: SyntaxNode | null = null;
        let allOk = true;
        while (child) {
          if (child.name === ":" && prevKeyNode) {
            const nextValNode = child.nextSibling;
            if (nextValNode) {
              const kRes = evalNode(prevKeyNode);
              const vRes = evalNode(nextValNode);
              if (kRes.ok && vRes.ok) {
                dict[String(kRes.value)] = vRes.value;
                if (typeof vRes.value === "string") {
                  stringCandidates.push(vRes.value);
                }
              } else {
                allOk = false;
              }
            }
          }
          if (
            child.name !== "{" &&
            child.name !== "}" &&
            child.name !== "," &&
            child.name !== ":" &&
            child.name !== "Comment"
          ) {
            prevKeyNode = child;
          }
          child = child.nextSibling;
        }
        return { value: dict, ok: allOk };
      }

      // Handle SubscriptExpression / IndexExpression (e.g. items[0], data["key"])
      if (
        nodeKind === "SubscriptExpression" ||
        nodeKind === "IndexExpression"
      ) {
        const children = getNonSeparatorChildren(node);
        if (children.length >= 2) {
          const targetRes = evalNode(children[0]!);
          const indexRes = evalNode(children[1]!);
          if (targetRes.ok) {
            const target = targetRes.value;
            if (indexRes.ok) {
              return evalSubscript(target, indexRes.value, stringCandidates);
            } else {
              collectCandidateStringsFromTarget(target, stringCandidates);
            }
          }
        }
        return { value: undefined, ok: false };
      }

      // Handle MemberExpression (e.g. persistent.flag, stats.hp)
      if (nodeKind === "MemberExpression") {
        const fullText = extractNodeText(trimmed, node);
        if (Object.prototype.hasOwnProperty.call(environment, fullText)) {
          const envVal = environment[fullText];
          if (typeof envVal === "string") stringCandidates.push(envVal);
          return { value: envVal, ok: true };
        }
        const objChild = node.firstChild;
        const propChild = node.lastChild;
        if (objChild && propChild && objChild !== propChild) {
          const objRes = evalNode(objChild);
          const propName = extractNodeText(trimmed, propChild);
          if (objRes.ok) {
            return evalMemberAccess(objRes.value, propName, stringCandidates);
          }
        }
        return { value: undefined, ok: false };
      }

      // Handle Ternary: ConditionalExpression (consequence if test else alternative)
      if (nodeKind === "ConditionalExpression") {
        let consequenceNode: SyntaxNode | null = null;
        let testNode: SyntaxNode | null = null;
        let alternativeNode: SyntaxNode | null = null;

        let child = node.firstChild;
        let mode: "consequence" | "test" | "alternative" = "consequence";

        while (child) {
          const cName = child.name;
          if (cName === "if") {
            mode = "test";
          } else if (cName === "else") {
            mode = "alternative";
          } else if (cName !== "(" && cName !== ")" && cName !== "Comment") {
            if (mode === "consequence" && !consequenceNode) {
              consequenceNode = child;
            } else if (mode === "test" && !testNode) testNode = child;
            else if (mode === "alternative" && !alternativeNode) {
              alternativeNode = child;
            }
          }
          child = child.nextSibling;
        }

        if (consequenceNode && testNode && alternativeNode) {
          const testRes = evalNode(testNode);
          if (testRes.ok) {
            const isTruthy = isPythonTruthy(testRes.value);
            return isTruthy
              ? evalNode(consequenceNode)
              : evalNode(alternativeNode);
          } else {
            const cRes = evalNode(consequenceNode);
            const aRes = evalNode(alternativeNode);
            if (cRes.ok && typeof cRes.value === "string") {
              stringCandidates.push(cRes.value);
            } else if (!cRes.ok && consequenceNode) {
              const cText = extractStringLiteral(trimmed, consequenceNode) ??
                extractNodeText(trimmed, consequenceNode).trim().replace(
                  /^["']|["']$/g,
                  "",
                );
              if (cText && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cText)) {
                stringCandidates.push(cText);
              }
            }
            if (aRes.ok && typeof aRes.value === "string") {
              stringCandidates.push(aRes.value);
            } else if (!aRes.ok && alternativeNode) {
              const aText = extractStringLiteral(trimmed, alternativeNode) ??
                extractNodeText(trimmed, alternativeNode).trim().replace(
                  /^["']|["']$/g,
                  "",
                );
              if (aText && /^[A-Za-z_][A-Za-z0-9_]*$/.test(aText)) {
                stringCandidates.push(aText);
              }
            }
            return { value: undefined, ok: false };
          }
        }
      }

      // Handle CallExpression
      if (nodeKind === "CallExpression") {
        const calleeNode = node.firstChild;
        if (calleeNode) {
          const calleeText = extractNodeText(trimmed, calleeNode);
          let argListNode: SyntaxNode | null = null;
          let curr = node.firstChild;
          while (curr) {
            if (curr.name === "ArgList") {
              argListNode = curr;
              break;
            }
            curr = curr.nextSibling;
          }

          const argNodes = argListNode
            ? getNonSeparatorChildren(argListNode)
            : [];
          const evaluatedArgs: unknown[] = [];
          let allArgsOk = true;

          for (const argNode of argNodes) {
            const argRes = evalNode(argNode);
            if (argRes.ok) {
              evaluatedArgs.push(argRes.value);
            } else {
              allArgsOk = false;
            }
          }

          if (allArgsOk) {
            const builtinRes = evalBuiltinCall(calleeText, evaluatedArgs);
            if (builtinRes.ok) return builtinRes;
          }

          return { value: undefined, ok: false };
        }
      }

      // Handle BinaryExpression & Chained Comparisons
      if (nodeKind === "BinaryExpression") {
        const operands: SyntaxNode[] = [];
        const rawOperators: string[] = [];

        let child = node.firstChild;
        while (child) {
          if (
            child.name !== "(" &&
            child.name !== ")" &&
            child.name !== "Comment"
          ) {
            if (isOpNode(child.name)) {
              rawOperators.push(extractNodeText(trimmed, child).trim());
            } else {
              operands.push(child);
            }
          }
          child = child.nextSibling;
        }

        if (operands.length === 2 && rawOperators.length === 0) {
          const op = trimmed.slice(operands[0]!.to, operands[1]!.from).trim();
          rawOperators.push(op);
        }

        const operators: string[] = [];
        for (let i = 0; i < rawOperators.length; i++) {
          if (rawOperators[i] === "is" && rawOperators[i + 1] === "not") {
            operators.push("is not");
            i++;
          } else if (
            rawOperators[i] === "not" && rawOperators[i + 1] === "in"
          ) {
            operators.push("not in");
            i++;
          } else {
            operators.push(rawOperators[i]!);
          }
        }

        if (operands.length >= 2) {
          // Check if this is a chained comparison (e.g. 1 < x <= 10 or a == b == c)
          const isChainedComp = operators.length >= 1 &&
            operators.every((op) => COMPARISON_OPS.has(op));

          if (isChainedComp && operands.length === operators.length + 1) {
            let prevVal: unknown;
            for (let i = 0; i < operators.length; i++) {
              const op = operators[i]!;
              const lRes = i === 0
                ? evalNode(operands[i]!)
                : { value: prevVal, ok: true };
              const rRes = evalNode(operands[i + 1]!);
              if (!lRes.ok || !rRes.ok) return { value: undefined, ok: false };

              const cmpRes = applySingleBinaryOp(op, lRes.value, rRes.value);
              if (!cmpRes.ok || !cmpRes.value) {
                return { value: false, ok: true };
              }
              prevVal = rRes.value;
            }
            return { value: true, ok: true };
          }

          // Single binary operator
          if (operands.length === 2 && operators.length === 1) {
            const op = operators[0]!;
            const leftNode = operands[0]!;
            const rightNode = operands[1]!;

            const lRes = evalNode(leftNode);
            const rRes = evalNode(rightNode);

            if (op === "and") {
              if (lRes.ok && !isPythonTruthy(lRes.value)) {
                return { value: lRes.value, ok: true };
              }
              if (rRes.ok && !isPythonTruthy(rRes.value)) {
                return { value: rRes.value, ok: true };
              }
              if (lRes.ok && rRes.ok) {
                return {
                  value: isPythonTruthy(lRes.value) ? rRes.value : lRes.value,
                  ok: true,
                };
              }
            } else if (op === "or") {
              if (lRes.ok && isPythonTruthy(lRes.value)) {
                return { value: lRes.value, ok: true };
              }
              if (rRes.ok && isPythonTruthy(rRes.value)) {
                return { value: rRes.value, ok: true };
              }
              if (lRes.ok && rRes.ok) {
                return {
                  value: isPythonTruthy(lRes.value) ? rRes.value : lRes.value,
                  ok: true,
                };
              }
            } else if (lRes.ok && rRes.ok) {
              return applySingleBinaryOp(op, lRes.value, rRes.value);
            }
          }
        }
      }

      // Handle UnaryExpression
      if (nodeKind === "UnaryExpression") {
        const children = getNonSeparatorChildren(node);
        if (children.length >= 1) {
          const opText = extractNodeText(trimmed, node).trim();
          const targetNode = children[children.length - 1]!;
          const res = evalNode(targetNode);
          if (res.ok) {
            if (opText.startsWith("not")) {
              return { value: !isPythonTruthy(res.value), ok: true };
            }
            if (opText.startsWith("-")) {
              return { value: -(res.value as number), ok: true };
            }
            if (opText.startsWith("+")) {
              return { value: +(res.value as number), ok: true };
            }
            if (opText.startsWith("~")) {
              return { value: ~(res.value as number), ok: true };
            }
          }
        }
      }

      return { value: undefined, ok: false };
    };

    const res = evalNode(root);
    return {
      value: res.value,
      isStaticallyEvaluated: res.ok,
      stringCandidates: Array.from(new Set(stringCandidates)),
    };
  } catch {
    return {
      value: undefined,
      isStaticallyEvaluated: false,
      stringCandidates: [],
    };
  }
}
