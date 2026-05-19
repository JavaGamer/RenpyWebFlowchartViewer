import type { FlowNode } from '../domain';
import type { ParseGraphState } from './pipelineTypes';

export function classifyNodeRole(state: ParseGraphState, node: FlowNode): FlowNode['role'] {
  if (node.type === 'MENU') return 'menu';
  if (node.type === 'DECISION') return 'decision';

  const incoming = state.incomingByLabel.get(node.id);
  const outgoing = state.outgoingByLabel.get(node.id);
  const hasReturn = state.hasReturnInLabel.has(node.id);
  const isCalled = state.calledLabels.has(node.id);
  const isCalledFromMenuOption = state.calledFromMenuOptionTargets.has(node.id);
  const hasStoryTraffic = Boolean(
    incoming?.has('sequence') ||
    outgoing?.has('sequence') ||
    incoming?.has('jump') ||
    outgoing?.has('jump'),
  );

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
