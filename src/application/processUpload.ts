/**
 * src/application/processUpload.ts
 *
 * Upload orchestrator that converts a raw browser FileList into a fully parsed
 * FlowGraph. Responsibilities:
 * 1. Validates the file selection (rpy files only).
 * 2. Reads files in read-batches to avoid blocking the main thread.
 * 3. Dispatches parse chunks to the `ParseService` (web worker bridge).
 * 4. Emits intermediate partial results so the UI can progressively render.
 * 5. Cancels stale runs when a new upload begins before the previous one completes.
 *
 * Two scheduling strategies are used depending on project size:
 * - **Small projects** (<{@link LARGE_PROJECT_THRESHOLD} files): read all batches
 *   first, then parse incrementally.
 * - **Large projects**: interleave read and parse at a finer granularity
 *   (`PARSE_BATCH_SIZE` per read batch) to reduce peak memory.
 */

import type { RefObject } from 'react';
import { compareDeterministicStrings, type FlowEdge, type FlowNode } from '../domain';
import { readFileAsText, type ParseDiagnosticPayload } from '../infrastructure';

import { validateRpyUpload } from './uploadValidation';
import type { AppActions, DialogueSearchMode } from './appStore';
import { toFileReadErrorMessage, toParseErrorMessage } from './errorMessages';
import type { ParseService } from './parseService';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';

/**
 * Dependency bag injected into `createProcessUpload`.
 * All external I/O (parsing, store dispatch, progress hooks) is accessed
 * through this bag to keep the orchestrator logic testable without a DOM.
 */
export interface ProcessUploadDeps {
  parseService: ParseService;
  actions: Pick<AppActions, 'startReading' | 'startParsing' | 'setProgress' | 'partialParseSuccess' | 'parseSuccess' | 'fail'>;
  /** Active run ID ref used to abort stale upload sequences when a new upload begins. */
  activeRunIdRef: RefObject<number>;
  /** Ref holding the AbortController passed to the parse worker so it can be cancelled. */
  parseAbortControllerRef: RefObject<AbortController | null>;
  /** Called after each read batch completes; useful for instrumentation/logging. */
  onReadMeasured?: (fileCount: number) => void;
  /** Called once the first parse batch is dispatched. */
  onParseStarted?: () => void;
  /** Called after the final parse result is committed; useful for analytics. */
  onParseMeasured?: (data: { fileCount: number; nodeCount: number; edgeCount: number }) => void;
  dialogueSearchMode?: DialogueSearchMode;
  parserVariant?: ParserVariant;
  customScreenActionRules?: ScreenActionRule[];
}

/** Maximum number of files to read concurrently per read pass. */
const READ_BATCH_SIZE = 24;
/** Maximum number of files dispatched to the parse worker per chunk. */
const PARSE_BATCH_SIZE = 32;
/** Projects with at least this many .rpy files switch to the chunked parse strategy. */
const LARGE_PROJECT_THRESHOLD = 200;

/** Extracts the folder-relative path from a `File` created by a folder picker input. */
function getFileRelativePath(file: File): string | undefined {
  const relativePath = 'webkitRelativePath' in file ? file.webkitRelativePath : '';
  return relativePath ? relativePath.replace(/\\/g, '/') : undefined;
}

/** Deterministic sort comparator for uploaded files; prefers relative path, falls back to filename. */
function compareUploadFiles(a: File, b: File): number {
  const aIdentity = getFileRelativePath(a) ?? a.name;
  const bIdentity = getFileRelativePath(b) ?? b.name;
  return compareDeterministicStrings(aIdentity, bIdentity) || compareDeterministicStrings(a.name, b.name);
}

/**
 * Factory function that creates a `processUpload` closure bound to the supplied
 * dependencies. The returned async function is the entry point called whenever
 * the user selects files via the drag-and-drop or file picker UI.
 *
 * Each invocation increments `activeRunIdRef` so that any prior in-flight upload
 * is detected as stale and returns early at its next `isActiveRun()` check.
 */
export function createProcessUpload(deps: ProcessUploadDeps) {
  const {
    parseService,
    actions,
    activeRunIdRef,
    parseAbortControllerRef,
    onReadMeasured,
    onParseStarted,
    onParseMeasured,
    dialogueSearchMode = 'auto',
    parserVariant = 'renpy',
    customScreenActionRules = [],
  } = deps;

  return async function processUpload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {
      return;
    }

    const runId = (activeRunIdRef.current ?? 0) + 1;
    activeRunIdRef.current = runId;
    const isActiveRun = () => activeRunIdRef.current === runId;

    parseAbortControllerRef.current?.abort();
    parseAbortControllerRef.current = null;

    const { rpyFiles, errorMessage } = validateRpyUpload(files);
    if (errorMessage) {
      actions.fail(errorMessage);
      return;
    }
    const orderedRpyFiles = [...rpyFiles].sort(compareUploadFiles);
    const controller = new AbortController();
    parseAbortControllerRef.current = controller;

    actions.startReading(orderedRpyFiles.length);

    let parsedNodes: FlowNode[] = [];
    let parsedEdges: FlowEdge[] = [];
    let parsedDiagnostics: ParseDiagnosticPayload[] = [];
    let hasStartedParsing = false;
    try {
      const shouldUseChunking = orderedRpyFiles.length >= LARGE_PROJECT_THRESHOLD;
      const effectiveDialogueMode =
        dialogueSearchMode === 'auto' && shouldUseChunking ? 'countOnly' : dialogueSearchMode;
      const shouldCaptureDialogueLines = effectiveDialogueMode !== 'countOnly';
      let readCount = 0;
      let parsedFileCount = 0;
      for (let offset = 0; offset < orderedRpyFiles.length; offset += READ_BATCH_SIZE) {
        if (!isActiveRun()) return;
        const batch = orderedRpyFiles.slice(offset, offset + READ_BATCH_SIZE);
        const inputs = await Promise.all(
          batch.map(async (f) => ({
            name: f.name,
            relativePath: getFileRelativePath(f),
            content: await readFileAsText(f),
          })),
        );
        readCount += inputs.length;
        onReadMeasured?.(readCount);
        if (!isActiveRun()) return;

        try {
          if (shouldUseChunking) {
            const isLastReadBatch = offset + batch.length >= orderedRpyFiles.length;
            for (let parseOffset = 0; parseOffset < inputs.length; parseOffset += PARSE_BATCH_SIZE) {
              if (!isActiveRun()) return;
              if (!hasStartedParsing) {
                hasStartedParsing = true;
                onParseStarted?.();
                actions.startParsing();
              }
              const parseChunk = inputs.slice(parseOffset, parseOffset + PARSE_BATCH_SIZE);
              const isLastParseChunkInBatch = parseOffset + parseChunk.length >= inputs.length;
              const isLastChunk = isLastReadBatch && isLastParseChunkInBatch;
              const baseCount = parsedFileCount;
              const result = await parseService.parse({
                files: parseChunk,
                appendToActiveGraph: true,
                resetActiveGraph: offset === 0 && parseOffset === 0,
                isFinalChunk: isLastChunk,
                captureDialogueLines: shouldCaptureDialogueLines,
                parserVariant,
                screenActionRules: customScreenActionRules,
                signal: controller.signal,
                maxParallelFiles: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4,
                onProgress: (progress) => {
                  if (!isActiveRun()) return;
                  actions.setProgress({
                    doneFiles: Math.min(baseCount + progress.doneFiles, orderedRpyFiles.length),
                    totalFiles: orderedRpyFiles.length,
                    currentFile: progress.currentFile,
                  });
                },
                onPartialResult: (partial) => {
                  if (!isActiveRun()) return;
                  parsedNodes = partial.nodes;
                  parsedEdges = partial.edges;
                  parsedDiagnostics = partial.diagnostics ?? parsedDiagnostics;
                  actions.partialParseSuccess(parsedNodes, parsedEdges, parsedDiagnostics);
                },
              });
              parsedNodes = result.nodes;
              parsedEdges = result.edges;
              parsedDiagnostics = result.diagnostics ?? parsedDiagnostics;
              parsedFileCount += parseChunk.length;
            }
          } else {
            const isFirstReadBatch = offset === 0;
            const isLastReadBatch = offset + batch.length >= orderedRpyFiles.length;
            if (!hasStartedParsing) {
              hasStartedParsing = true;
              onParseStarted?.();
              actions.startParsing();
            }
            const baseCount = parsedFileCount;
            const result = await parseService.parse({
              files: inputs,
              appendToActiveGraph: true,
              resetActiveGraph: isFirstReadBatch,
              isFinalChunk: isLastReadBatch,
              captureDialogueLines: shouldCaptureDialogueLines,
              parserVariant,
              screenActionRules: customScreenActionRules,
              signal: controller.signal,
              maxParallelFiles: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4,
              onProgress: (progress) => {
                if (!isActiveRun()) return;
                actions.setProgress({
                  doneFiles: Math.min(baseCount + progress.doneFiles, orderedRpyFiles.length),
                  totalFiles: orderedRpyFiles.length,
                  currentFile: progress.currentFile,
                });
              },
            });
            parsedNodes = result.nodes;
            parsedEdges = result.edges;
            parsedDiagnostics = result.diagnostics ?? parsedDiagnostics;
            parsedFileCount += inputs.length;
            actions.partialParseSuccess(parsedNodes, parsedEdges, parsedDiagnostics);
          }
        } catch (err: unknown) {
          if (!isActiveRun()) return;
          actions.fail(toParseErrorMessage(err));
          return;
        }
      }
    } catch (err: unknown) {
      if (!isActiveRun()) return;
      actions.fail(toFileReadErrorMessage(err));
      return;
    }
    if (!isActiveRun()) return;
    onParseMeasured?.({ fileCount: orderedRpyFiles.length, nodeCount: parsedNodes.length, edgeCount: parsedEdges.length });
    actions.parseSuccess(parsedNodes, parsedEdges, parsedDiagnostics);
  };
}
