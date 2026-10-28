import type { VariableValue } from "../pipelineTypes.ts";
import { splitBalancedArguments } from "../handlers/jumpCallArgs.ts";

export function parseForLoopSequenceValues(
  expression?: string,
): { varName: string; values: VariableValue[] } | null {
  if (!expression) return null;
  const match = /^([A-Za-z0-9_,\s]+)\s+in\s+(.+)$/.exec(expression.trim());
  if (!match) return null;
  const rawVarTarget = match[1]!.trim();
  const primaryVar = rawVarTarget.split(",")[0]!.trim();
  const rhs = match[2]!.trim();

  const rangeMatch = /^range\s*\(([^)]+)\)$/.exec(rhs);
  if (rangeMatch) {
    const parts = rangeMatch[1]!.split(",").map((p) => parseInt(p.trim(), 10));
    if (parts.length === 1 && !isNaN(parts[0]!)) {
      const limit = Math.min(parts[0]!, 1000);
      const values: number[] = [];
      for (let i = 0; i < limit; i++) values.push(i);
      return { varName: primaryVar, values };
    } else if (parts.length >= 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
      const start = parts[0]!;
      const stop = parts[1]!;
      const step = parts.length >= 3 && !isNaN(parts[2]!) ? parts[2]! : 1;
      const values: number[] = [];
      if (step > 0) {
        for (let i = start; i < stop && values.length < 1000; i += step) {
          values.push(i);
        }
      } else if (step < 0) {
        for (let i = start; i > stop && values.length < 1000; i += step) {
          values.push(i);
        }
      }
      return { varName: primaryVar, values };
    }
  }

  if (rhs.startsWith("[") && rhs.endsWith("]")) {
    const rawItems = splitBalancedArguments(rhs.substring(1, rhs.length - 1));
    const values: string[] = [];
    for (const item of rawItems) {
      const trimmed = item.trim().replace(/^["']|["']$/g, "");
      if (trimmed) values.push(trimmed);
    }
    if (values.length > 0) return { varName: primaryVar, values };
  }

  return null;
}

export function parseArgumentValue(
  valStr: string,
  variables?: Map<string, VariableValue>,
  persistent?: Map<string, VariableValue>,
): VariableValue {
  const trimmed = valStr.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed !== "" && !isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  if (trimmed === "True" || trimmed === "true") return true;
  if (trimmed === "False" || trimmed === "false") return false;
  if (variables && variables.has(trimmed)) {
    return variables.get(trimmed)!;
  }
  if (persistent && persistent.has(trimmed)) {
    return persistent.get(trimmed)!;
  }
  return trimmed;
}

export const RENPY_PYTHON_BUILTINS = new Set([
  "renpy",
  "config",
  "persistent",
  "preferences",
  "gui",
  "main_menu",
  "_return",
  "_rollback",
  "_in_replay",
  "_window",
  "_window_during_transitions",
  "_menu",
  "_history",
  "_voice",
  "narrator",
  "adv",
  "nvl",
  "True",
  "False",
  "None",
  "true",
  "false",
  "none",
  "null",
  "str",
  "int",
  "float",
  "bool",
  "list",
  "dict",
  "set",
  "tuple",
  "len",
  "range",
  "min",
  "max",
  "abs",
  "round",
  "hasattr",
  "getattr",
  "setattr",
  "isinstance",
  "issubclass",
  "any",
  "all",
  "zip",
  "enumerate",
  "sorted",
  "reversed",
]);

export const RENPY_ENGINE_NAMESPACES = new Set([
  "renpy",
  "config",
  "preferences",
  "gui",
  "persistent",
]);

export function isBuiltinOrInternalVariable(name: string): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.startsWith("_")) return true;
  if (
    RENPY_PYTHON_BUILTINS.has(trimmed) ||
    RENPY_PYTHON_BUILTINS.has(trimmed.toLowerCase())
  ) {
    return true;
  }
  const root = trimmed.split(".")[0]!;
  if (
    RENPY_ENGINE_NAMESPACES.has(root) ||
    RENPY_ENGINE_NAMESPACES.has(root.toLowerCase())
  ) {
    return true;
  }
  return false;
}

export function extractInterpolationVariables(text: string): string[] {
  if (!text || !text.includes("[")) return [];
  const results: string[] = [];
  const regex = /\[([A-Za-z_][A-Za-z0-9_.]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    results.push(m[1]!);
  }
  return results;
}
