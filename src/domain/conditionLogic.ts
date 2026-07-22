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
      const first = this.keys().next();
      if (first.done || first.value === undefined) break;
      super.delete(first.value);
    }
    return this;
  }
}

function preprocessConditionExpression(expr: string): string {
  // Replace Python 'is not' / 'is' keywords while preserving string contents inside quotes
  const runId = Math.random().toString(36).substring(2, 8);
  const prefix = `__STR_PH_${runId}_`;
  const placeholders: string[] = [];
  let inQuote: '"' | "'" | null = null;
  let code = "";
  let currentString = "";

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i]!;
    if (inQuote) {
      currentString += char;
      if (char === "\\") {
        if (i + 1 < expr.length) {
          currentString += expr[++i];
        }
      } else if (char === inQuote) {
        inQuote = null;
        placeholders.push(currentString);
        code += `${prefix}${placeholders.length - 1}__`;
        currentString = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inQuote = char;
      currentString = char;
      continue;
    }
    code += char;
  }
  if (currentString) {
    placeholders.push(currentString);
    code += `${prefix}${placeholders.length - 1}__`;
  }

  const processed = code
    .replace(/\bis\s+not\b/gi, "!=")
    .replace(/\bis\b/gi, "==");

  // Restore placeholders in a single pass to prevent recursive replacement corruption
  const restoreRegex = new RegExp(`${prefix}(\\d+)__`, "g");
  return processed.replace(restoreRegex, (_, idx) => placeholders[Number(idx)] ?? "");
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

interface StackItem {
  val: string;
  isVar: boolean;
}

function evaluateInstructions(
  instructions: EvalInstruction[],
  flags: Record<string, MockFlagValue>,
): ConditionEvaluationResult {
  const stack: StackItem[] = [];

  for (const inst of instructions) {
    if (inst.type === "IVAR") {
      const val = typeof inst.value === "string" ? inst.value : "";
      const lower = val.toLowerCase();
      if (lower === "true") {
        stack.push({ val: "true", isVar: false });
      } else if (lower === "false" || lower === "none" || lower === "null") {
        stack.push({ val: "false", isVar: false });
      } else if (val) {
        const flagVal = Object.hasOwn(flags, val) ? flags[val] : undefined;
        if (flagVal !== undefined) {
          stack.push({ val: flagVal, isVar: false });
        } else {
          stack.push({ val, isVar: true });
        }
      } else {
        stack.push({ val: "unknown", isVar: false });
      }
    } else if (inst.type === "IMEMBER") {
      const prop = typeof inst.value === "string" ? inst.value : "";
      const obj = stack.pop();
      if (!obj || obj.val === "unknown") {
        stack.push({ val: "unknown", isVar: false });
      } else {
        const combinedKey = `${obj.val}.${prop}`;
        const flagVal = Object.hasOwn(flags, combinedKey) ? flags[combinedKey] : undefined;
        if (flagVal !== undefined) {
          stack.push({ val: flagVal, isVar: false });
        } else if (obj.isVar) {
          stack.push({ val: combinedKey, isVar: true });
        } else {
          stack.push({ val: "unknown", isVar: false });
        }
      }
    } else if (inst.type === "INUMBER" || inst.type === "INUM" || inst.type === "ISTR") {
      const val = typeof inst.value === "string" ? inst.value : String(inst.value ?? "");
      const lower = val.toLowerCase();
      if (lower === "true") {
        stack.push({ val: "true", isVar: false });
      } else if (lower === "false") {
        stack.push({ val: "false", isVar: false });
      } else {
        stack.push({ val, isVar: false });
      }
    } else if (inst.type === "IEXPR") {
      if (Array.isArray(inst.value)) {
        const res = evaluateInstructions(inst.value as EvalInstruction[], flags);
        stack.push({ val: res, isVar: false });
      } else {
        stack.push({ val: "unknown", isVar: false });
      }
    } else if (inst.type === "IOP1") {
      const item = stack.pop();
      if (!item) {
        stack.push({ val: "unknown", isVar: false });
      } else {
        const op = typeof inst.value === "string" ? inst.value : "";
        if (op === "not" || op === "!") {
          if (item.val === "true") {
            stack.push({ val: "false", isVar: false });
          } else if (item.val === "false") {
            stack.push({ val: "true", isVar: false });
          } else {
            stack.push({ val: "unknown", isVar: false });
          }
        } else {
          stack.push({ val: "unknown", isVar: false });
        }
      }
    } else if (inst.type === "IOP2") {
      const right = stack.pop();
      const left = stack.pop();
      if (!left || !right) {
        stack.push({ val: "unknown", isVar: false });
      } else {
        const op = typeof inst.value === "string" ? inst.value : "";
        if (op === "and" || op === "&&") {
          if (left.val === "false" || right.val === "false") {
            stack.push({ val: "false", isVar: false });
          } else if (left.val === "true" && right.val === "true") {
            stack.push({ val: "true", isVar: false });
          } else {
            stack.push({ val: "unknown", isVar: false });
          }
        } else if (op === "or" || op === "||") {
          if (left.val === "true" || right.val === "true") {
            stack.push({ val: "true", isVar: false });
          } else if (left.val === "false" && right.val === "false") {
            stack.push({ val: "false", isVar: false });
          } else {
            stack.push({ val: "unknown", isVar: false });
          }
        } else if (op === "==" || op === "!=") {
          if (left.val === "unknown" || right.val === "unknown") {
            stack.push({ val: "unknown", isVar: false });
          } else if (left.isVar || right.isVar) {
            if (left.val === right.val) {
              stack.push({ val: op === "==" ? "true" : "false", isVar: false });
            } else {
              stack.push({ val: "unknown", isVar: false });
            }
          } else {
            const equal = left.val === right.val;
            const res = op === "==" ? equal : !equal;
            stack.push({ val: res ? "true" : "false", isVar: false });
          }
        } else if (op === "<" || op === ">" || op === "<=" || op === ">=") {
          const numL = Number(left.val);
          const numR = Number(right.val);
          if (!isNaN(numL) && !isNaN(numR)) {
            let res = false;
            if (op === "<") res = numL < numR;
            else if (op === ">") res = numL > numR;
            else if (op === "<=") res = numL <= numR;
            else if (op === ">=") res = numL >= numR;
            stack.push({ val: res ? "true" : "false", isVar: false });
          } else {
            stack.push({ val: "unknown", isVar: false });
          }
        } else {
          stack.push({ val: "unknown", isVar: false });
        }
      }
    }
  }

  const top = stack.pop();
  const result = top?.val ?? "unknown";
  return (result === "true" || result === "false") ? result : "unknown";
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
