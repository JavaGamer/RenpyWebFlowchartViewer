import type { Dispatch, RefObject } from 'react';
import { readFileAsText } from '../infrastructure';
import { validateRpyUpload } from './uploadValidation';
import type { AppAction } from './appState';
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
}

export function createProcessUpload(deps: ProcessUploadDeps) {
  const {
    parseService,
    dispatch,
    activeRunIdRef,
    parseAbortControllerRef,
    onReadMeasured,
    onParseStarted,
    onParseMeasured,
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

    let inputs: Array<{ name: string; content: string }>;
    try {
      inputs = await Promise.all(
        rpyFiles.map(async (f) => ({
          name: f.name,
          content: await readFileAsText(f),
        })),
      );
    } catch (err: unknown) {
      if (!isActiveRun()) return;
      dispatch({ type: 'FAIL', message: toFileReadErrorMessage(err) });
      return;
    }
    onReadMeasured?.(rpyFiles.length);
    if (!isActiveRun()) return;

    onParseStarted?.();
    dispatch({ type: 'START_PARSING' });
    try {
      const { nodes, edges } = await parseService.parse({
        files: inputs,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!isActiveRun()) return;
          dispatch({ type: 'PROGRESS', progress });
        },
      });
      if (!isActiveRun()) return;
      onParseMeasured?.({ fileCount: rpyFiles.length, nodeCount: nodes.length, edgeCount: edges.length });
      dispatch({ type: 'PARSE_SUCCESS', nodes, edges });
    } catch (err: unknown) {
      if (!isActiveRun()) return;
      dispatch({
        type: 'FAIL',
        message: toParseErrorMessage(err),
      });
    }
  };
}
