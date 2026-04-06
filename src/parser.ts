/**
 * src/parser.ts
 *
 * Client-side Ren'Py script parser.
 */

import { createPerfTracker } from './perf';
import { createGraphState } from './parser/pipelineState';
import { parseOneFile, processTokenizedFile, tokenizeOneFile, type TokenizedFile } from './parser/filePipeline';
import { finalizeRoles } from './parser/roleFinalization';
import type {
  ParseResult,
  ParseProgress,
  ParseOptions,
} from './parser/pipelineTypes';

export type { ParseResult, ParseProgress, ParseOptions };

function getMaxParallelFiles(requested: number | undefined, fileCount: number): number {
  if (!Number.isFinite(requested) || requested === undefined) return 1;
  const normalized = Math.floor(requested);
  if (normalized <= 1) return 1;
  return Math.min(normalized, fileCount);
}

export async function parseRenpyFiles(
  files: { name: string; content: string }[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  const perf = createPerfTracker('parser');
  perf.mark('total');
  const state = createGraphState();
  const maxParallelFiles = getMaxParallelFiles(options.maxParallelFiles, files.length);

  if (maxParallelFiles === 1) {
    for (let idx = 0; idx < files.length; idx += 1) {
      const file = files[idx];
      perf.mark(`file:${idx}`);
      await parseOneFile(state, file, options, idx);
      perf.measure(`file:${idx}`, 'parse_file_ms', { file: file.name });
      options.onProgress?.({
        doneFiles: idx + 1,
        totalFiles: files.length,
        currentFile: file.name,
      });
    }
  } else {
    const tokenizedFiles = new Array<TokenizedFile>(files.length);
    let nextIndex = 0;

    const tokenizerWorker = async () => {
      while (nextIndex < files.length) {
        const idx = nextIndex;
        nextIndex += 1;
        const file = files[idx];
        perf.mark(`file:${idx}:tokenize`);
        const tokenized = await tokenizeOneFile(file, options, idx);
        perf.measure(`file:${idx}:tokenize`, 'parse_file_tokenize_ms', { file: file.name });
        tokenizedFiles[idx] = tokenized;
      }
    };

    await Promise.all(Array.from({ length: maxParallelFiles }, () => tokenizerWorker()));

    for (let idx = 0; idx < files.length; idx += 1) {
      const tokenized = tokenizedFiles[idx];
      if (!tokenized) {
        throw new Error(`Failed to tokenize file at index ${idx} (${files[idx]?.name ?? 'unknown'})`);
      }
      const file = files[idx];
      perf.mark(`file:${idx}:scan`);
      processTokenizedFile(state, tokenized, options.captureDialogueLines !== false);
      perf.measure(`file:${idx}:scan`, 'parse_file_scan_ms', { file: file.name });
      options.onProgress?.({
        doneFiles: idx + 1,
        totalFiles: files.length,
        currentFile: file.name,
      });
    }  }

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
