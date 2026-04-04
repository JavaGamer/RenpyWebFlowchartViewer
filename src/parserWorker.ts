import { parseRenpyFiles } from './parser';
import type { FlowNode, FlowEdge } from './types';

interface ParseRequest {
  type: 'parse';
  requestId: number;
  files: Array<{ name: string; content: string }>;
  wantsProgress?: boolean;
}

interface CancelRequest {
  type: 'cancel';
  requestId: number;
}

type WorkerRequest = ParseRequest | CancelRequest;

interface ProgressMessage {
  type: 'progress';
  requestId: number;
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
  elapsedMs?: number;
}

interface ResultMessage {
  type: 'result';
  requestId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  elapsedMs?: number;
}

interface ErrorMessage {
  type: 'error';
  requestId: number;
  message: string;
  elapsedMs?: number;
}

type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;

let activeRequestId: number | null = null;
const cancelledRequests = new Set<number>();

function postMessageSafe(message: WorkerResponse) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    cancelledRequests.add(message.requestId);
    return;
  }

  if (message.type !== 'parse') return;

  const { requestId, files } = message;
  activeRequestId = requestId;
  const startedAt = performance.now();
  const wantsProgress = message.wantsProgress !== false;
  const progressThrottleMs = files.length > 40 ? 30 : 0;
  let lastProgressAt = 0;
  let pendingProgress: ProgressMessage | null = null;

  try {
    const result = await parseRenpyFiles(files, {
      onProgress: ({ doneFiles, totalFiles, currentFile }) => {
        if (cancelledRequests.has(requestId)) {
          throw new Error('Parsing cancelled');
        }
        if (!wantsProgress) return;
        const now = performance.now();
        const nextProgress: ProgressMessage = {
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
