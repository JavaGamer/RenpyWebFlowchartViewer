/**
 * src/parser.ts
 *
 * Client-side Ren'Py script parser.
 */

import pLimit from 'p-limit';
import { createPerfTracker } from './perf';
import { createGraphState } from './parser/pipelineState';
import { parseOneFile, processTokenizedFile, tokenizeOneFile } from './parser/filePipeline';
import { finalizeRoles } from './parser/roleFinalization';
import type {
  ParseInputFile,
  ParseResult,
  ParseProgress,
  ParseOptions,
} from './parser/pipelineTypes';

export type { ParseResult, ParseProgress, ParseOptions };

function getMaxParallelFiles(requested: number | undefined, fileCount: number): number {
  if (!Number.isFinite(requested) || requested === undefined) return 1;
  const normalized = Math.floor(requested);
  if (normalized <= 1) return 1;
  return Math.max(1, Math.min(normalized, fileCount));
}

function normalizeFileIdentity(value: string): string {
  return value.replace(/\\/g, '/');
}

function compareDeterministicStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareFiles(a: ParseInputFile, b: ParseInputFile): number {
  const aIdentity = normalizeFileIdentity(a.relativePath ?? a.name);
  const bIdentity = normalizeFileIdentity(b.relativePath ?? b.name);
  return compareDeterministicStrings(aIdentity, bIdentity) || compareDeterministicStrings(a.name, b.name);
}

export async function parseRenpyFiles(
  files: ParseInputFile[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  const perf = createPerfTracker('parser');
  perf.mark('total');
  const state = createGraphState();
  const orderedFiles = [...files].sort(compareFiles);
  const maxParallelFiles = getMaxParallelFiles(options.maxParallelFiles, orderedFiles.length);

  if (maxParallelFiles === 1) {
    for (let idx = 0; idx < orderedFiles.length; idx += 1) {
      const file = orderedFiles[idx];
      perf.mark(`file:${idx}`);
      await parseOneFile(state, file, options, idx);
      perf.measure(`file:${idx}`, 'parse_file_ms', { file: file.name });
      options.onProgress?.({
        doneFiles: idx + 1,
        totalFiles: orderedFiles.length,
        currentFile: file.relativePath ?? file.name,
      });
    }
  } else {
    const limit = pLimit(maxParallelFiles);
    const tokenizedFiles = await Promise.all(
      orderedFiles.map((file, idx) =>
        limit(async () => {
          perf.mark(`file:${idx}:tokenize`);
          const tokenized = await tokenizeOneFile(file, options, idx);
          perf.measure(`file:${idx}:tokenize`, 'parse_file_tokenize_ms', { file: file.name });
          return tokenized;
        }),
      ),
    );

    for (let idx = 0; idx < orderedFiles.length; idx += 1) {
      const tokenized = tokenizedFiles[idx];
      if (!tokenized) {
        throw new Error(`Failed to tokenize file at index ${idx} (${orderedFiles[idx]?.name ?? 'unknown'})`);
      }
      const file = orderedFiles[idx];
      perf.mark(`file:${idx}:scan`);
      processTokenizedFile(state, tokenized, {
        captureDialogueLines: options.captureDialogueLines,
        parserVariant: options.parserVariant,
        screenActionRules: options.screenActionRules,
      });
      perf.measure(`file:${idx}:scan`, 'parse_file_scan_ms', { file: file.name });
      options.onProgress?.({
        doneFiles: idx + 1,
        totalFiles: orderedFiles.length,
        currentFile: file.relativePath ?? file.name,
      });
    }
  }

  perf.mark('finalize');
  finalizeRoles(state);
  perf.measure('finalize', 'finalize_roles_ms', { nodes: state.nodes.length });
  perf.measure('total', 'parse_total_ms', {
    files: orderedFiles.length,
    nodes: state.nodes.length,
    edges: state.edges.length,
  });
  if (state.diagnostics.length > 0) {
    return { nodes: state.nodes, edges: state.edges, diagnostics: state.diagnostics };
  }
  return { nodes: state.nodes, edges: state.edges };
}
