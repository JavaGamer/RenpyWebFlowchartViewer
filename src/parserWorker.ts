import { parseRenpyFiles } from './parser';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree } from '@renpy/ast/out/tokenizer/token-definitions';
import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
  type ProgressResponseMessage,
} from './infrastructure/workerProtocol';

let activeRequestId: number | null = null;
const cancelledRequests = new Set<number>();
const tokenizedCache = new Map<string, { document: TextDocument; tokenTree: TokenTree }>();

function postMessageSafe(message: WorkerResponseMessage) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) return;

  if (message.type === 'cancel') {
    cancelledRequests.add(message.requestId);
    return;
  }

  if (message.type !== 'parse') return;

  const { requestId, files, maxParallelFiles, fileCacheKeys } = message;
  activeRequestId = requestId;
  const startedAt = performance.now();
  const wantsProgress = message.wantsProgress !== false;
  const progressThrottleMs = files.length > 40 ? 30 : 0;
  let lastProgressAt = 0;
  let pendingProgress: ProgressResponseMessage | null = null;

  try {
    const result = await parseRenpyFiles(files, {
      maxParallelFiles,
      tokenizedCache,
      fileCacheKeys,
      onProgress: ({ doneFiles, totalFiles, currentFile }) => {
        if (cancelledRequests.has(requestId)) {
          throw new Error('Parsing cancelled');
        }
        if (!wantsProgress) return;
        const now = performance.now();
        const nextProgress: ProgressResponseMessage = {
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'progress',
          requestId,
          doneFiles,
          totalFiles,
          currentFile,
          elapsedMs: performance.now() - startedAt,
        };
        pendingProgress = nextProgress;
        if (progressThrottleMs <= 0 || now - lastProgressAt >= progressThrottleMs || doneFiles === totalFiles) {
          postMessageSafe(nextProgress);
          lastProgressAt = now;
          pendingProgress = null;
        }
      },
    });

    if (wantsProgress && pendingProgress) {
      postMessageSafe(pendingProgress);
      pendingProgress = null;
    }

    if (!cancelledRequests.has(requestId)) {
      postMessageSafe({
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId,
        nodes: result.nodes,
        edges: result.edges,
        elapsedMs: performance.now() - startedAt,
      });
    }
  } catch (error: unknown) {
    if (!cancelledRequests.has(requestId)) {
      const messageText = error instanceof Error ? error.message : String(error);
      postMessageSafe({
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId,
        message: messageText,
        elapsedMs: performance.now() - startedAt,
      });
    }
  } finally {
    if (activeRequestId === requestId) {
      activeRequestId = null;
    }
    cancelledRequests.delete(requestId);
  }
};
