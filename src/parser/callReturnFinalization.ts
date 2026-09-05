import type { ParseGraphState } from "./pipelineTypes.ts";
import { addEdge } from "./graphMutations.ts";

function findReturningNodes(
  state: ParseGraphState,
  callTargetId: string,
): string[] {
  const returnSources = new Set<string>();

  if (state.hasReliableReturnInLabel.has(callTargetId)) {
    returnSources.add(callTargetId);
  }
  const baseName = callTargetId.includes("__scene_")
    ? callTargetId.split("__scene_")[0]
    : callTargetId;
  for (const labelId of state.hasReliableReturnInLabel) {
    if (labelId === baseName || labelId.startsWith(`${baseName}__scene_`)) {
      returnSources.add(labelId);
    } else {
      const node = state.nodeMap.get(labelId);
      if (
        node &&
        (node.parentLabelId === baseName ||
          (node.parentLabelId &&
            node.parentLabelId.startsWith(`${baseName}__scene_`)))
      ) {
        returnSources.add(labelId);
      }
    }
  }

  return Array.from(returnSources);
}

export function materializeCallReturnEdges(state: ParseGraphState): void {
  for (const item of state.pendingCallReturns) {
    const rawReturnTargetId = item.returnTargetId;
    const rawCallTargetId = item.callTargetId;
    const {
      callEdgeId,
      callContextId,
      arguments: callArgs,
    } = item;
    const callTargetId = (!state.nodeMap.has(rawCallTargetId) &&
        state.canonicalLabelIdByName?.has(rawCallTargetId))
      ? state.canonicalLabelIdByName.get(rawCallTargetId)!
      : rawCallTargetId;
    const returnTargetId = (rawReturnTargetId &&
        !state.nodeMap.has(rawReturnTargetId) &&
        state.canonicalLabelIdByName?.has(rawReturnTargetId))
      ? state.canonicalLabelIdByName.get(rawReturnTargetId)!
      : rawReturnTargetId;
    const returningNodes = findReturningNodes(
      state,
      callTargetId,
    );
    if (returningNodes.length === 0) {
      continue;
    }
    for (const retSrc of returningNodes) {
      const edgeId = callEdgeId
        ? `ret_${retSrc}__${returnTargetId}__${callEdgeId}`
        : `ret_${retSrc}__${returnTargetId}`;
      const ctxId = callContextId ?? `ctx_${callEdgeId ?? edgeId}`;
      addEdge(state, {
        id: edgeId,
        source: retSrc,
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
}
