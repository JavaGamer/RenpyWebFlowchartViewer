import type { MutationOperator } from "../domain/index.ts";
import type { ParseGraphState, ParseScanState } from "./pipelineTypes.ts";
import {
  evaluatePythonAstExpression,
  parsePythonBlock,
} from "./handlers/python/pythonAstParser.ts";

export interface AbstractEnv {
  vars: Map<string, Set<string>>;
}

export function createEmptyEnv(): AbstractEnv {
  return { vars: new Map() };
}

export function cloneEnv(env: AbstractEnv): AbstractEnv {
  const cloned = new Map<string, Set<string>>();
  for (const [k, v] of env.vars.entries()) {
    cloned.set(k, new Set(v));
  }
  return { vars: cloned };
}

export function mergeEnvs(envs: AbstractEnv[]): AbstractEnv {
  const merged = new Map<string, Set<string>>();
  for (const env of envs) {
    for (const [k, v] of env.vars.entries()) {
      let set = merged.get(k);
      if (!set) {
        set = new Set();
        merged.set(k, set);
      }
      for (const val of v) {
        set.add(val);
      }
    }
  }
  return { vars: merged };
}

function buildEnvSingleMap(
  env: AbstractEnv,
  baseMap?: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = baseMap ? { ...baseMap } : {};
  for (const [k, set] of env.vars.entries()) {
    if (set.size === 1) {
      const raw = Array.from(set)[0]!;
      if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
        result[k] = Number(raw);
      } else if (raw === "true" || raw === "True") {
        result[k] = true;
      } else if (raw === "false" || raw === "False") {
        result[k] = false;
      } else {
        result[k] = raw;
      }
    }
  }
  return result;
}

export function recordAssignmentInEnv(
  env: AbstractEnv,
  variable: string,
  expression: string,
  operator: MutationOperator = "=",
) {
  if (operator === "toggle") {
    const existing = env.vars.get(variable);
    if (existing && existing.size === 1) {
      const prevBool = Array.from(existing)[0] === "true" ||
        Array.from(existing)[0] === "True";
      env.vars.set(variable, new Set([String(!prevBool)]));
      return;
    }
    env.vars.delete(variable);
    return;
  }

  const envSingleMap = buildEnvSingleMap(env);

  if (
    operator === "+=" || operator === "-=" || operator === "*=" ||
    operator === "/=" || operator === "%=" || operator === "//=" ||
    operator === "**="
  ) {
    let rhsNum: number | undefined;
    const directNum = Number(expression);
    if (!isNaN(directNum) && expression.trim() !== "") {
      rhsNum = directNum;
    } else {
      const evalRes = evaluatePythonAstExpression(expression, envSingleMap);
      if (typeof evalRes.value === "number") {
        rhsNum = evalRes.value;
      } else if (
        evalRes.value !== undefined && !isNaN(Number(evalRes.value)) &&
        String(evalRes.value).trim() !== ""
      ) {
        rhsNum = Number(evalRes.value);
      }
    }

    if (rhsNum !== undefined && !isNaN(rhsNum)) {
      const existing = env.vars.get(variable);
      if (existing && existing.size === 1) {
        const prevNum = Number(Array.from(existing)[0]);
        if (!isNaN(prevNum)) {
          if (
            (operator === "/=" || operator === "%=" || operator === "//=") &&
            rhsNum === 0
          ) {
            env.vars.delete(variable);
            return;
          }
          let nextVal = prevNum;
          if (operator === "+=") nextVal = prevNum + rhsNum;
          else if (operator === "-=") nextVal = prevNum - rhsNum;
          else if (operator === "*=") nextVal = prevNum * rhsNum;
          else if (operator === "/=") nextVal = prevNum / rhsNum;
          else if (operator === "%=") nextVal = prevNum % rhsNum;
          else if (operator === "//=") nextVal = Math.floor(prevNum / rhsNum);
          else if (operator === "**=") nextVal = Math.pow(prevNum, rhsNum);
          env.vars.set(variable, new Set([String(nextVal)]));
          return;
        }
      }
    }

    if (operator === "+=") {
      const existing = env.vars.get(variable);
      if (existing && existing.size === 1) {
        const prevStr = Array.from(existing)[0]!;
        const evalRes = evaluatePythonAstExpression(expression, envSingleMap);
        if (typeof evalRes.value === "string") {
          env.vars.set(variable, new Set([prevStr + evalRes.value]));
          return;
        }
      }
    }

    // Indeterminate new value
    env.vars.delete(variable);
    return;
  }

  const evalRes = evaluatePythonAstExpression(expression, envSingleMap);
  const values = new Set<string>();

  if (
    evalRes.isStaticallyEvaluated && evalRes.value !== undefined &&
    evalRes.value !== null
  ) {
    values.add(String(evalRes.value));
  }
  for (const candidate of evalRes.stringCandidates) {
    values.add(candidate);
  }

  if (values.size > 0) {
    env.vars.set(variable, values);
  } else {
    env.vars.delete(variable);
  }
}

/**
 * Tracks variable assignments in Python statements / dollar lines within a block or label procedure
 * and resolves dynamic jump expressions against the tracked abstract environment.
 */
export function resolveDynamicTargetWithDataflow(
  targetExpression: string,
  scanState: ParseScanState,
  state?: ParseGraphState,
  blockCode?: string,
): string[] {
  const env = createEmptyEnv();

  // Load static init targets into env
  if (scanState.labelVariableLiteralTargets) {
    for (const [k, v] of scanState.labelVariableLiteralTargets.entries()) {
      env.vars.set(k, new Set([v]));
    }
  }
  if (state?.globalLabelVariableLiteralTargets) {
    for (const [k, v] of state.globalLabelVariableLiteralTargets.entries()) {
      if (!env.vars.has(k)) {
        env.vars.set(k, new Set([v]));
      }
    }
  }
  if (state?.initVariables) {
    for (const [k, desc] of state.initVariables.entries()) {
      if (typeof desc.value === "string" && !env.vars.has(k)) {
        env.vars.set(k, new Set([desc.value]));
      } else if (Array.isArray(desc.value) && !env.vars.has(k)) {
        env.vars.set(
          k,
          new Set(desc.value.filter((x): x is string => typeof x === "string")),
        );
      }
    }
  }
  if (state?.globalPersistentVariables) {
    for (const [k, v] of state.globalPersistentVariables.entries()) {
      if (typeof v === "string" && !env.vars.has(k)) {
        env.vars.set(k, new Set([v]));
      }
    }
  }

  // If block code is provided, parse python assignments in order
  if (blockCode) {
    const parsed = parsePythonBlock(blockCode);
    for (const assign of parsed.assignments) {
      if (assign.variable && assign.valueExpression) {
        recordAssignmentInEnv(
          env,
          assign.variable,
          assign.valueExpression,
          assign.operator,
        );
      }
    }
  }

  // Evaluate target expression against tracked dataflow env
  const initVarsMap: Record<string, unknown> = {};
  if (state?.initVariables) {
    for (const [k, desc] of state.initVariables.entries()) {
      initVarsMap[k] = desc.value;
    }
  }
  const envSingleMap = buildEnvSingleMap(env, initVarsMap);

  const evalRes = evaluatePythonAstExpression(targetExpression, envSingleMap);
  const results = new Set<string>();

  if (evalRes.isStaticallyEvaluated && typeof evalRes.value === "string") {
    results.add(evalRes.value);
  } else {
    for (const candidate of evalRes.stringCandidates) {
      if (
        state?.canonicalLabelIdByName?.has(candidate) ||
        state?.allLabelIds?.has(candidate) ||
        state?.nodeMap?.has(candidate) ||
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)
      ) {
        results.add(candidate);
      }
    }
  }

  // Also check direct variable lookup in env
  const trimmed = targetExpression.trim();
  const directVarValues = env.vars.get(trimmed);
  if (directVarValues) {
    for (const val of directVarValues) {
      results.add(val);
    }
  }

  return Array.from(results);
}
