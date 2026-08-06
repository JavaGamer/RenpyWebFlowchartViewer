import type { ParseGraphState } from "./pipelineTypes.ts";
import { addEdge } from "./graphMutations.ts";

export function materializeCallReturnEdges(state: ParseGraphState): void {
  for (const item of state.pendingCallReturns) {
    const {
      returnTargetId,
      callTargetId,
      callEdgeId,
      callContextId,
      arguments: callArgs,
    } = item;
    const hasExplicitReturn =
      state.hasReliableReturnInLabel.has(callTargetId);
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
