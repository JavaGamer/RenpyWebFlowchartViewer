/**
 * src/parser/parser.ts
 *
 * Client-side Ren'Py script parser entry point.
 * Exclusively uses the modern AST-driven Story Graph engine.
 */

import { parseRenpyFilesModern } from "./modernParseService.ts";
import type {
  ParseInputFile,
  ParseOptions,
  ParseProgress,
  ParseResult,
} from "./pipelineTypes.ts";

export type { ParseOptions, ParseProgress, ParseResult };

export async function parseRenpyFiles(
  files: ParseInputFile[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  return parseRenpyFilesModern(files, options);
}
