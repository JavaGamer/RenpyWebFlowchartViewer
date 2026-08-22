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
export { preParseInitialization } from "./initMapper.ts";
export { finalizeRoles } from "./roleFinalization.ts";
export { extractNodeDetailsFromTokens } from "./tokenScanStage.ts";
export {
  createFileGraphFragment,
  type FileGraphFragment,
  linkGraphFragments,
  parseFileToFragment,
} from "./mapReduceLinker.ts";
export {
  buildProjectMediaIndex,
  resolveAssetReference,
  verifyAssetIntegrity,
} from "./assetIntegrity.ts";
export { runControlFlowAnalysis } from "./controlFlowAnalysis.ts";
export { materializeCallReturnEdges } from "./callReturnFinalization.ts";
export type {
  InitVariableDescriptor,
  MissingAssetParseDiagnostic,
  ParseDiagnostic,
  ParseGraphState,
  ParseInputFile,
  ParseOptions,
  ParseProgress,
  ParseResult,
  PendingCallReturn,
  TextDocument,
  TokenTree,
  VariableMutation,
  VariableValue,
} from "./pipelineTypes.ts";
export * from "./workerProtocol.ts";
