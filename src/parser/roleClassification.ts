import type { FlowNode } from '../types';
import type { ParseGraphState, EdgeKind } from './pipelineTypes';

export function classifyNodeRole(state: ParseGraphState, node: FlowNode): FlowNode['role'] {
  if (node.type === 'MENU') return 'menu';

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
    return 'state_toggle';
  }
  if (isCalledFromMenuOption && hasReturn) {
    return 'detour';
  }
  if (isCalled && hasReturn && !hasStoryTraffic) {
    return 'utility';
  }
  return 'story';
}
