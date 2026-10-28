import { isPythonTruthy } from "./evalLiteral.ts";

export function evalSubscript(
  target: unknown,
  index: unknown,
  stringCandidates: string[],
): { value: unknown; ok: boolean } {
  if (Array.isArray(target) && typeof index === "number") {
    const normalizedIdx = index < 0 ? target.length + index : index;
    const val = target[normalizedIdx];
    if (typeof val === "string") stringCandidates.push(val);
    return { value: val, ok: true };
  }
  if (typeof target === "string" && typeof index === "number") {
    const normalizedIdx = index < 0 ? target.length + index : index;
    const val = target[normalizedIdx];
    if (typeof val === "string") stringCandidates.push(val);
    return { value: val, ok: true };
  }
  if (typeof target === "object" && target !== null) {
    const val = (target as Record<string, unknown>)[String(index)];
    if (typeof val === "string") stringCandidates.push(val);
    return { value: val, ok: true };
  }
  return { value: undefined, ok: false };
}

export function collectCandidateStringsFromTarget(
  target: unknown,
  stringCandidates: string[],
): void {
  if (Array.isArray(target)) {
    for (const item of target) {
      if (typeof item === "string") stringCandidates.push(item);
    }
  } else if (typeof target === "object" && target !== null) {
    for (const item of Object.values(target)) {
      if (typeof item === "string") stringCandidates.push(item);
    }
  }
}

export function evalMemberAccess(
  obj: unknown,
  propName: string,
  stringCandidates: string[],
): { value: unknown; ok: boolean } {
  if (typeof obj === "object" && obj !== null) {
    const val = (obj as Record<string, unknown>)[propName];
    if (typeof val === "string") stringCandidates.push(val);
    return { value: val, ok: true };
  }
  return { value: undefined, ok: false };
}

export function evalBuiltinCall(
  calleeText: string,
  evaluatedArgs: unknown[],
): { value: unknown; ok: boolean } {
  if (calleeText === "str" && evaluatedArgs.length === 1) {
    return { value: String(evaluatedArgs[0]), ok: true };
  }
  if (calleeText === "int" && evaluatedArgs.length === 1) {
    const num = Number(evaluatedArgs[0]);
    return { value: num, ok: !isNaN(num) };
  }
  if (calleeText === "bool" && evaluatedArgs.length === 1) {
    return { value: isPythonTruthy(evaluatedArgs[0]), ok: true };
  }
  if (calleeText === "len" && evaluatedArgs.length === 1) {
    const argVal = evaluatedArgs[0];
    if (typeof argVal === "string" || Array.isArray(argVal)) {
      return { value: argVal.length, ok: true };
    }
    if (argVal instanceof Set || argVal instanceof Map) {
      return { value: argVal.size, ok: true };
    }
  }
  return { value: undefined, ok: false };
}
