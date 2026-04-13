import type { ParseGraphState } from './pipelineTypes';
import { materializeCallReturnEdges } from './callReturnFinalization';
import { classifyNodeRole } from './roleClassification';
import { normalizeGraphState } from './graphNormalization';

export function finalizeRoles(state: ParseGraphState) {
  materializeCallReturnEdges(state);
  normalizeGraphState(state);

  for (const node of state.nodes) {
    node.role = classifyNodeRole(state, node);
  }
}
