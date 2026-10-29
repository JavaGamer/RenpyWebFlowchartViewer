/**
 * src/parser/index.ts
 *
 * Public entrypoint for the Ren'Py script parser.
 */

export { parseRenpyFiles } from "./parser.ts";
export { parseRenpyFilesModern } from "./modernParseService.ts";
export * from "./ast/index.ts";
export * from "./graph/index.ts";
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
  ScreenDefinition,
  TextDocument,
  TokenTree,
  UnmappedScreenActionParseDiagnostic,
  VariableMutation,
  VariableValue,
} from "./pipelineTypes.ts";
export { RENPY_TL_PATH_REGEX, scanTranslations } from "./translationScanner.ts";
export {
  BoundedTokenizedCache,
  type TokenizedCacheEntry,
} from "./tokenizedCache.ts";
export {
  applyPrePassState,
  type FinalizeChunkOptions,
  type InternalChunkResult,
  mergeChunkIntoState,
  type PrePassState,
} from "./chunkProtocol.ts";
export {
  type HeadlessParseOptions,
  HeadlessParserEngine,
  headlessParserEngine,
  type HeadlessParseResult,
  type ParserProgressPayload,
  type ParserSessionState,
} from "./headlessParserEngine.ts";
export * from "./plugins/index.ts";
