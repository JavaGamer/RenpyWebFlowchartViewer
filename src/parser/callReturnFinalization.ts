import type { ParseGraphState } from './pipelineTypes';
import { addEdge } from './graphMutations';

export function materializeCallReturnEdges(state: ParseGraphState): void {
  for (const { callerLabelId, callTargetId } of state.pendingCallReturns) {
    const hasExplicitReturn = state.hasReturnInLabel.has(callTargetId);
    const calleeOutgoing = state.outgoingByLabel.get(callTargetId);
    const hasHardExitJump = calleeOutgoing?.has('jump') ?? false;
    if (!hasExplicitReturn || hasHardExitJump) {
      continue;
    }
    addEdge(state, {
      id: `ret_${callTargetId}__${callerLabelId}`,
      source: callTargetId,
      target: callerLabelId,
      kind: 'call_return',
      label: 'return',
    });
  }
}
