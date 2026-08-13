import type { ParseGraphState, ParseInputFile } from "./pipelineTypes.ts";
import { scanInitItemsFromFiles } from "./initScanner.ts";
import { executeInitItemsPass } from "./initExecutor.ts";

export {
  getLineIndent,
  getLogicalBodyAndEndLine,
  getLogicalExpressionAndEndLine,
  processLineState,
  scanInitItemsFromFiles,
  stripPythonComments,
} from "./initScanner.ts";

export {
  executeInitItemsPass,
  processAssignment,
  processInitBlockText,
  processPythonBlockText,
} from "./initExecutor.ts";

export function preParseInitialization(
  files: ParseInputFile[],
  state: ParseGraphState,
): void {
  if (!state.labelsByChapter) {
    state.labelsByChapter = new Map();
  }
  if (!state.labelDefinitionCountByName) {
    state.labelDefinitionCountByName = new Map();
  }
  if (!state.canonicalLabelIdByName) {
    state.canonicalLabelIdByName = new Map();
  }
  if (!state.globalPersistentVariables) {
    state.globalPersistentVariables = new Map();
  }
  if (!state.initVariables) {
    state.initVariables = new Map();
  }

  const items = scanInitItemsFromFiles(files, state);

  // Execute initialization items using a multi-pass fixed-point loop (up to 5 passes)
  const maxPasses = 5;
  let stateChanged = true;
  let pass = 0;

  while (stateChanged && pass < maxPasses) {
    pass += 1;
    stateChanged = executeInitItemsPass(state, items);
  }
}
