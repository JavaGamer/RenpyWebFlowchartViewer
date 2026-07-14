/**
 * src/parser/index.ts
 *
 * Public entrypoint for the Ren'Py script parser.
 */

export { parseRenpyFiles } from "./parser.ts";
export { createGraphState } from "./pipelineState.ts";
export {
  processTokenizedFile,
  type TokenizedFile,
  tokenizeOneFile,
} from "./filePipeline.ts";
export { finalizeRoles } from "./roleFinalization.ts";
export type {
  ParseDiagnostic,
  ParseGraphState,
  ParseInputFile,
  ParseOptions,
  ParseProgress,
  ParseResult,
} from "./pipelineTypes.ts";
export * from "./workerProtocol.ts";
