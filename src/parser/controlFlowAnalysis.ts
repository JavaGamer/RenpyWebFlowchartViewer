import type {
  ParseGraphState,
  PathVariableState,
  VariableValue,
} from "./pipelineTypes.ts";
import { addParseDiagnostic } from "./diagnostics.ts";
import {
  buildMockFlagsFromVariableState,
  type CallArgument,
  evaluateConditionExpression,
  type FlowEdge,
} from "../domain/index.ts";

function parseForLoopSequenceValues(
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
    const rawItems = rhs.substring(1, rhs.length - 1).split(",");
    const values: string[] = [];
    for (const item of rawItems) {
      const trimmed = item.trim().replace(/^["']|["']$/g, "");
      if (trimmed) values.push(trimmed);
    }
    if (values.length > 0) return { varName: primaryVar, values };
  }

  return null;
}

function parseArgumentValue(
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

import { verifyAssetIntegrity } from "./assetIntegrity.ts";

/**
 * Runs control-flow analysis on the finalized graph state.
 * Detects:
 * 1. Unreachable labels (orphans).
 * 2. Dialogue-less tight infinite cycles.
 * 3. Call-return mismatches and dangling stack subroutine fallthroughs.
 * 4. Recursive call stack deadlocks.
 * 5. Path-aware variable state propagation and static condition evaluation (dead branches).
 * 6. Asset integrity verification against project media files.
 */
export function runControlFlowAnalysis(
  state: ParseGraphState,
  projectMediaFiles?: ParseGraphState["projectMediaFiles"],
): void {
  const outgoingMap = new Map<string, FlowEdge[]>();
  for (const edge of state.edges) {
    let list = outgoingMap.get(edge.source);
    if (!list) {
      list = [];
      outgoingMap.set(edge.source, list);
    }
    list.push(edge);
  }

  analyzeReachability(state, outgoingMap);
  analyzeTightCycles(state, outgoingMap);
  analyzeCallCycles(state, outgoingMap);
  analyzeCallReturnMismatches(state, outgoingMap);
  propagateVariableMutationsAndEvaluateConditions(state, outgoingMap);
  verifyAssetIntegrity(state, projectMediaFiles);
}

function analyzeReachability(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const visited = new Set<string>();
  const queue: string[] = [];

  const canonicalStart = state.canonicalLabelIdByName.get("start") ?? "start";
  const startId = state.nodeMap.has("start")
    ? "start"
    : state.nodeMap.has(canonicalStart)
    ? canonicalStart
    : null;

  if (startId) {
    queue.push(startId);
    visited.add(startId);
  } else {
    // If no "start" label exists, start from all nodes with 0 incoming edges
    for (const node of state.nodes) {
      if (
        node.role === "story" &&
        (!state.incomingByLabel.has(node.id) ||
          state.incomingByLabel.get(node.id)!.size === 0)
      ) {
        queue.push(node.id);
        visited.add(node.id);
      }
    }
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const outgoing = outgoingMap.get(currId) ?? [];
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  for (const node of state.nodes) {
    if (
      node.role === "story" &&
      !visited.has(node.id)
    ) {
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
            sourceLocation: node.sourceLocation,
          },
          context: {
            category: "unreachable_label",
            detail: node.label,
          },
          message:
            `Label "${node.label}" is unreachable from start or any entry node.`,
          recoveryAction:
            "Add a jump or call to this label or verify entry point logic.",
        },
        `unreachable_label|${node.id}`,
      );
    }
  }
}

/**
 * Iterative stack-based 3-color DFS to detect dialogue-less tight infinite loops safely
 * without stack overflow or N^2 array scanning.
 */
function analyzeTightCycles(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const color = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  const stack: Array<{ nodeId: string; edgeIndex: number }> = [];
  const pathNodes: string[] = [];

  for (const node of state.nodes) {
    if ((color.get(node.id) ?? 0) !== 0) continue;

    color.set(node.id, 1);
    pathNodes.push(node.id);
    stack.push({ nodeId: node.id, edgeIndex: 0 });

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const outgoing = (outgoingMap.get(top.nodeId) ?? []).filter(
        (e) => e.kind === "sequence" || e.kind === "jump",
      );

      if (top.edgeIndex < outgoing.length) {
        const edge = outgoing[top.edgeIndex]!;
        top.edgeIndex += 1;
        const targetId = edge.target;
        const targetColor = color.get(targetId) ?? 0;

        if (targetColor === 1) {
          // Cycle detected!
          const cycleStartIndex = pathNodes.indexOf(targetId);
          if (cycleStartIndex !== -1) {
            const cycle = pathNodes.slice(cycleStartIndex);
            let hasInteraction = false;
            for (const id of cycle) {
              const n = state.nodeMap.get(id);
              if (
                n &&
                (n.type === "MENU" ||
                  n.dialogueCount > 0 ||
                  (n.pauseDuration && n.pauseDuration > 0) ||
                  n.role === "while_loop" ||
                  n.role === "for_loop")
              ) {
                hasInteraction = true;
                break;
              }
            }
            if (!hasInteraction) {
              const cycleLabels = cycle
                .map((id) => state.nodeMap.get(id)?.label ?? id)
                .join(" -> ");
              const cycleKey = [...cycle].sort().join("|");
              const targetNode = state.nodeMap.get(targetId);
              addParseDiagnostic(
                state,
                {
                  code: "normalization",
                  severity: "warning",
                  location: {
                    sourceId: targetId,
                    sourceLocation: targetNode?.sourceLocation,
                  },
                  context: {
                    category: "infinite_loop",
                    detail: cycleLabels,
                  },
                  message:
                    `Dialogue-less infinite loop detected: ${cycleLabels} -> ${
                      state.nodeMap.get(targetId)?.label ?? targetId
                    }`,
                  recoveryAction:
                    "Add a dialogue line, a menu choice, or a pause statement to break the tight loop.",
                },
                `infinite_loop|${cycleKey}`,
              );
            }
          }
        } else if (targetColor === 0) {
          color.set(targetId, 1);
          pathNodes.push(targetId);
          stack.push({ nodeId: targetId, edgeIndex: 0 });
        }
      } else {
        color.set(top.nodeId, 2);
        pathNodes.pop();
        stack.pop();
      }
    }
  }
}

/**
 * Detects recursive call cycles that lack base-case returns or interactive barriers.
 */
function analyzeCallCycles(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const color = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
  const stack: Array<{ nodeId: string; edgeIndex: number }> = [];
  const pathNodes: string[] = [];

  for (const node of state.nodes) {
    if ((color.get(node.id) ?? 0) !== 0) continue;

    color.set(node.id, 1);
    pathNodes.push(node.id);
    stack.push({ nodeId: node.id, edgeIndex: 0 });

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const outgoing = (outgoingMap.get(top.nodeId) ?? []).filter(
        (e) => e.kind === "call",
      );

      if (top.edgeIndex < outgoing.length) {
        const edge = outgoing[top.edgeIndex]!;
        top.edgeIndex += 1;
        const targetId = edge.target;
        const targetColor = color.get(targetId) ?? 0;

        if (targetColor === 1) {
          // Cycle detected!
          const cycleStartIndex = pathNodes.indexOf(targetId);
          if (cycleStartIndex !== -1) {
            const cycle = pathNodes.slice(cycleStartIndex);
            let hasExitOrReturn = false;
            for (const id of cycle) {
              if (
                state.hasReliableReturnInLabel.has(id) ||
                state.hasReturnInLabel.has(id)
              ) {
                hasExitOrReturn = true;
                break;
              }
              const edgesFromNode = outgoingMap.get(id) ?? [];
              const hasNonCallFlow = edgesFromNode.some(
                (e) =>
                  (e.kind === "jump" || e.kind === "sequence") &&
                  e.target !== id,
              );
              if (hasNonCallFlow) {
                hasExitOrReturn = true;
                break;
              }
            }

            if (!hasExitOrReturn) {
              const cycleLabels = cycle
                .map((id) => state.nodeMap.get(id)?.label ?? id)
                .join(" -> ");
              const cycleKey = [...cycle].sort().join("|");
              const targetNode = state.nodeMap.get(targetId);
              addParseDiagnostic(
                state,
                {
                  code: "normalization",
                  severity: "warning",
                  location: {
                    sourceId: targetId,
                    sourceLocation: targetNode?.sourceLocation,
                  },
                  context: {
                    category: "call_cycle_deadlock",
                    detail: cycleLabels,
                  },
                  message:
                    `Recursive call stack deadlock detected: ${cycleLabels} -> ${
                      targetNode?.label ?? targetId
                    } with no base-case return path.`,
                  recoveryAction:
                    "Ensure recursive subroutine calls have a conditional base case that reaches a return statement.",
                },
                `call_cycle_deadlock|${cycleKey}`,
              );
            }
          }
        } else if (targetColor === 0) {
          color.set(targetId, 1);
          pathNodes.push(targetId);
          stack.push({ nodeId: targetId, edgeIndex: 0 });
        }
      } else {
        color.set(top.nodeId, 2);
        pathNodes.pop();
        stack.pop();
      }
    }
  }
}

function analyzeCallReturnMismatches(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  function canReachReturn(startId: string): boolean {
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const currId = queue.shift()!;
      if (state.hasReturnInLabel.has(currId)) {
        return true;
      }
      const outgoingEdges = (outgoingMap.get(currId) ?? []).filter(
        (e) =>
          e.kind === "sequence" ||
          e.kind === "jump" ||
          e.kind === "call_return",
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

  function getBaseLabelId(id: string): string {
    return id.split("__scene_")[0]!;
  }

  const calledBaseLabels = new Set<string>();
  for (const c of state.calledLabels) {
    calledBaseLabels.add(getBaseLabelId(c));
  }

  const allCalledConstituentNodes = new Set<string>();
  for (const node of state.nodes) {
    if (calledBaseLabels.has(getBaseLabelId(node.id))) {
      allCalledConstituentNodes.add(node.id);
    }
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
              sourceLocation: node.sourceLocation,
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

  // Check for dangling stack across all constituent nodes of called subroutines
  for (const nodeId of allCalledConstituentNodes) {
    const outgoing = outgoingMap.get(nodeId) ?? [];
    for (const edge of outgoing) {
      if (
        edge.kind === "sequence" &&
        edge.label === "next" &&
        state.allLabelIds.has(edge.target) &&
        getBaseLabelId(edge.target) !== getBaseLabelId(nodeId)
      ) {
        const node = state.nodeMap.get(nodeId);
        const targetNode = state.nodeMap.get(edge.target);
        const displayLabel = node?.label ?? nodeId;
        addParseDiagnostic(
          state,
          {
            code: "normalization",
            severity: "warning",
            location: {
              chapter: node?.chapter,
              construct: "label",
              sourceId: nodeId,
              targetId: edge.target,
              edgeId: edge.id,
              sourceLocation: edge.sourceLocation ?? node?.sourceLocation,
            },
            context: {
              category: "dangling_stack",
              detail: displayLabel,
            },
            message: `Called label "${displayLabel}" falls through into "${
              targetNode?.label ?? edge.target
            }" without returning, leaving a dangling call stack frame.`,
            recoveryAction:
              "Add an explicit return statement before the label boundary or jump explicitly.",
          },
          `dangling_stack|${nodeId}|${edge.target}`,
        );
      }
    }
  }

  for (const labelId of state.hasReturnInLabel) {
    const baseId = getBaseLabelId(labelId);
    if (!calledBaseLabels.has(baseId) && baseId !== "start") {
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
              sourceLocation: node.sourceLocation,
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
    if (!newVars.has(k)) {
      newVars.set(k, v);
      changed = true;
    } else {
      const current = newVars.get(k);
      if (current !== v && current !== "unknown") {
        newVars.set(k, "unknown");
        changed = true;
      }
    }
  }
  const newPersist = new Map(existing.persistent);
  for (const [k, v] of incoming.persistent.entries()) {
    if (!newPersist.has(k)) {
      newPersist.set(k, v);
      changed = true;
    } else {
      const current = newPersist.get(k);
      if (current !== v && current !== "unknown") {
        newPersist.set(k, "unknown");
        changed = true;
      }
    }
  }
  return {
    merged: { variables: newVars, persistent: newPersist },
    changed,
  };
}

function propagateVariableMutationsAndEvaluateConditions(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const startCanonicalId = state.canonicalLabelIdByName?.get("start");
  const entryId = (state.nodeMap.has("start") ? "start" : startCanonicalId) ??
    state.nodes[0]?.id;
  if (!entryId) return;

  const initialVars = new Map<string, VariableValue>();
  const initialPersist = new Map<string, VariableValue>();
  if (state.initVariables) {
    for (const [k, v] of state.initVariables.entries()) {
      const val = typeof v.value === "string" ||
          typeof v.value === "boolean" ||
          typeof v.value === "number" ||
          v.value === null
        ? v.value
        : null;
      if (v.isPersistent) {
        if (!initialPersist.has(k)) {
          initialPersist.set(k, val);
        }
      } else {
        if (!initialVars.has(k)) {
          initialVars.set(k, val);
        }
      }
    }
  }
  for (const [k, v] of state.globalLabelVariableLiteralTargets.entries()) {
    initialVars.set(k, v);
  }
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

    const currNode = state.nodeMap.get(currId);
    if (currNode && currNode.condition?.branchKind === "for") {
      const parsedFor = parseForLoopSequenceValues(
        currNode.condition.expression,
      );
      if (parsedFor && parsedFor.values.length > 0) {
        nextState.variables.set(parsedFor.varName, parsedFor.values[0]!);
      }
    }

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
        } else if (mut.operator === "toggle") {
          const raw = store.get(mut.variableName);
          const currentBool = raw === true || raw === "true" || raw === "True";
          store.set(mut.variableName, !currentBool);
        }
      }
    }

    const outgoing = outgoingMap.get(currId) ?? [];
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
          const sourceNode = state.nodeMap.get(currId);
          const isMenu = sourceNode?.type === "MENU" || Boolean(edge.label);
          const targetNode = state.nodeMap.get(edge.target);
          const construct = isMenu ? "menu_option" : "condition";
          const optName = edge.label ? ` "${edge.label}"` : "";
          const exprStr = edge.condition.expression;
          addParseDiagnostic(
            state,
            {
              code: "normalization",
              severity: "warning",
              location: {
                chapter: sourceNode?.chapter,
                construct,
                sourceId: currId,
                targetId: edge.target,
                edgeId: edge.id,
                targetExpression: exprStr,
                sourceLocation: edge.sourceLocation ??
                  sourceNode?.sourceLocation,
              },
              context: {
                category: isMenu ? "dead_menu_option" : "dead_branch",
                detail: edge.label || exprStr,
              },
              message: isMenu
                ? `Menu option${optName} has a statically false condition (${exprStr}) and cannot be chosen.`
                : `Condition "${exprStr}" evaluates to statically false; branch to "${
                  targetNode?.label ?? edge.target
                }" is unreachable.`,
              recoveryAction: isMenu
                ? "Remove the unreachable menu option or update variable initializations/conditions."
                : "Verify condition expression or update variable assignments.",
            },
            `dead_branch|${edge.id}|${currId}|${edge.target}|${exprStr}`,
          );
          continue; // Do not propagate along statically false branch
        }
      }

      let edgeState = nextState;
      if (edge.kind === "call" && edge.arguments && edge.arguments.length > 0) {
        const targetNode = state.nodeMap.get(edge.target);
        if (targetNode && targetNode.parameters) {
          const newVars = new Map(nextState.variables);
          const positionalArgs = edge.arguments.filter((a) => !a.name);
          let posIndex = 0;
          for (let i = 0; i < targetNode.parameters.length; i++) {
            const param = targetNode.parameters[i]!;
            const kwArg = edge.arguments.find((a) => a.name === param.name);
            let valObj: CallArgument | undefined = kwArg;
            if (!valObj && posIndex < positionalArgs.length) {
              valObj = positionalArgs[posIndex++];
            }
            if (valObj) {
              newVars.set(
                param.name,
                parseArgumentValue(
                  valObj.value,
                  nextState.variables,
                  nextState.persistent,
                ),
              );
            } else if (param.defaultValue !== undefined) {
              newVars.set(
                param.name,
                parseArgumentValue(
                  param.defaultValue,
                  nextState.variables,
                  nextState.persistent,
                ),
              );
            }
          }
          edgeState = {
            variables: newVars,
            persistent: new Map(nextState.persistent),
          };
        }
      }

      const existingTargetState = nodeStates.get(edge.target);
      if (!existingTargetState) {
        nodeStates.set(edge.target, edgeState);
        queue.push(edge.target);
      } else {
        const { merged, changed } = mergePathStates(
          existingTargetState,
          edgeState,
        );
        if (changed) {
          nodeStates.set(edge.target, merged);
          queue.push(edge.target);
        }
      }
    }
  }
}
