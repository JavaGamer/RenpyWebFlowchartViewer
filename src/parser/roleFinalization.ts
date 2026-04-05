import type { ParseGraphState } from './pipelineTypes';
import { materializeCallReturnEdges } from './callReturnFinalization';
import { classifyNodeRole } from './roleClassification';

export function finalizeRoles(state: ParseGraphState) {
  materializeCallReturnEdges(state);

  for (const node of state.nodes) {
    node.role = classifyNodeRole(state, node);
  }
}
