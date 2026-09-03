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
  extractConditionFlagRefs,
  type FlowEdge,
} from "../domain/index.ts";
import { splitBalancedArguments } from "./handlers/jumpCallArgs.ts";

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
  analyzeCallStackDepth(state, outgoingMap);
  analyzeCallReturnMismatches(state, outgoingMap);
  analyzeDeadStateAndUnusedFlags(state);
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
        } else if (mut.operator === "*=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          const prev = typeof raw === "number"
            ? raw
            : (!isNaN(Number(raw)) ? Number(raw) : 0);
          store.set(mut.variableName, prev * mut.value);
        } else if (mut.operator === "/=" && typeof mut.value === "number") {
          if (mut.value !== 0) {
            const raw = store.get(mut.variableName);
            const prev = typeof raw === "number"
              ? raw
              : (!isNaN(Number(raw)) ? Number(raw) : 0);
            store.set(mut.variableName, prev / mut.value);
          }
        } else if (mut.operator === "%=" && typeof mut.value === "number") {
          if (mut.value !== 0) {
            const raw = store.get(mut.variableName);
            const prev = typeof raw === "number"
              ? raw
              : (!isNaN(Number(raw)) ? Number(raw) : 0);
            store.set(mut.variableName, prev % mut.value);
          }
        } else if (mut.operator === "//=" && typeof mut.value === "number") {
          if (mut.value !== 0) {
            const raw = store.get(mut.variableName);
            const prev = typeof raw === "number"
              ? raw
              : (!isNaN(Number(raw)) ? Number(raw) : 0);
            store.set(mut.variableName, Math.floor(prev / mut.value));
          }
        } else if (mut.operator === "**=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          const prev = typeof raw === "number"
            ? raw
            : (!isNaN(Number(raw)) ? Number(raw) : 0);
          store.set(mut.variableName, Math.pow(prev, mut.value));
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

const RENPY_PYTHON_BUILTINS = new Set([
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
  "len",
  "str",
  "int",
  "float",
  "bool",
  "list",
  "dict",
  "set",
  "tuple",
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

const RENPY_ENGINE_NAMESPACES = new Set([
  "renpy",
  "config",
  "preferences",
  "gui",
]);

function isBuiltinOrInternalVariable(name: string): boolean {
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

function extractInterpolationVariables(text: string): string[] {
  if (!text || !text.includes("[")) return [];
  const results: string[] = [];
  const regex = /\[([A-Za-z_][A-Za-z0-9_.]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    results.push(m[1]!);
  }
  return results;
}

function analyzeDeadStateAndUnusedFlags(state: ParseGraphState): void {
  const declaredVariables = new Map<
    string,
    {
      chapter?: string;
      sourceId?: string;
      sourceLocation?: ParseGraphState["nodes"][0]["sourceLocation"];
    }
  >();

  // 1. Gather variables declared in define / default / top-level $
  if (state.initVariables) {
    for (const [varName, desc] of state.initVariables.entries()) {
      const chapter = desc.filePath
        ? desc.filePath.replace(/\\/g, "/").replace(/\.rpy$/i, "")
        : undefined;
      declaredVariables.set(varName, { chapter });
    }
  }

  if (state.globalCharacters) {
    for (const charName of state.globalCharacters) {
      if (!declaredVariables.has(charName)) {
        declaredVariables.set(
          charName,
          { construct: "character" } as unknown as { chapter?: string },
        );
      }
    }
  }

  // 2. Gather in-label variable mutations ($ var = ...)
  if (state.nodeMutations) {
    for (const [nodeId, mutations] of state.nodeMutations.entries()) {
      const node = state.nodeMap.get(nodeId);
      for (const m of mutations) {
        if (!declaredVariables.has(m.variableName)) {
          declaredVariables.set(m.variableName, {
            chapter: node?.chapter,
            sourceId: nodeId,
            sourceLocation: node?.sourceLocation,
          });
        }
      }
    }
  }

  // 3. Gather label parameters (e.g. label my_label(param1, param2=0):)
  for (const node of state.nodes) {
    if (node.parameters) {
      for (const p of node.parameters) {
        declaredVariables.set(p.name, {
          chapter: node.chapter,
          sourceId: node.id,
          sourceLocation: node.sourceLocation,
        });
      }
    }
  }

  const referencedVariables = new Set<string>();
  const conditionalReferences: Array<{
    varName: string;
    expression: string;
    sourceId?: string;
    edgeId?: string;
    sourceLocation?: ParseGraphState["nodes"][0]["sourceLocation"];
    chapter?: string;
  }> = [];

  // 4. Gather variable references from all parsed conditional expressions (if, elif, while, for, python)
  if (state.allConditionalExpressions) {
    for (const cond of state.allConditionalExpressions) {
      if (cond.expression) {
        if (cond.branchKind === "for") {
          const forMatch = /^([A-Za-z0-9_,\s]+)\s+in\s+(.+)$/.exec(
            cond.expression.trim(),
          );
          if (forMatch) {
            const targets = forMatch[1]!.split(",").map((t) => t.trim());
            for (const target of targets) {
              if (target && !declaredVariables.has(target)) {
                declaredVariables.set(target, {
                  chapter: cond.chapter,
                  sourceId: cond.sourceId,
                  sourceLocation: cond.sourceLocation,
                });
              }
            }
            const rhsRefs = extractConditionFlagRefs(forMatch[2]);
            for (const r of rhsRefs) {
              referencedVariables.add(r);
              conditionalReferences.push({
                varName: r,
                expression: cond.expression,
                sourceId: cond.sourceId,
                sourceLocation: cond.sourceLocation,
                chapter: cond.chapter,
              });
            }
            continue;
          }
        }

        const refs = extractConditionFlagRefs(cond.expression);
        for (const r of refs) {
          referencedVariables.add(r);
          conditionalReferences.push({
            varName: r,
            expression: cond.expression,
            sourceId: cond.sourceId,
            sourceLocation: cond.sourceLocation,
            chapter: cond.chapter,
          });
        }
      }
    }
  }

  // 5. Gather variable references from edge conditions & edge labels
  for (const edge of state.edges) {
    if (edge.condition?.expression) {
      const refs = extractConditionFlagRefs(edge.condition.expression);
      const sourceNode = state.nodeMap.get(edge.source);
      for (const r of refs) {
        referencedVariables.add(r);
        conditionalReferences.push({
          varName: r,
          expression: edge.condition.expression,
          sourceId: edge.source,
          edgeId: edge.id,
          sourceLocation: edge.sourceLocation ?? sourceNode?.sourceLocation,
          chapter: sourceNode?.chapter,
        });
      }
    }
    if (edge.label) {
      const interpolations = extractInterpolationVariables(edge.label);
      for (const interp of interpolations) {
        referencedVariables.add(interp);
      }
    }
  }

  // 6. Gather variable references from node conditions and dialogue
  for (const node of state.nodes) {
    if (node.condition?.expression) {
      const refs = extractConditionFlagRefs(node.condition.expression);
      for (const r of refs) {
        referencedVariables.add(r);
        conditionalReferences.push({
          varName: r,
          expression: node.condition.expression,
          sourceId: node.id,
          sourceLocation: node.sourceLocation,
          chapter: node.chapter,
        });
      }
    }
    if (node.label) {
      const interpolations = extractInterpolationVariables(node.label);
      for (const interp of interpolations) {
        referencedVariables.add(interp);
      }
    }
    if (node.dialogueLines) {
      for (const line of node.dialogueLines) {
        const interpolations = extractInterpolationVariables(line);
        for (const interp of interpolations) {
          referencedVariables.add(interp);
        }
      }
    }
  }

  // 7. Gather variable references from mutation expressions and init expressions (RHS)
  if (state.nodeMutations) {
    for (const mutations of state.nodeMutations.values()) {
      for (const m of mutations) {
        if (m.rawExpression) {
          const refs = extractConditionFlagRefs(m.rawExpression);
          for (const r of refs) {
            referencedVariables.add(r);
          }
        }
      }
    }
  }
  if (state.initVariables) {
    for (const desc of state.initVariables.values()) {
      if (desc.rawExpression) {
        const refs = extractConditionFlagRefs(desc.rawExpression);
        for (const r of refs) {
          referencedVariables.add(r);
        }
      }
    }
  }

  // 7. Check for unused variables/flags
  for (const [varName, loc] of declaredVariables.entries()) {
    if (isBuiltinOrInternalVariable(varName)) continue;
    const isReferenced = referencedVariables.has(varName) ||
      referencedVariables.has(`persistent.${varName}`) ||
      (varName.startsWith("persistent.") &&
        referencedVariables.has(varName.slice("persistent.".length)));

    if (!isReferenced) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          location: {
            chapter: loc.chapter,
            construct: "variable",
            sourceId: loc.sourceId,
            sourceLocation: loc.sourceLocation,
          },
          context: {
            category: "unused_variable",
            detail: varName,
          },
          message:
            `Variable/flag "${varName}" is declared or initialized but never evaluated in any conditional statement or dialogue.`,
          recoveryAction:
            "Remove the unused variable or verify if a conditional check or dialogue interpolation was intended.",
        },
        `unused_variable|${varName}`,
      );
    }
  }

  // 8. Check for undeclared conditional variables
  for (const condRef of conditionalReferences) {
    if (isBuiltinOrInternalVariable(condRef.varName)) continue;
    const isDeclared = declaredVariables.has(condRef.varName) ||
      declaredVariables.has(`persistent.${condRef.varName}`) ||
      (condRef.varName.startsWith("persistent.") &&
        declaredVariables.has(condRef.varName.slice("persistent.".length)));

    if (!isDeclared) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          location: {
            chapter: condRef.chapter,
            construct: "condition",
            sourceId: condRef.sourceId,
            edgeId: condRef.edgeId,
            targetExpression: condRef.expression,
            sourceLocation: condRef.sourceLocation,
          },
          context: {
            category: "undeclared_variable",
            detail: condRef.varName,
          },
          message:
            `Variable "${condRef.varName}" is evaluated in conditional expression ("${condRef.expression}") but is never assigned or declared in default/define blocks.`,
          recoveryAction:
            "Declare the variable using a default or define statement or assign it before evaluation.",
        },
        `undeclared_variable|${condRef.varName}|${condRef.expression}|${
          condRef.sourceId ?? ""
        }`,
      );
    }
  }
}

function analyzeCallStackDepth(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
  maxDepthLimit?: number,
): void {
  const maxDepth = state.maxCallStackDepth ?? maxDepthLimit ?? 50;

  const entryNodes = new Set<string>();
  const canonicalStart = state.canonicalLabelIdByName.get("start") ?? "start";
  if (state.nodeMap.has("start")) {
    entryNodes.add("start");
  } else if (state.nodeMap.has(canonicalStart)) {
    entryNodes.add(canonicalStart);
  }

  for (const node of state.nodes) {
    if (
      node.role === "story" &&
      (!state.incomingByLabel.has(node.id) ||
        state.incomingByLabel.get(node.id)!.size === 0)
    ) {
      entryNodes.add(node.id);
    }
  }

  for (const calledId of state.calledLabels) {
    entryNodes.add(calledId);
  }

  const maxDepthSeenAtNode = new Map<string, number>();

  for (const startId of entryNodes) {
    const stack: Array<{ nodeId: string; callStack: string[] }> = [
      { nodeId: startId, callStack: [] },
    ];

    while (stack.length > 0) {
      const { nodeId, callStack } = stack.pop()!;
      const currentDepth = callStack.length;

      const prevMax = maxDepthSeenAtNode.get(nodeId);
      if (prevMax !== undefined && prevMax >= currentDepth) {
        continue;
      }
      maxDepthSeenAtNode.set(nodeId, currentDepth);

      const outgoing = outgoingMap.get(nodeId) ?? [];
      for (const edge of outgoing) {
        if (edge.kind === "call") {
          const nextStack = [...callStack, edge.target];
          if (nextStack.length > maxDepth) {
            const targetNode = state.nodeMap.get(edge.target);
            const chainDisplay = nextStack
              .map((id) => state.nodeMap.get(id)?.label ?? id)
              .join(" -> ");
            addParseDiagnostic(
              state,
              {
                code: "normalization",
                severity: "warning",
                location: {
                  chapter: targetNode?.chapter,
                  construct: "call",
                  sourceId: edge.source,
                  targetId: edge.target,
                  edgeId: edge.id,
                  sourceLocation: edge.sourceLocation ??
                    targetNode?.sourceLocation,
                },
                context: {
                  category: "excessive_call_depth",
                  detail: `${nextStack.length} frames`,
                },
                message:
                  `Call stack depth (${nextStack.length}) exceeds safe limit (${maxDepth}): ${chainDisplay}`,
                recoveryAction:
                  "Refactor deep subroutine nesting into jumps or ensure returns pop call frames appropriately.",
              },
              `excessive_call_depth|${nextStack.join("|")}`,
            );
            continue;
          }
          stack.push({ nodeId: edge.target, callStack: nextStack });
        } else if (edge.kind === "call_return") {
          const nextStack = callStack.length > 0 ? callStack.slice(0, -1) : [];
          stack.push({ nodeId: edge.target, callStack: nextStack });
        } else {
          stack.push({ nodeId: edge.target, callStack });
        }
      }
    }
  }
}
