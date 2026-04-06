/**
 * src/parser.ts
 *
 * Client-side Ren'Py script parser.
 */

import { createPerfTracker } from './perf';
import { createGraphState } from './parser/pipelineState';
import { parseOneFile } from './parser/filePipeline';
import { finalizeRoles } from './parser/roleFinalization';
import type {
  ParseResult,
  ParseProgress,
  ParseOptions,
} from './parser/pipelineTypes';

export type { ParseResult, ParseProgress, ParseOptions };

export async function parseRenpyFiles(
  files: { name: string; content: string }[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  const perf = createPerfTracker('parser');
  perf.mark('total');
  const state = createGraphState();

  for (let idx = 0; idx < files.length; idx += 1) {
    const file = files[idx];
    perf.mark(`file:${idx}`);
    await parseOneFile(state, file, {
      captureDialogueLines: options.captureDialogueLines !== false,
    });
    perf.measure(`file:${idx}`, 'parse_file_ms', { file: file.name });
    options.onProgress?.({
      doneFiles: idx + 1,
      totalFiles: files.length,
      currentFile: file.name,
    });
  }

  perf.mark('finalize');
  finalizeRoles(state);
  perf.measure('finalize', 'finalize_roles_ms', { nodes: state.nodes.length });
  perf.measure('total', 'parse_total_ms', {
    files: files.length,
    nodes: state.nodes.length,
    edges: state.edges.length,
  });
  return { nodes: state.nodes, edges: state.edges };
}
