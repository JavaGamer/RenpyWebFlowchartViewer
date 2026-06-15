import type { ParseDiagnostic, ParseGraphState } from "./pipelineTypes";

export function addParseDiagnostic(
  state: ParseGraphState,
  diagnostic: ParseDiagnostic,
  diagnosticId: string,
): void {
  if (state.diagnosticIds.has(diagnosticId)) return;
  state.diagnosticIds.add(diagnosticId);
  state.diagnostics.push(diagnostic);
}
