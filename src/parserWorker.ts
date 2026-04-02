import { parseRenpyFiles } from './parser';
import type { FlowNode, FlowEdge } from './types';

interface ParseRequest {
  type: 'parse';
  requestId: number;
  files: Array<{ name: string; content: string }>;
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
}

interface ResultMessage {
  type: 'result';
  requestId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface ErrorMessage {
  type: 'error';
  requestId: number;
  message: string;
}

type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;

let activeRequestId: number | null = null;
let cancelledRequests = new Set<number>();

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

  try {
    const result = await parseRenpyFiles(files, {
      onProgress: ({ doneFiles, totalFiles, currentFile }) => {
        if (cancelledRequests.has(requestId)) {
          throw new Error('Parsing cancelled');
        }
        postMessageSafe({
          type: 'progress',
          requestId,
          doneFiles,
          totalFiles,
          currentFile,
        });
      },
    });

    if (!cancelledRequests.has(requestId)) {
      postMessageSafe({
        type: 'result',
        requestId,
        nodes: result.nodes,
        edges: result.edges,
      });
    }
  } catch (error: unknown) {
    if (!cancelledRequests.has(requestId)) {
      const messageText = error instanceof Error ? error.message : String(error);
      postMessageSafe({ type: 'error', requestId, message: messageText });
    }
  } finally {
    if (activeRequestId === requestId) {
      activeRequestId = null;
    }
    cancelledRequests.delete(requestId);
  }
};
