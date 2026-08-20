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

export function recordAssignmentInEnv(
  env: AbstractEnv,
  variable: string,
  expression: string,
) {
  const envSingleMap: Record<string, unknown> = {};
  for (const [k, set] of env.vars.entries()) {
    if (set.size === 1) {
      envSingleMap[k] = Array.from(set)[0];
    }
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
        recordAssignmentInEnv(env, assign.variable, assign.valueExpression);
      }
    }
  }

  // Evaluate target expression against tracked dataflow env
  const envSingleMap: Record<string, unknown> = {};
  if (state?.initVariables) {
    for (const [k, desc] of state.initVariables.entries()) {
      envSingleMap[k] = desc.value;
    }
  }
  for (const [k, set] of env.vars.entries()) {
    if (set.size === 1) {
      envSingleMap[k] = Array.from(set)[0];
    }
  }

  const evalRes = evaluatePythonAstExpression(targetExpression, envSingleMap);
  const results = new Set<string>();

  if (evalRes.isStaticallyEvaluated && typeof evalRes.value === "string") {
    results.add(evalRes.value);
  }
  for (const candidate of evalRes.stringCandidates) {
    results.add(candidate);
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
