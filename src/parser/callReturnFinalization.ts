import type { ParseGraphState } from './pipelineTypes';
import { addEdge } from './graphMutations';

export function materializeCallReturnEdges(state: ParseGraphState): void {
  for (const { returnTargetId, callTargetId } of state.pendingCallReturns) {
    const hasExplicitReturn = state.hasReliableReturnInLabel.has(callTargetId);
    if (!hasExplicitReturn) {
      continue;
    }
    addEdge(state, {
      id: `ret_${callTargetId}__${returnTargetId}`,
      source: callTargetId,
      target: returnTargetId,
      kind: 'call_return',
      label: 'return',
    });
  }
}
