import type { FlowEdge, ParseGraphState } from "./pipelineTypes.ts";
import { addEdge } from "./graphMutations.ts";

function labelOrScenesHaveReturn(
  state: ParseGraphState,
  callTargetId: string,
  outgoingMap: Map<string, FlowEdge[]>,
): boolean {
  if (state.hasReliableReturnInLabel.has(callTargetId)) {
    return true;
  }
  const baseName = callTargetId.includes("__scene_")
    ? callTargetId.split("__scene_")[0]
    : callTargetId;
  for (const labelId of state.hasReliableReturnInLabel) {
    if (labelId === baseName || labelId.startsWith(`${baseName}__scene_`)) {
      return true;
    }
  }

  // Transitive reachability check across sequence & jump edges using pre-computed outgoingMap
  const visited = new Set<string>();
  const queue: string[] = [callTargetId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);

    if (state.hasReliableReturnInLabel.has(curr)) {
      return true;
    }
    const currBase = curr.includes("__scene_")
      ? curr.split("__scene_")[0]
      : curr;
    for (const labelId of state.hasReliableReturnInLabel) {
      if (labelId === currBase || labelId.startsWith(`${currBase}__scene_`)) {
        return true;
      }
    }

    const outgoing = outgoingMap.get(curr) ?? [];
    for (const edge of outgoing) {
      if (edge.kind === "sequence" || edge.kind === "jump") {
        if (!visited.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }
  }

  return false;
}

export function materializeCallReturnEdges(state: ParseGraphState): void {
  const outgoingMap = new Map<string, FlowEdge[]>();
  for (const edge of state.edges) {
    let list = outgoingMap.get(edge.source);
    if (!list) {
      list = [];
      outgoingMap.set(edge.source, list);
    }
    list.push(edge);
  }

  for (const item of state.pendingCallReturns) {
    const {
      returnTargetId,
      callTargetId,
      callEdgeId,
      callContextId,
      arguments: callArgs,
    } = item;
    const hasExplicitReturn = labelOrScenesHaveReturn(
      state,
      callTargetId,
      outgoingMap,
    );
    if (!hasExplicitReturn) {
      continue;
    }
    const edgeId = callEdgeId
      ? `ret_${callTargetId}__${returnTargetId}__${callEdgeId}`
      : `ret_${callTargetId}__${returnTargetId}`;
    const ctxId = callContextId ?? `ctx_${callEdgeId ?? edgeId}`;
    addEdge(state, {
      id: edgeId,
      source: callTargetId,
      target: returnTargetId,
      kind: "call_return",
      label: "return",
      arguments: callArgs,
      callContext: {
        callContextId: ctxId,
        callEdgeId: callEdgeId ?? edgeId,
        callSiteId: returnTargetId,
        returnTargetId,
        arguments: callArgs,
      },
    });
  }
}
