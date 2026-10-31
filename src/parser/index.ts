/**
 * src/parser/index.ts
 *
 * Public entrypoint for the Ren'Py script parser.
 */

export {
  parseRenpyFilesModern,
  parseRenpyFilesModern as parseRenpyFiles,
} from "./modernParseService.ts";
export * from "./ast/index.ts";
export * from "./graph/index.ts";
export {
  type HeadlessParseOptions,
  HeadlessParserEngine,
  headlessParserEngine,
  type HeadlessParseResult,
  type ParserProgressPayload,
  type ParserSessionState,
} from "./headlessParserEngine.ts";
export { RENPY_TL_PATH_REGEX, scanTranslations } from "./translationScanner.ts";
export { computeTextStats } from "./metrics.ts";
export {
  computeLineIndent,
  createGraphState,
  extractLiteralTarget,
  extractSceneAsset,
  parseDictLiteral,
  PARSER_TOKENS,
  preParseInitialization,
  stripPythonComments,
} from "./utils.ts";
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
export * from "./plugins/index.ts";
