import type { ParseGraphState, ParseScanState } from "./pipelineTypes.ts";
import { resetStaleWaitFlags } from "./handlers/screen/screenHandlerEntry.ts";
import {
  dispatchToken,
  type HandleTokenInput,
} from "./tokenHandlers/tokenHandlerRegistry.ts";

export {
  extractLiteralTarget,
  parseDictLiteral,
  parseListLiteral,
  resolveStaticTargetExpression,
} from "./handlers/jumpCallHandler.ts";
export { stripInlineComment } from "./handlers/screen/screenHandlerEntry.ts";
export { parseAndRecordVariableMutation } from "./tokenHandlers/blockStatementHandler.ts";
export { computeTextStats } from "./tokenHandlers/dialogueTokenHandler.ts";
export type { HandleTokenInput };

export function ensureScanStateInitialized(scanState: ParseScanState): void {
  if (!scanState.conditionalDecisionStack) {
    scanState.conditionalDecisionStack = [];
  }
  if (!scanState.labelVariableLiteralTargets) {
    scanState.labelVariableLiteralTargets = new Map();
  }
  if (!scanState.labelVariableDictTargets) {
    scanState.labelVariableDictTargets = new Map();
  }
  if (!scanState.labelVariableListTargets) {
    scanState.labelVariableListTargets = new Map();
  }
  if (scanState.pendingConditionalHeader === undefined) {
    scanState.pendingConditionalHeader = null;
  }
  if (scanState.currentLabelDeclaredName === undefined) {
    scanState.currentLabelDeclaredName = null;
  }
  if (scanState.currentLabelBaseId === undefined) {
    scanState.currentLabelBaseId = null;
  }
  if (scanState.currentLabelSceneIndex === undefined) {
    scanState.currentLabelSceneIndex = 1;
  }
  if (scanState.currentLabelHasSplit === undefined) {
    scanState.currentLabelHasSplit = false;
  }
  if (scanState.currentLabelHasContentSinceSceneBoundary === undefined) {
    scanState.currentLabelHasContentSinceSceneBoundary = false;
  }
}

/**
 * The main dispatch router for individual tokens in the parser pipeline.
 * Evaluates token types (labels, jumps, calls, returns, menus, dialogue strings)
 * and mutates the flowchart graph topology accordingly.
 */
export function handleToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  input: HandleTokenInput,
): void {
  if (
    !scanState.labelVariableDictTargets || !scanState.conditionalDecisionStack
  ) {
    ensureScanStateInitialized(scanState);
  }
  resetStaleWaitFlags(scanState, input.type);
  dispatchToken(state, scanState, input);
}
