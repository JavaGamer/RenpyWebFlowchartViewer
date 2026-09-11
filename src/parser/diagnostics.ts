import type { ParseDiagnostic, ParseGraphState } from "./pipelineTypes.ts";

const MAX_PARSER_DIAGNOSTICS = 1000;

export function addParseDiagnostic(
  state: ParseGraphState,
  diagnostic: ParseDiagnostic,
  diagnosticId: string,
): void {
  if (state.diagnosticIds.has(diagnosticId)) return;
  if (state.diagnostics.length >= MAX_PARSER_DIAGNOSTICS) return;
  state.diagnosticIds.add(diagnosticId);
  diagnostic.id = diagnosticId;
  state.diagnostics.push(diagnostic);
}
