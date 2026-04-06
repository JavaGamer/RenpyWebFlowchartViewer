import type { Dispatch, RefObject } from 'react';
import type { FlowEdge, FlowNode } from '../domain/graph';
import { readFileAsText } from '../infrastructure/fileReader';
import { validateRpyUpload } from './uploadValidation';
import type { AppAction, DialogueSearchMode } from './appState';
import { toFileReadErrorMessage, toParseErrorMessage } from './errorMessages';
import type { ParseService } from './parseService';

export interface ProcessUploadDeps {
  parseService: ParseService;
  dispatch: Dispatch<AppAction>;
  activeRunIdRef: RefObject<number>;
  parseAbortControllerRef: RefObject<AbortController | null>;
  onReadMeasured?: (fileCount: number) => void;
  onParseStarted?: () => void;
  onParseMeasured?: (data: { fileCount: number; nodeCount: number; edgeCount: number }) => void;
  dialogueSearchMode?: DialogueSearchMode;
}

const READ_BATCH_SIZE = 24;
const PARSE_BATCH_SIZE = 32;
const LARGE_PROJECT_THRESHOLD = 200;

export function createProcessUpload(deps: ProcessUploadDeps) {
  const {
    parseService,
    dispatch,
    activeRunIdRef,
    parseAbortControllerRef,
    onReadMeasured,
    onParseStarted,
    onParseMeasured,
    dialogueSearchMode = 'auto',
  } = deps;

  return async function processUpload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {
      return;
    }

    const runId = (activeRunIdRef.current ?? 0) + 1;
    activeRunIdRef.current = runId;
    const isActiveRun = () => activeRunIdRef.current === runId;

    const { rpyFiles, errorMessage } = validateRpyUpload(files);
    if (errorMessage) {
      dispatch({ type: 'FAIL', message: errorMessage });
      return;
    }

    parseAbortControllerRef.current?.abort();
    const controller = new AbortController();
    parseAbortControllerRef.current = controller;

    dispatch({ type: 'START_READING', fileCount: rpyFiles.length });

    let parsedNodes: FlowNode[] = [];
    let parsedEdges: FlowEdge[] = [];
    try {
      onParseStarted?.();
      dispatch({ type: 'START_PARSING' });
      const shouldUseChunking = rpyFiles.length >= LARGE_PROJECT_THRESHOLD;
      const effectiveDialogueMode =
        dialogueSearchMode === 'auto' && shouldUseChunking ? 'countOnly' : dialogueSearchMode;
      let readCount = 0;
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
              const parseChunk = inputs.slice(parseOffset, parseOffset + PARSE_BATCH_SIZE);
              const isLastParseChunkInBatch = parseOffset + parseChunk.length >= inputs.length;
              const isLastChunk = isLastReadBatch && isLastParseChunkInBatch;
              const result = await parseService.parse({
                files: parseChunk,
                appendToActiveGraph: true,
                resetActiveGraph: offset === 0 && parseOffset === 0,
                isFinalChunk: isLastChunk,
                captureDialogueLines: effectiveDialogueMode === 'full',
                signal: controller.signal,
                onProgress: (progress) => {
                  if (!isActiveRun()) return;
                  dispatch({ type: 'PROGRESS', progress: {
                    doneFiles: Math.min(offset + parseOffset + progress.doneFiles, rpyFiles.length),
                    totalFiles: rpyFiles.length,
                    currentFile: progress.currentFile,
                  } });
                },
                onPartialResult: (partial) => {
                  if (!isActiveRun()) return;
                  parsedNodes = partial.nodes;
                  parsedEdges = partial.edges;
                  dispatch({ type: 'PARTIAL_PARSE_SUCCESS', nodes: parsedNodes, edges: parsedEdges });
                },
              });
              parsedNodes = result.nodes;
              parsedEdges = result.edges;
              if (!isLastChunk) {
                dispatch({ type: 'PARTIAL_PARSE_SUCCESS', nodes: parsedNodes, edges: parsedEdges });
              }
            }
          } else {
            const result = await parseService.parse({
              files: inputs,
              appendToActiveGraph: false,
              isFinalChunk: true,
              captureDialogueLines: effectiveDialogueMode === 'full',
              signal: controller.signal,
              onProgress: (progress) => {
                if (!isActiveRun()) return;
                dispatch({ type: 'PROGRESS', progress: {
                  doneFiles: Math.min(offset + progress.doneFiles, rpyFiles.length),
                  totalFiles: rpyFiles.length,
                  currentFile: progress.currentFile,
                } });
              },
            });
            parsedNodes = result.nodes;
            parsedEdges = result.edges;
            dispatch({ type: 'PARTIAL_PARSE_SUCCESS', nodes: parsedNodes, edges: parsedEdges });
          }
        } catch (err: unknown) {
          if (!isActiveRun()) return;
          dispatch({
            type: 'FAIL',
            message: toParseErrorMessage(err),
          });
          return;
        }
      }
    } catch (err: unknown) {
      if (!isActiveRun()) return;
      dispatch({ type: 'FAIL', message: toFileReadErrorMessage(err) });
      return;
    }
    if (!isActiveRun()) return;
    onParseMeasured?.({ fileCount: rpyFiles.length, nodeCount: parsedNodes.length, edgeCount: parsedEdges.length });
    dispatch({ type: 'PARSE_SUCCESS', nodes: parsedNodes, edges: parsedEdges });
  };
}
