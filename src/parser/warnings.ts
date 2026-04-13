import type { ParseGraphState, ParseWarning } from './pipelineTypes';

export function addParseWarning(
  state: ParseGraphState,
  warning: ParseWarning,
  warningId: string,
): void {
  if (state.warningIds.has(warningId)) return;
  state.warningIds.add(warningId);
  state.warnings.push(warning);
}
