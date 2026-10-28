import { parser as pythonParser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import {
  COMPARISON_OPS,
  extractNodeText,
  getNonSeparatorChildren,
  isOpNode,
  isPythonTruthy,
  unquoteString,
} from "./evalLiteral.ts";

export type MockFlagValue = "true" | "false" | "unknown";
export type ConditionEvaluationResult = "true" | "false" | "unknown";

class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    super();
    this.maxEntries = maxEntries;
  }

  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  override set(key: K, value: V): this {
    if (super.has(key)) {
      super.delete(key);
    }
    super.set(key, value);
    while (this.size > this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey === undefined) break;
      super.delete(oldestKey);
    }
    return this;
  }
}

const isDecimalNumericStr = (s: string): boolean =>
  /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s.trim());

interface EvalResult {
  val: unknown;
  state: "known" | "unknown";
}

function normalizeForComparison(
  val: unknown,
): { num?: number; str?: string; bool?: boolean; isNil?: boolean } {
  if (val === null || val === undefined) {
    return { isNil: true, bool: false, num: 0 };
  }
  if (typeof val === "boolean") {
    return { bool: val, num: val ? 1 : 0 };
  }
  if (typeof val === "number") {
    return { num: val, bool: val !== 0 };
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "true") return { bool: true, num: 1 };
    if (lower === "false") return { bool: false, num: 0 };
    if (lower === "none" || lower === "null") {
      return { isNil: true, bool: false, num: 0 };
    }
    if (isDecimalNumericStr(trimmed)) {
      const num = Number(trimmed);
      return { num, str: trimmed, bool: num !== 0 };
    }
    return { str: trimmed, bool: trimmed.length > 0 };
  }
  return {};
}

function compareEqual(lv: unknown, rv: unknown): boolean {
  const normL = normalizeForComparison(lv);
  const normR = normalizeForComparison(rv);

  // Both are nil-like (None/null/false)
  if (normL.isNil && normR.isNil) return true;
  if (normL.isNil || normR.isNil) {
    // If one is nil and the other is boolean false
    if (normL.isNil && normR.bool === false) return true;
    if (normR.isNil && normL.bool === false) return true;
    return false;
  }

  // If both have numbers (e.g. 16 and 16.0 or true and 1)
  if (normL.num !== undefined && normR.num !== undefined) {
    // But if one is a non-decimal string, don't coerce! E.g. "0x10" vs 16
    if (typeof lv === "string" && !isDecimalNumericStr(lv)) return false;
    if (typeof rv === "string" && !isDecimalNumericStr(rv)) return false;
    return normL.num === normR.num;
  }

  // If both have strings
  if (normL.str !== undefined && normR.str !== undefined) {
    return normL.str === normR.str;
  }

  // Fallback to strict equality
  return lv === rv;
}

const astCache = new BoundedMap<
  string,
  ReturnType<typeof pythonParser.parse>
>(200);

export function evaluateConditionExpression(
  expression: string | undefined,
  flags: Record<string, MockFlagValue>,
): ConditionEvaluationResult {
  if (!expression || expression.trim().length === 0) return "unknown";
  const trimmed = expression.trim();

  let tree = astCache.get(trimmed);
  if (!tree) {
    try {
      tree = pythonParser.parse(trimmed);
      astCache.set(trimmed, tree);
    } catch {
      return "unknown";
    }
  }

  const evalNode = (node: SyntaxNode | null): EvalResult => {
    if (!node) return { val: undefined, state: "unknown" };

    const nodeKind = node.name;

    if (nodeKind === "Script" || nodeKind === "ExpressionStatement") {
      const child = node.firstChild;
      return child ? evalNode(child) : { val: undefined, state: "unknown" };
    }

    if (nodeKind === "ParenthesizedExpression") {
      const children = getNonSeparatorChildren(node);
      return children[0]
        ? evalNode(children[0])
        : { val: undefined, state: "unknown" };
    }

    if (nodeKind === "String" || nodeKind === "FormatString") {
      return {
        val: unquoteString(extractNodeText(trimmed, node)),
        state: "known",
      };
    }

    if (nodeKind === "Number") {
      const num = Number(extractNodeText(trimmed, node));
      return !isNaN(num)
        ? { val: num, state: "known" }
        : { val: undefined, state: "unknown" };
    }

    if (nodeKind === "Boolean") {
      const text = extractNodeText(trimmed, node);
      return { val: text === "True" || text === "true", state: "known" };
    }

    if (nodeKind === "None") {
      return { val: null, state: "known" };
    }

    if (nodeKind === "VariableName" || nodeKind === "MemberExpression") {
      const text = extractNodeText(trimmed, node);
      const lower = text.toLowerCase();
      if (lower === "true") return { val: true, state: "known" };
      if (lower === "false") return { val: false, state: "known" };
      if (lower === "none" || lower === "null") {
        return { val: null, state: "known" };
      }

      if (Object.prototype.hasOwnProperty.call(flags, text)) {
        const flagVal = flags[text];
        if (flagVal === undefined || flagVal === "unknown") {
          return { val: undefined, state: "unknown" };
        }
        if (flagVal === "true") return { val: true, state: "known" };
        if (flagVal === "false") return { val: false, state: "known" };
        if (flagVal === "none" || flagVal === "null") {
          return { val: null, state: "known" };
        }
        if (typeof flagVal === "string" && isDecimalNumericStr(flagVal)) {
          return { val: Number(flagVal), state: "known" };
        }
        return { val: flagVal, state: "known" };
      }

      return { val: undefined, state: "unknown" };
    }

    // Handle UnaryExpression
    if (nodeKind === "UnaryExpression") {
      const children = getNonSeparatorChildren(node);
      if (children.length >= 1) {
        const opText = extractNodeText(trimmed, node).trim();
        const targetNode = children[children.length - 1]!;
        const res = evalNode(targetNode);

        if (opText.startsWith("not") || opText.startsWith("!")) {
          if (res.state === "known") {
            return { val: !isPythonTruthy(res.val), state: "known" };
          }
          return { val: undefined, state: "unknown" };
        }

        if (opText.startsWith("-") || opText.startsWith("+")) {
          if (res.state === "known" && typeof res.val === "number") {
            return {
              val: opText.startsWith("-") ? -res.val : +res.val,
              state: "known",
            };
          }
          return { val: undefined, state: "unknown" };
        }
      }
      return { val: undefined, state: "unknown" };
    }

    // Handle BinaryExpression
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
        } else if (rawOperators[i] === "not" && rawOperators[i + 1] === "in") {
          operators.push("not in");
          i++;
        } else {
          operators.push(rawOperators[i]!);
        }
      }

      if (operands.length >= 2) {
        // Chained comparisons (e.g. 1 < x <= 10 or a == b == c)
        const isChainedComp = operators.length >= 1 &&
          operators.every((op) => COMPARISON_OPS.has(op));

        if (isChainedComp && operands.length === operators.length + 1) {
          let prevVal: unknown;
          for (let i = 0; i < operators.length; i++) {
            const op = operators[i]!;
            const lRes = i === 0
              ? evalNode(operands[i]!)
              : { val: prevVal, state: "known" as const };
            const rRes = evalNode(operands[i + 1]!);
            if (lRes.state !== "known" || rRes.state !== "known") {
              return { val: undefined, state: "unknown" };
            }

            let cmpPassed = false;
            if (op === "==" || op === "is") {
              cmpPassed = compareEqual(lRes.val, rRes.val);
            } else if (op === "!=" || op === "is not") {
              cmpPassed = !compareEqual(lRes.val, rRes.val);
            } else {
              const numL = Number(lRes.val);
              const numR = Number(rRes.val);
              if (isNaN(numL) || isNaN(numR)) {
                return { val: undefined, state: "unknown" };
              }
              if (op === "<") cmpPassed = numL < numR;
              else if (op === ">") cmpPassed = numL > numR;
              else if (op === "<=") cmpPassed = numL <= numR;
              else if (op === ">=") cmpPassed = numL >= numR;
            }

            if (!cmpPassed) return { val: false, state: "known" };
            prevVal = rRes.val;
          }
          return { val: true, state: "known" };
        }

        // Single binary operator
        if (operands.length === 2 && operators.length === 1) {
          const op = operators[0]!;
          const leftNode = operands[0]!;
          const rightNode = operands[1]!;

          const lRes = evalNode(leftNode);
          const rRes = evalNode(rightNode);

          if (op === "and" || op === "&&") {
            if (lRes.state === "known" && !isPythonTruthy(lRes.val)) {
              return { val: false, state: "known" };
            }
            if (rRes.state === "known" && !isPythonTruthy(rRes.val)) {
              return { val: false, state: "known" };
            }
            if (lRes.state === "known" && rRes.state === "known") {
              return {
                val: isPythonTruthy(lRes.val) && isPythonTruthy(rRes.val),
                state: "known",
              };
            }
            return { val: undefined, state: "unknown" };
          }

          if (op === "or" || op === "||") {
            if (lRes.state === "known" && isPythonTruthy(lRes.val)) {
              return { val: true, state: "known" };
            }
            if (rRes.state === "known" && isPythonTruthy(rRes.val)) {
              return { val: true, state: "known" };
            }
            if (lRes.state === "known" && rRes.state === "known") {
              return {
                val: isPythonTruthy(lRes.val) || isPythonTruthy(rRes.val),
                state: "known",
              };
            }
            return { val: undefined, state: "unknown" };
          }

          if (op === "==" || op === "is") {
            if (lRes.state !== "known" || rRes.state !== "known") {
              return { val: undefined, state: "unknown" };
            }
            return { val: compareEqual(lRes.val, rRes.val), state: "known" };
          }

          if (op === "!=" || op === "is not") {
            if (lRes.state !== "known" || rRes.state !== "known") {
              return { val: undefined, state: "unknown" };
            }
            return { val: !compareEqual(lRes.val, rRes.val), state: "known" };
          }

          if (op === "<" || op === ">" || op === "<=" || op === ">=") {
            if (lRes.state !== "known" || rRes.state !== "known") {
              return { val: undefined, state: "unknown" };
            }
            const normL = normalizeForComparison(lRes.val);
            const normR = normalizeForComparison(rRes.val);
            if (normL.num !== undefined && normR.num !== undefined) {
              let res = false;
              if (op === "<") res = normL.num < normR.num;
              else if (op === ">") res = normL.num > normR.num;
              else if (op === "<=") res = normL.num <= normR.num;
              else if (op === ">=") res = normL.num >= normR.num;
              return { val: res, state: "known" };
            }
            return { val: undefined, state: "unknown" };
          }

          // Arithmetic: only allowed if neither operand is a boolean flag (to preserve "flag_a + 1" -> unknown)
          if (
            op === "+" || op === "-" || op === "*" || op === "/" || op === "%"
          ) {
            if (lRes.state !== "known" || rRes.state !== "known") {
              return { val: undefined, state: "unknown" };
            }
            if (
              typeof lRes.val === "boolean" || typeof rRes.val === "boolean"
            ) {
              return { val: undefined, state: "unknown" };
            }
            const numL = Number(lRes.val);
            const numR = Number(rRes.val);
            if (!isNaN(numL) && !isNaN(numR)) {
              let val = 0;
              if (op === "+") val = numL + numR;
              else if (op === "-") val = numL - numR;
              else if (op === "*") val = numL * numR;
              else if (op === "/") val = numR !== 0 ? numL / numR : NaN;
              else if (op === "%") val = numR !== 0 ? numL % numR : NaN;
              return !isNaN(val)
                ? { val, state: "known" }
                : { val: undefined, state: "unknown" };
            }
            return { val: undefined, state: "unknown" };
          }
        }
      }
      return { val: undefined, state: "unknown" };
    }

    return { val: undefined, state: "unknown" };
  };

  const finalRes = evalNode(tree.topNode);
  if (finalRes.state === "unknown") return "unknown";
  if (typeof finalRes.val === "boolean") {
    return finalRes.val ? "true" : "false";
  }
  if (typeof finalRes.val === "number") {
    return !isNaN(finalRes.val) && finalRes.val !== 0 ? "true" : "false";
  }
  if (
    finalRes.val === null || finalRes.val === undefined || finalRes.val === ""
  ) {
    return "false";
  }
  return "true";
}
