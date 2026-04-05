import type { ParseGraphState, EdgeKind } from './pipelineTypes';
import { addEdge } from './graphMutations';

export function finalizeRoles(state: ParseGraphState) {
  for (const { callerLabelId, callTargetId } of state.pendingCallReturns) {
    addEdge(state, {
      id: `ret_${callTargetId}__${callerLabelId}`,
      source: callTargetId,
      target: callerLabelId,
      kind: 'call_return',
      label: 'return',
    });
  }

  for (const node of state.nodes) {
    if (node.type === 'MENU') {
      node.role = 'menu';
      continue;
    }

    const incoming = state.incomingByLabel.get(node.id) ?? new Set<EdgeKind>();
    const outgoing = state.outgoingByLabel.get(node.id) ?? new Set<EdgeKind>();
    const hasReturn = state.hasReturnInLabel.has(node.id);
    const isCalled = state.calledLabels.has(node.id);
    const isCalledFromMenuOption = state.calledFromMenuOptionTargets.has(node.id);
    const hasStoryTraffic =
      incoming.has('sequence') ||
      outgoing.has('sequence') ||
      incoming.has('jump') ||
      outgoing.has('jump');

    if (hasReturn && !hasStoryTraffic && !isCalled) {
      node.role = 'state_toggle';
    } else if (isCalledFromMenuOption && hasReturn) {
      node.role = 'detour';
    } else if (isCalled && hasReturn && !hasStoryTraffic) {
      node.role = 'utility';
    } else {
      node.role = 'story';
    }
  }
}
