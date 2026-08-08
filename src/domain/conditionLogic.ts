import { Parser } from "expr-eval-fork";

export type MockFlagValue = "true" | "false" | "unknown";
export type ConditionEvaluationResult = "true" | "false" | "unknown";

const parser = new Parser({
  operators: {
    logical: true,
    comparison: true,
    add: false,
    subtract: false,
    multiply: false,
    divide: false,
    remainder: false,
    power: false,
    concatenate: false,
  },
});

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

function preprocessConditionExpression(expression: string): string {
  return expression.replace(
    /(["'])(?:(?=(\\?))\2[\s\S])*?\1|\bis\s+not\b|\bis\b/gi,
    (match, quote) => {
      if (quote) return match;
      const lower = match.toLowerCase();
      if (lower === "is not") return "!=";
      if (lower === "is") return "==";
      return match;
    },
  );
}

const flagRefsCache = new BoundedMap<string, string[]>(200);

export function extractConditionFlagRefs(
  expression: string | undefined,
): string[] {
  if (!expression || expression.trim().length === 0) return [];
  const preprocessed = preprocessConditionExpression(expression);
  try {
    let refs = flagRefsCache.get(preprocessed);
    if (!refs) {
      const vars = parser.parse(preprocessed).variables();
      const KEYWORDS = new Set([
        "true",
        "false",
        "none",
        "null",
        "and",
        "or",
        "not",
      ]);
      refs = vars
        .filter((v) => !KEYWORDS.has(v.toLowerCase()))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      flagRefsCache.set(preprocessed, refs);
    }
    return refs;
  } catch {
    return [];
  }
}

interface EvalInstruction {
  type: string;
  value?: unknown;
}

function evaluateInstructions(
  instructions: EvalInstruction[],
  flags: Record<string, MockFlagValue>,
): ConditionEvaluationResult {
  const stack: string[] = [];

  for (const inst of instructions) {
    if (inst.type === "IVAR") {
      const val = typeof inst.value === "string" ? inst.value : "";
      const lower = val.toLowerCase();
      if (lower === "true") {
        stack.push("true");
      } else if (lower === "false" || lower === "none" || lower === "null") {
        stack.push("false");
      } else if (val && flags[val] !== undefined) {
        stack.push(String(flags[val]));
      } else {
        stack.push("unknown");
      }
    } else if (inst.type === "INUMBER" || inst.type === "INUM") {
      stack.push(String(inst.value ?? 0));
    } else if (inst.type === "ISTR") {
      stack.push(String(inst.value ?? ""));
    } else if (inst.type === "IEXPR") {
      if (Array.isArray(inst.value)) {
        stack.push(
          evaluateInstructions(inst.value as EvalInstruction[], flags),
        );
      } else {
        stack.push("unknown");
      }
    } else if (inst.type === "IOP1") {
      const val = stack.pop();
      if (val === undefined) throw new Error("Stack underflow");
      const op = typeof inst.value === "string" ? inst.value : "";
      if (op === "-" || op === "+") {
        if (val === "unknown") {
          stack.push("unknown");
        } else {
          const num = Number(val);
          stack.push(isNaN(num) ? "unknown" : String(op === "-" ? -num : +num));
        }
      } else {
        const numVal = Number(val);
        const isFalsy = val === "false" ||
          (!isNaN(numVal) && numVal === 0) ||
          val === "none" ||
          val === "null" ||
          val === "";
        stack.push(
          val === "unknown" ? "unknown" : isFalsy ? "true" : "false",
        );
      }
    } else if (inst.type === "IOP2") {
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) {
        throw new Error("Stack underflow");
      }

      const op = typeof inst.value === "string" ? inst.value : "";
      if (op === "and" || op === "&&") {
        if (left === "false" || right === "false") {
          stack.push("false");
        } else if (left !== "unknown" && right !== "unknown") {
          stack.push("true");
        } else {
          stack.push("unknown");
        }
      } else if (op === "or" || op === "||") {
        if (left === "true" || right === "true") {
          stack.push("true");
        } else if (left === "false" && right === "false") {
          stack.push("false");
        } else {
          stack.push("unknown");
        }
      } else if (op === "==" || op === "!=") {
        if (left === "unknown" || right === "unknown") {
          stack.push("unknown");
        } else {
          const isNumericStr = (s: string) =>
            /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s.trim());
          const equal = (isNumericStr(left) && isNumericStr(right))
            ? Number(left) === Number(right)
            : left === right;
          const res = op === "==" ? equal : !equal;
          stack.push(res ? "true" : "false");
        }
      } else if (op === "<" || op === ">" || op === "<=" || op === ">=") {
        if (left === "unknown" || right === "unknown") {
          stack.push("unknown");
        } else {
          const numL = Number(left);
          const numR = Number(right);
          if (!isNaN(numL) && !isNaN(numR)) {
            let res = false;
            if (op === "<") res = numL < numR;
            else if (op === ">") res = numL > numR;
            else if (op === "<=") res = numL <= numR;
            else if (op === ">=") res = numL >= numR;
            stack.push(res ? "true" : "false");
          } else {
            stack.push("unknown");
          }
        }
      } else {
        stack.push("unknown");
      }
    }
  }

  const finalVal = stack.pop() ?? "unknown";
  if (finalVal === "true" || finalVal === "false") return finalVal;
  if (finalVal === "unknown") return "unknown";
  const num = Number(finalVal);
  if (!isNaN(num)) return num !== 0 ? "true" : "false";
  if (finalVal === "none" || finalVal === "null" || finalVal === "") {
    return "false";
  }
  return "true";
}

const parsedExpressionCache = new BoundedMap<string, EvalInstruction[]>(200);

export function evaluateConditionExpression(
  expression: string | undefined,
  flags: Record<string, MockFlagValue>,
): ConditionEvaluationResult {
  if (!expression || expression.trim().length === 0) return "unknown";
  const preprocessed = preprocessConditionExpression(expression);
  try {
    let tokens = parsedExpressionCache.get(preprocessed);
    if (!tokens) {
      const expr = parser.parse(preprocessed);
      tokens = (expr as unknown as { tokens: EvalInstruction[] }).tokens;
      parsedExpressionCache.set(preprocessed, tokens);
    }
    return evaluateInstructions(tokens, flags);
  } catch {
    return "unknown";
  }
}

export function buildMockFlagsFromVariableState(
  variables: Map<string, unknown>,
  persistent?: Map<string, unknown>,
): Record<string, MockFlagValue> {
  const flags: Record<string, MockFlagValue> = {};

  for (const [key, val] of variables.entries()) {
    if (val === true || val === "true") flags[key] = "true";
    else if (val === false || val === "false") flags[key] = "false";
    else if (typeof val === "number" || typeof val === "string") {
      flags[key] = val as MockFlagValue;
    } else flags[key] = "unknown";
  }

  if (persistent) {
    for (const [key, val] of persistent.entries()) {
      if (val === true || val === "true") flags[key] = "true";
      else if (val === false || val === "false") flags[key] = "false";
      else if (typeof val === "number" || typeof val === "string") {
        flags[key] = val as MockFlagValue;
      } else flags[key] = "unknown";
    }
  }

  return flags;
}
