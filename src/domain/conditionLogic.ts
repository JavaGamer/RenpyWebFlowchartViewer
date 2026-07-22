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

function preprocessConditionExpression(expr: string): string {
  // Replace Python 'is not' / 'is' keywords while preserving string contents inside quotes
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
        code += `____STR_PH_${placeholders.length - 1}____`;
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
    code += `____STR_PH_${placeholders.length - 1}____`;
  }

  const processed = code
    .replace(/(?<=\s|^|\()is\s+not(?=\s|$|\))/gi, "!=")
    .replace(/(?<=\s|^|\()is(?=\s|$|\))/gi, "==");

  // Restore placeholders in a single pass to prevent recursive replacement corruption
  return processed.replace(/____STR_PH_(\d+)____/g, (_, idx) => placeholders[Number(idx)] ?? "");
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
      } else if (val) {
        const flagVal = Object.hasOwn(flags, val) ? flags[val] : undefined;
        stack.push(
          flagVal !== undefined ? flagVal : val,
        );
      } else {
        stack.push("unknown");
      }
    } else if (inst.type === "IMEMBER") {
      const prop = typeof inst.value === "string" ? inst.value : "";
      const obj = stack.pop() ?? "";
      const combinedKey = `${obj}.${prop}`;
      const flagVal = Object.hasOwn(flags, combinedKey) ? flags[combinedKey] : undefined;
      stack.push(flagVal !== undefined ? flagVal : combinedKey);
    } else if (inst.type === "INUMBER" || inst.type === "INUM" || inst.type === "ISTR") {
      const val = typeof inst.value === "string" ? inst.value : String(inst.value ?? "");
      const lower = val.toLowerCase();
      if (lower === "true") {
        stack.push("true");
      } else if (lower === "false") {
        stack.push("false");
      } else {
        stack.push(val);
      }
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
      if (!val) {
        stack.push("unknown");
      } else {
        const op = typeof inst.value === "string" ? inst.value : "";
        if (op === "not" || op === "!") {
          const isTrue = val === "true" || (val !== "false" && val !== "unknown" && !flags[val]);
          stack.push(
            val === "unknown" ? "unknown" : isTrue ? "false" : "true",
          );
        } else {
          stack.push("unknown");
        }
      }
    } else if (inst.type === "IOP2") {
      const right = stack.pop();
      const left = stack.pop();
      if (!left || !right) {
        stack.push("unknown");
      } else {
        const op = typeof inst.value === "string" ? inst.value : "";
        if (op === "and" || op === "&&") {
          if (left === "false" || right === "false") {
            stack.push("false");
          } else if (left === "true" && right === "true") {
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
            const equal = left === right;
            const res = op === "==" ? equal : !equal;
            stack.push(res ? "true" : "false");
          }
        } else if (op === "<" || op === ">" || op === "<=" || op === ">=") {
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
        } else {
          stack.push("unknown");
        }
      }
    }
  }

  const result = stack.pop() ?? "unknown";
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
