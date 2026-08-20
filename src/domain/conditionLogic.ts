import { Parser } from "expr-eval-fork";
import {
  evaluatePythonAstExpression,
  isPythonTruthy,
} from "./pythonAstEvaluator.ts";
import { parser as pythonParser } from "@lezer/python";

export type MockFlagValue = "true" | "false" | "unknown";
export type ConditionEvaluationResult = "true" | "false" | "unknown";
export type ConditionBranchState =
  | "normal"
  | "taken"
  | "unreachable"
  | "unknown";

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
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?<!\.)\bis\s+not\b|(?<!\.)\bis\b/gi,
    (match) => {
      if (match.startsWith('"') || match.startsWith("'")) return match;
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
  const trimmed = expression.trim();
  try {
    let refs = flagRefsCache.get(trimmed);
    if (!refs) {
      const KEYWORDS = new Set([
        "true",
        "false",
        "none",
        "null",
        "and",
        "or",
        "not",
        "is",
        "in",
        "len",
        "str",
        "int",
        "bool",
        "if",
        "else",
        "for",
        "while",
        "return",
        "pass",
      ]);
      const foundVars = new Set<string>();

      try {
        const tree = pythonParser.parse(trimmed);
        tree.iterate({
          enter(nodeRef) {
            const node = nodeRef.node;
            if (node.name === "VariableName") {
              const name = trimmed.slice(node.from, node.to);
              if (!KEYWORDS.has(name.toLowerCase())) {
                foundVars.add(name);
              }
            } else if (node.name === "MemberExpression") {
              const fullText = trimmed.slice(node.from, node.to);
              if (!KEYWORDS.has(fullText.toLowerCase())) {
                foundVars.add(fullText);
              }
            }
          },
        });
      } catch {
        // Fallback to expr-eval if Lezer fails
        const preprocessed = preprocessConditionExpression(trimmed);
        const vars = parser.parse(preprocessed).variables();
        vars.forEach((v) => {
          if (!KEYWORDS.has(v.toLowerCase())) foundVars.add(v);
        });
      }

      refs = Array.from(foundVars).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      flagRefsCache.set(trimmed, refs);
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
          const normalizeForCompare = (s: string) => {
            const low = s.trim().toLowerCase();
            if (low === "true") return 1;
            if (low === "false") return 0;
            return isNumericStr(s) ? Number(s) : s;
          };
          const nL = normalizeForCompare(left);
          const nR = normalizeForCompare(right);
          const equal = nL === nR;
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

export function evaluateConditionBranch(
  branch: string,
  conditionExpression: string | undefined,
  flags: Record<string, MockFlagValue>,
): ConditionBranchState {
  if (branch === "unconditional") return "normal";
  if (!conditionExpression) return "normal";

  const result = evaluateConditionExpression(conditionExpression, flags);
  if (result === "unknown") return "unknown";

  if (branch === "true" || branch === "if") {
    return result === "true" ? "taken" : "unreachable";
  }
  if (branch === "false" || branch === "else") {
    return result === "false" ? "taken" : "unreachable";
  }

  return "normal";
}

export function evaluateAllConditionBranches(
  conditionExpression: string | undefined,
  flags: Record<string, MockFlagValue>,
): { ifBranch: ConditionBranchState; elseBranch: ConditionBranchState } {
  return {
    ifBranch: evaluateConditionBranch("if", conditionExpression, flags),
    elseBranch: evaluateConditionBranch("else", conditionExpression, flags),
  };
}

export function getEffectiveConditionState(
  states: ConditionBranchState[],
): ConditionBranchState {
  if (states.length === 0) return "normal";
  if (states.every((s) => s === "unreachable")) return "unreachable";
  if (states.some((s) => s === "taken")) return "taken";
  if (states.some((s) => s === "unknown")) return "unknown";
  return "normal";
}

export function invertMockFlagValue(val: MockFlagValue): MockFlagValue {
  if (val === "true") return "false";
  if (val === "false") return "true";
  return "unknown";
}

export function toggleMockFlagValue(val: MockFlagValue): MockFlagValue {
  if (val === "unknown") return "true";
  if (val === "true") return "false";
  return "unknown";
}

export function evaluateSimpleCondition(
  expression: string | undefined,
  flagState: boolean | undefined,
): "true" | "false" | "unknown" {
  if (flagState === undefined) return "unknown";
  if (!expression || expression.trim().length === 0) return "unknown";
  const trimmed = expression.trim();
  if (trimmed.startsWith("not ") || trimmed.startsWith("!")) {
    return flagState ? "false" : "true";
  }
  return flagState ? "true" : "false";
}

export function shouldTraverseBranch(
  branch: string,
  conditionExpression: string | undefined,
  flags: Record<string, MockFlagValue>,
): boolean {
  const state = evaluateConditionBranch(branch, conditionExpression, flags);
  return state !== "unreachable";
}

export function isFlagConditionMet(
  flagName: string,
  requiredValue: boolean,
  flags: Record<string, MockFlagValue>,
): boolean {
  const val = flags[flagName];
  if (val === undefined || val === "unknown") return false;
  const boolVal = val === "true";
  return boolVal === requiredValue;
}

export function formatConditionSummary(
  expression: string | undefined,
  flags: Record<string, MockFlagValue>,
): string {
  if (!expression) return "";
  const refs = extractConditionFlagRefs(expression);
  if (refs.length === 0) return expression;
  const parts: string[] = [];
  for (const r of refs) {
    const val = flags[r] ?? "unknown";
    parts.push(`${r}=${val}`);
  }
  return `${expression} [${parts.join(", ")}]`;
}

export function countEvaluatedConditions(
  expressions: (string | undefined)[],
  flags: Record<string, MockFlagValue>,
): { taken: number; unreachable: number; unknown: number } {
  let taken = 0;
  let unreachable = 0;
  let unknown = 0;

  for (const expr of expressions) {
    if (!expr) continue;
    const res = evaluateConditionExpression(expr, flags);
    if (res === "true") taken++;
    else if (res === "false") unreachable++;
    else unknown++;
  }

  return { taken, unreachable, unknown };
}

export function createEmptyMockFlags(): Record<string, MockFlagValue> {
  return {};
}

export function mergeMockFlags(
  base: Record<string, MockFlagValue>,
  override: Record<string, MockFlagValue>,
): Record<string, MockFlagValue> {
  return { ...base, ...override };
}

export function filterFlagsByExpression(
  expression: string | undefined,
  flags: Record<string, MockFlagValue>,
): Record<string, MockFlagValue> {
  if (!expression) return {};
  const refs = extractConditionFlagRefs(expression);
  const result: Record<string, MockFlagValue> = {};
  for (const r of refs) {
    if (r in flags) {
      result[r] = flags[r]!;
    }
  }
  return result;
}

export function serializeMockFlags(
  flags: Record<string, MockFlagValue>,
): string {
  const entries = Object.entries(flags).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

export function deserializeMockFlags(
  json: string,
): Record<string, MockFlagValue> {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, MockFlagValue>;
  } catch {
    return {};
  }
}

export function areMockFlagsEqual(
  a: Record<string, MockFlagValue>,
  b: Record<string, MockFlagValue>,
): boolean {
  return serializeMockFlags(a) === serializeMockFlags(b);
}

export function getMockFlagStateClass(val: MockFlagValue): string {
  if (val === "true") return "text-emerald-500 font-semibold";
  if (val === "false") return "text-rose-500 font-semibold";
  return "text-gray-400";
}

export function getConditionBranchLabel(
  branch: string,
  expression?: string,
): string {
  if (branch === "unconditional") return "";
  if (branch === "if" || branch === "true") {
    return expression ? `if ${expression}` : "if";
  }
  if (branch === "else" || branch === "false") {
    return expression ? `else (${expression})` : "else";
  }
  if (branch === "elif") {
    return expression ? `elif ${expression}` : "elif";
  }
  return branch;
}

export function isStaticConditionResolvable(
  expression: string | undefined,
  knownVariables: Set<string>,
): boolean {
  if (!expression || expression.trim().length === 0) return true;
  const refs = extractConditionFlagRefs(expression);
  return refs.every((r) => knownVariables.has(r));
}

export function evaluateConditionWithDefaults(
  expression: string | undefined,
  flags: Record<string, MockFlagValue>,
  defaultVal: MockFlagValue = "unknown",
): "true" | "false" | "unknown" {
  if (!expression) return defaultVal;
  const res = evaluateConditionExpression(expression, flags);
  return res === "unknown" ? defaultVal : res;
}

export function combineConditionResults(
  results: ConditionEvaluationResult[],
  op: "and" | "or" = "and",
): ConditionEvaluationResult {
  if (results.length === 0) return "unknown";
  if (op === "and") {
    if (results.some((r) => r === "false")) return "false";
    if (results.every((r) => r === "true")) return "true";
    return "unknown";
  } else {
    if (results.some((r) => r === "true")) return "true";
    if (results.every((r) => r === "false")) return "false";
    return "unknown";
  }
}

export function areAllFlagsKnownAndTrue(
  flags: Record<string, MockFlagValue>,
): boolean {
  for (const v of Object.values(flags)) {
    if (v !== "true") return false;
  }
  return true;
}

export function isExpressionAlwaysTrue(
  expression: string | undefined,
): boolean {
  if (!expression || expression.trim().length === 0) return true;
  const trimmed = expression.trim();
  if (trimmed === "True" || trimmed === "true" || trimmed === "1") return true;
  const astRes = evaluatePythonAstExpression(trimmed, {});
  if (astRes.isStaticallyEvaluated) {
    return isPythonTruthy(astRes.value);
  }
  return false;
}

export function isExpressionAlwaysFalse(
  expression: string | undefined,
): boolean {
  if (!expression || expression.trim().length === 0) return false;
  const trimmed = expression.trim();
  if (trimmed === "False" || trimmed === "false" || trimmed === "0") {
    return true;
  }
  const astRes = evaluatePythonAstExpression(trimmed, {});
  if (astRes.isStaticallyEvaluated) {
    return !isPythonTruthy(astRes.value);
  }
  return false;
}

export function areAllFlagsKnown(
  flags: Record<string, MockFlagValue>,
): boolean {
  for (const v of Object.values(flags)) {
    if (v === "unknown") return false;
  }
  return true;
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
