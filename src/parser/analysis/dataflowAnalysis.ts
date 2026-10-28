import type {
  ParseGraphState,
  PathVariableState,
  VariableValue,
} from "../pipelineTypes.ts";
import { addParseDiagnostic } from "../diagnostics.ts";
import {
  buildMockFlagsFromVariableState,
  type CallArgument,
  evaluateConditionExpression,
  type FlowEdge,
  isPythonTruthy,
} from "../../domain/index.ts";
import {
  parseArgumentValue,
  parseForLoopSequenceValues,
} from "./cfaHelpers.ts";

export function mergePathStates(
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
  for (const [k, v] of existing.variables.entries()) {
    if (!incoming.variables.has(k) && v !== "unknown") {
      newVars.set(k, "unknown");
      changed = true;
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
  for (const [k, v] of existing.persistent.entries()) {
    if (!incoming.persistent.has(k) && v !== "unknown") {
      newPersist.set(k, "unknown");
      changed = true;
    }
  }
  return {
    merged: { variables: newVars, persistent: newPersist },
    changed,
  };
}

export function propagateVariableMutationsAndEvaluateConditions(
  state: ParseGraphState,
  outgoingMap: Map<string, FlowEdge[]>,
): void {
  const entryIds: string[] = [];
  const startCanonicalId = state.canonicalLabelIdByName?.get("start");
  const primaryStart = state.nodeMap.has("start") ? "start" : startCanonicalId;
  if (primaryStart) {
    entryIds.push(primaryStart);
  }
  for (const node of state.nodes) {
    if (node.type === "LABEL") {
      const incoming = state.incomingByLabel.get(node.id);
      const hasIncomingStory = Boolean(
        incoming?.has("sequence") || incoming?.has("jump"),
      );
      if (!hasIncomingStory && !entryIds.includes(node.id)) {
        entryIds.push(node.id);
      }
    }
  }
  if (entryIds.length === 0 && state.nodes[0]?.id) {
    entryIds.push(state.nodes[0].id);
  }
  if (entryIds.length === 0) return;

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
  for (const id of entryIds) {
    nodeStates.set(id, {
      variables: new Map(initialVars),
      persistent: new Map(initialPersist),
    });
  }

  const queue: string[] = [...entryIds];
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
        const applyStoreUpdate = (varName: string, newVal: VariableValue) => {
          if (mut.isConditional && store.has(varName)) {
            const existing = store.get(varName);
            if (existing !== newVal) {
              store.set(varName, "unknown");
              return;
            }
          }
          store.set(varName, newVal);
        };
        if (mut.operator === "=") {
          if (
            !mut.isLiteral &&
            typeof mut.value === "string" &&
            /^(?:not\b|[a-zA-Z_][a-zA-Z0-9_.]*\s*(?:==|!=|<|>|<=|>=|and|or)\s*)/
              .test(
                mut.value.trim(),
              )
          ) {
            const mockFlags = buildMockFlagsFromVariableState(
              nextState.variables,
              nextState.persistent,
            );
            const res = evaluateConditionExpression(mut.value, mockFlags);
            if (res === "true") {
              applyStoreUpdate(mut.variableName, true);
            } else if (res === "false") {
              applyStoreUpdate(mut.variableName, false);
            } else {
              applyStoreUpdate(mut.variableName, mut.value);
            }
          } else {
            applyStoreUpdate(mut.variableName, mut.value);
          }
        } else if (mut.operator === "+=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          if (raw === "unknown") {
            store.set(mut.variableName, "unknown");
          } else {
            const prev = typeof raw === "number"
              ? raw
              : (!isNaN(Number(raw)) ? Number(raw) : 0);
            applyStoreUpdate(mut.variableName, prev + mut.value);
          }
        } else if (mut.operator === "-=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          if (raw === "unknown") {
            store.set(mut.variableName, "unknown");
          } else {
            const prev = typeof raw === "number"
              ? raw
              : (!isNaN(Number(raw)) ? Number(raw) : 0);
            applyStoreUpdate(mut.variableName, prev - mut.value);
          }
        } else if (mut.operator === "*=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          if (raw === "unknown") {
            store.set(mut.variableName, "unknown");
          } else {
            const prev = typeof raw === "number"
              ? raw
              : (!isNaN(Number(raw)) ? Number(raw) : 0);
            applyStoreUpdate(mut.variableName, prev * mut.value);
          }
        } else if (mut.operator === "/=" && typeof mut.value === "number") {
          if (mut.value !== 0) {
            const raw = store.get(mut.variableName);
            if (raw === "unknown") {
              store.set(mut.variableName, "unknown");
            } else {
              const prev = typeof raw === "number"
                ? raw
                : (!isNaN(Number(raw)) ? Number(raw) : 0);
              applyStoreUpdate(mut.variableName, prev / mut.value);
            }
          }
        } else if (mut.operator === "%=" && typeof mut.value === "number") {
          if (mut.value !== 0) {
            const raw = store.get(mut.variableName);
            if (raw === "unknown") {
              store.set(mut.variableName, "unknown");
            } else {
              const prev = typeof raw === "number"
                ? raw
                : (!isNaN(Number(raw)) ? Number(raw) : 0);
              applyStoreUpdate(mut.variableName, prev % mut.value);
            }
          }
        } else if (mut.operator === "//=" && typeof mut.value === "number") {
          if (mut.value !== 0) {
            const raw = store.get(mut.variableName);
            if (raw === "unknown") {
              store.set(mut.variableName, "unknown");
            } else {
              const prev = typeof raw === "number"
                ? raw
                : (!isNaN(Number(raw)) ? Number(raw) : 0);
              applyStoreUpdate(mut.variableName, Math.floor(prev / mut.value));
            }
          }
        } else if (mut.operator === "**=" && typeof mut.value === "number") {
          const raw = store.get(mut.variableName);
          if (raw === "unknown") {
            store.set(mut.variableName, "unknown");
          } else {
            const prev = typeof raw === "number"
              ? raw
              : (!isNaN(Number(raw)) ? Number(raw) : 0);
            applyStoreUpdate(mut.variableName, Math.pow(prev, mut.value));
          }
        } else if (mut.operator === "toggle") {
          const raw = store.get(mut.variableName);
          if (raw === "unknown") {
            store.set(mut.variableName, "unknown");
          } else {
            const currentBool = isPythonTruthy(raw);
            applyStoreUpdate(mut.variableName, !currentBool);
          }
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
          continue; // Do not propagate along statically false branch in this iteration
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

  // Post-convergence pass: evaluate statically false conditions on finalized merged states
  for (const edge of state.edges) {
    if (!edge.condition?.expression) continue;
    const sourceState = nodeStates.get(edge.source);
    if (!sourceState) continue;

    const mockFlags = buildMockFlagsFromVariableState(
      sourceState.variables,
      sourceState.persistent,
    );
    const res = evaluateConditionExpression(
      edge.condition.expression,
      mockFlags,
    );
    if (res === "false") {
      edge.conditionIsStaticallyFalse = true;
      const sourceNode = state.nodeMap.get(edge.source);
      const isMenu = sourceNode?.type === "MENU";
      const targetNode = state.nodeMap.get(edge.target);
      const construct = isMenu ? "menu_option" : "condition";
      const optName = isMenu && edge.label ? ` "${edge.label}"` : "";
      const exprStr = edge.condition.expression;
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          location: {
            chapter: sourceNode?.chapter,
            construct,
            sourceId: edge.source,
            targetId: edge.target,
            edgeId: edge.id,
            targetExpression: exprStr,
            sourceLocation: edge.sourceLocation ??
              sourceNode?.sourceLocation,
          },
          context: {
            category: isMenu ? "dead_menu_option" : "dead_branch",
            detail: isMenu ? (edge.label || exprStr) : exprStr,
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
        `dead_branch|${edge.id}|${edge.source}|${edge.target}|${exprStr}`,
      );
    }
  }
}
