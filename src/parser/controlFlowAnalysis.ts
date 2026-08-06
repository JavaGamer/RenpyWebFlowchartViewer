import type {
  ParseGraphState,
  PathVariableState,
  VariableValue,
} from "./pipelineTypes.ts";
import { addParseDiagnostic } from "./diagnostics.ts";
import {
  buildMockFlagsFromVariableState,
  evaluateConditionExpression,
} from "../domain/index.ts";

/**
 * Runs control-flow analysis on the finalized graph state.
 * Detects:
 * 1. Unreachable labels (orphans).
 * 2. Dialogue-less tight infinite cycles.
 * 3. Call-return mismatches.
 * 4. Path-aware variable state propagation and static condition evaluation.
 */
export function runControlFlowAnalysis(state: ParseGraphState): void {
  analyzeReachability(state);
  analyzeTightCycles(state);
  analyzeCallReturnMismatches(state);
  propagateVariableMutationsAndEvaluateConditions(state);
}

function analyzeReachability(state: ParseGraphState): void {
  const visited = new Set<string>();
  const queue: string[] = [];

  if (state.nodeMap.has("start")) {
    queue.push("start");
    visited.add("start");
  } else {
    // If no "start" label exists, start from all nodes with 0 incoming edges
    for (const node of state.nodes) {
      if (node.type === "LABEL" && !node.isShadowed) {
        const incoming = state.incomingByLabel.get(node.id);
        if (!incoming || incoming.size === 0) {
          queue.push(node.id);
          visited.add(node.id);
        }
      }
    }
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const outgoingEdges = state.edges.filter((e) => e.source === currId);
    for (const edge of outgoingEdges) {
      if (!visited.has(edge.target)) {
        if (state.nodeMap.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
  }

  for (const node of state.nodes) {
    if (node.type === "LABEL" && !node.isShadowed && !visited.has(node.id)) {
      node.isOrphan = true;
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          location: {
            chapter: node.chapter,
            construct: "label",
            sourceId: node.id,
          },
          context: {
            category: "unreachable_label",
            detail: node.label,
          },
          message: `Label "${node.label}" is unreachable from entry points.`,
          recoveryAction:
            "Ensure there is a jump, call, or sequence path to this label.",
        },
        `unreachable_label|${node.id}`,
      );
    }
  }
}

function analyzeTightCycles(state: ParseGraphState): void {
  const path = new Set<string>();
  const tempVisited = new Set<string>();

  function dfsCycle(nodeId: string, currentPath: string[]) {
    if (path.has(nodeId)) {
      const cycleStartIndex = currentPath.indexOf(nodeId);
      const cycle = currentPath.slice(cycleStartIndex);
      let hasInteraction = false;
      for (const id of cycle) {
        const node = state.nodeMap.get(id);
        if (node) {
          if (
            node.type === "MENU" ||
            node.dialogueCount > 0 ||
            (node.pauseDuration && node.pauseDuration > 0)
          ) {
            hasInteraction = true;
            break;
          }
        }
      }
      if (!hasInteraction) {
        const cycleLabels = cycle
          .map((id) => state.nodeMap.get(id)?.label ?? id)
          .join(" -> ");
        const cycleKey = [...cycle].sort().join("|");
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              sourceId: nodeId,
            },
            context: {
              category: "infinite_loop",
              detail: cycleLabels,
            },
            message: `Dialogue-less infinite loop detected: ${cycleLabels} -> ${
              state.nodeMap.get(nodeId)?.label ?? nodeId
            }`,
            recoveryAction:
              "Add a dialogue line, a menu choice, or a pause statement to break the tight loop.",
          },
          `infinite_loop|${cycleKey}`,
        );
      }
      return;
    }
    if (tempVisited.has(nodeId)) return;
    tempVisited.add(nodeId);
    path.add(nodeId);
    currentPath.push(nodeId);

    const outgoingEdges = state.edges.filter(
      (e) =>
        e.source === nodeId && (e.kind === "sequence" || e.kind === "jump"),
    );
    for (const edge of outgoingEdges) {
      dfsCycle(edge.target, currentPath);
    }

    currentPath.pop();
    path.delete(nodeId);
  }

  for (const node of state.nodes) {
    dfsCycle(node.id, []);
    tempVisited.clear();
  }
}

function analyzeCallReturnMismatches(state: ParseGraphState): void {
  function canReachReturn(startId: string): boolean {
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const currId = queue.shift()!;
      if (state.hasReturnInLabel.has(currId)) {
        return true;
      }
      const outgoingEdges = state.edges.filter(
        (e) =>
          e.source === currId && (e.kind === "sequence" || e.kind === "jump"),
      );
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
    return false;
  }

  for (const calledId of state.calledLabels) {
    if (!canReachReturn(calledId)) {
      const node = state.nodeMap.get(calledId);
      if (node) {
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              chapter: node.chapter,
              construct: "label",
              sourceId: calledId,
            },
            context: {
              category: "missing_return",
              detail: node.label,
            },
            message:
              `Called label "${node.label}" has no path to a return statement.`,
            recoveryAction:
              "Add a return statement at the end of the called label block.",
          },
          `missing_return|${calledId}`,
        );
      }
    }
  }

  for (const labelId of state.hasReturnInLabel) {
    if (!state.calledLabels.has(labelId) && labelId !== "start") {
      const node = state.nodeMap.get(labelId);
      if (node && node.role === "story") {
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              chapter: node.chapter,
              construct: "label",
              sourceId: labelId,
            },
            context: {
              category: "uncalled_return",
              detail: node.label,
            },
            message:
              `Label "${node.label}" contains a return statement but is never invoked via call.`,
            recoveryAction:
              "Verify if this label should be jumped to or called.",
          },
          `uncalled_return|${labelId}`,
        );
      }
    }
  }
}

function mergePathStates(
  existing: PathVariableState,
  incoming: PathVariableState,
): { merged: PathVariableState; changed: boolean } {
  let changed = false;
  const newVars = new Map(existing.variables);
  for (const [k, v] of incoming.variables.entries()) {
    if (!newVars.has(k) || newVars.get(k) !== v) {
      newVars.set(k, v);
      changed = true;
    }
  }
  const newPersist = new Map(existing.persistent);
  for (const [k, v] of incoming.persistent.entries()) {
    if (!newPersist.has(k) || newPersist.get(k) !== v) {
      newPersist.set(k, v);
      changed = true;
    }
  }
  return {
    merged: { variables: newVars, persistent: newPersist },
    changed,
  };
}

function propagateVariableMutationsAndEvaluateConditions(
  state: ParseGraphState,
): void {
  const startCanonicalId = state.canonicalLabelIdByName?.get("start");
  const entryId = (state.nodeMap.has("start") ? "start" : startCanonicalId) ??
    state.nodes[0]?.id;
  if (!entryId) return;

  const initialVars = new Map<string, VariableValue>();
  for (const [k, v] of state.globalLabelVariableLiteralTargets.entries()) {
    initialVars.set(k, v);
  }
  const initialPersist = new Map<string, VariableValue>();
  if (state.globalPersistentVariables) {
    for (const [k, v] of state.globalPersistentVariables.entries()) {
      initialPersist.set(k, v);
    }
  }

  const nodeStates = new Map<string, PathVariableState>();
  nodeStates.set(entryId, {
    variables: initialVars,
    persistent: initialPersist,
  });

  const queue: string[] = [entryId];
  const visitCounts = new Map<string, number>();

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const count = (visitCounts.get(currId) ?? 0) + 1;
    visitCounts.set(currId, count);
    if (count > 50) continue; // Loop guard for cyclic graphs

    const currState = nodeStates.get(currId)!;
    const nextState: PathVariableState = {
      variables: new Map(currState.variables),
      persistent: new Map(currState.persistent),
    };

    const mutations = state.nodeMutations?.get(currId);
    if (mutations) {
      for (const mut of mutations) {
        const store = mut.isPersistent
          ? nextState.persistent
          : nextState.variables;
        if (mut.operator === "=") {
          store.set(mut.variableName, mut.value);
        } else if (mut.operator === "+=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          const prev = typeof raw === "number"
            ? raw
            : (!isNaN(Number(raw)) ? Number(raw) : 0);
          store.set(mut.variableName, prev + mut.value);
        } else if (mut.operator === "-=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          const prev = typeof raw === "number"
            ? raw
            : (!isNaN(Number(raw)) ? Number(raw) : 0);
          store.set(mut.variableName, prev - mut.value);
        }
      }
    }

    const outgoing = state.edges.filter((e) => e.source === currId);
    for (const edge of outgoing) {
      if (edge.condition?.expression) {
        const mockFlags = buildMockFlagsFromVariableState(
          nextState.variables,
          nextState.persistent,
        );
        const res = evaluateConditionExpression(
          edge.condition.expression,
          mockFlags,
        );
        if (res === "false") {
          edge.conditionIsStaticallyFalse = true;
          continue; // Do not propagate along statically false branch
        }
      }

      const existingTargetState = nodeStates.get(edge.target);
      if (!existingTargetState) {
        nodeStates.set(edge.target, nextState);
        queue.push(edge.target);
      } else {
        const { merged, changed } = mergePathStates(
          existingTargetState,
          nextState,
        );
        if (changed) {
          nodeStates.set(edge.target, merged);
          queue.push(edge.target);
        }
      }
    }
  }
}
