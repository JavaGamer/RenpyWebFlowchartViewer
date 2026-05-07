import type { RefObject } from 'react';
import type { FlowEdge, FlowNode } from '../domain';
import { readFileAsText } from '../infrastructure';

import { validateRpyUpload } from './uploadValidation';
import type { AppActions, DialogueSearchMode } from './appStore';
import { toFileReadErrorMessage, toParseErrorMessage } from './errorMessages';
import type { ParseService } from './parseService';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';
import type { ParseDiagnosticPayload } from '../infrastructure';

export interface ProcessUploadDeps {
  parseService: ParseService;
  actions: Pick<AppActions, 'startReading' | 'startParsing' | 'setProgress' | 'partialParseSuccess' | 'parseSuccess' | 'fail'>;
  activeRunIdRef: RefObject<number>;
  parseAbortControllerRef: RefObject<AbortController | null>;
  onReadMeasured?: (fileCount: number) => void;
  onParseStarted?: () => void;
  onParseMeasured?: (data: { fileCount: number; nodeCount: number; edgeCount: number }) => void;
  dialogueSearchMode?: DialogueSearchMode;
  parserVariant?: ParserVariant;
  customScreenActionRules?: ScreenActionRule[];
}

const READ_BATCH_SIZE = 24;
const PARSE_BATCH_SIZE = 32;
const LARGE_PROJECT_THRESHOLD = 200;

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
    const controller = new AbortController();
    parseAbortControllerRef.current = controller;

    actions.startReading(rpyFiles.length);

    let parsedNodes: FlowNode[] = [];
    let parsedEdges: FlowEdge[] = [];
    let parsedDiagnostics: ParseDiagnosticPayload[] = [];
    let hasStartedParsing = false;
    try {
      const shouldUseChunking = rpyFiles.length >= LARGE_PROJECT_THRESHOLD;
      const effectiveDialogueMode =
        dialogueSearchMode === 'auto' && shouldUseChunking ? 'countOnly' : dialogueSearchMode;
      const shouldCaptureDialogueLines = effectiveDialogueMode !== 'countOnly';
      let readCount = 0;
      let parsedFileCount = 0;
      for (let offset = 0; offset < rpyFiles.length; offset += READ_BATCH_SIZE) {
        if (!isActiveRun()) return;
        const batch = rpyFiles.slice(offset, offset + READ_BATCH_SIZE);
        const inputs = await Promise.all(
          batch.map(async (f) => ({
            name: f.name,
            content: await readFileAsText(f),
          })),
        );
        readCount += inputs.length;
        onReadMeasured?.(readCount);
        if (!isActiveRun()) return;

        try {
          if (shouldUseChunking) {
            const isLastReadBatch = offset + batch.length >= rpyFiles.length;
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
              const result = await parseService.parse({
                files: parseChunk,
                appendToActiveGraph: true,
                resetActiveGraph: offset === 0 && parseOffset === 0,
                isFinalChunk: isLastChunk,
                captureDialogueLines: shouldCaptureDialogueLines,
                parserVariant,
                screenActionRules: customScreenActionRules,
                signal: controller.signal,
                onProgress: (progress) => {
                  if (!isActiveRun()) return;
                  actions.setProgress({
                    doneFiles: Math.min(parsedFileCount + progress.doneFiles, rpyFiles.length),
                    totalFiles: rpyFiles.length,
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
            const isLastReadBatch = offset + batch.length >= rpyFiles.length;
            if (!hasStartedParsing) {
              hasStartedParsing = true;
              onParseStarted?.();
              actions.startParsing();
            }
            const result = await parseService.parse({
              files: inputs,
              appendToActiveGraph: true,
              resetActiveGraph: isFirstReadBatch,
              isFinalChunk: isLastReadBatch,
              captureDialogueLines: shouldCaptureDialogueLines,
              parserVariant,
              screenActionRules: customScreenActionRules,
              signal: controller.signal,
              onProgress: (progress) => {
                if (!isActiveRun()) return;
                actions.setProgress({
                  doneFiles: Math.min(parsedFileCount + progress.doneFiles, rpyFiles.length),
                  totalFiles: rpyFiles.length,
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
    onParseMeasured?.({ fileCount: rpyFiles.length, nodeCount: parsedNodes.length, edgeCount: parsedEdges.length });
    actions.parseSuccess(parsedNodes, parsedEdges, parsedDiagnostics);
  };
}
