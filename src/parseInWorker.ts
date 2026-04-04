import type { FlowNode, FlowEdge } from './types';

interface ParseRequestPayload {
  files: Array<{ name: string; content: string }>;
  onProgress?: (progress: {
    doneFiles: number;
    totalFiles: number;
    currentFile: string;
    elapsedMs?: number;
  }) => void;
  signal?: AbortSignal;
}

interface ParseResultPayload {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

type WorkerResponse =
  | {
      type: 'progress';
      requestId: number;
      doneFiles: number;
      totalFiles: number;
      currentFile: string;
      elapsedMs?: number;
    }
  | {
      type: 'result';
      requestId: number;
      nodes: FlowNode[];
      edges: FlowEdge[];
      elapsedMs?: number;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
      elapsedMs?: number;
    };

let requestCounter = 0;

const worker = new Worker(new URL('./parserWorker.ts', import.meta.url), { type: 'module' });

export function parseRenpyFilesInWorker({
  files,
  onProgress,
  signal,
}: ParseRequestPayload): Promise<ParseResultPayload> {
  const requestId = ++requestCounter;
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Parsing cancelled', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cb();
    };

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;

      if (message.type === 'progress') {
        onProgress?.({
          doneFiles: message.doneFiles,
          totalFiles: message.totalFiles,
          currentFile: message.currentFile,
          elapsedMs: message.elapsedMs,
        });
        return;
      }

      settle(() => {
        worker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
      });

      if (message.type === 'result') {
        resolve({ nodes: message.nodes, edges: message.edges });
        return;
      }

      reject(new Error(message.message));
    };

    const onAbort = () => {
      settle(() => {
        worker.removeEventListener('message', onMessage);
        worker.postMessage({ type: 'cancel', requestId });
        reject(new DOMException('Parsing cancelled', 'AbortError'));
      });
    };

    worker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ type: 'parse', requestId, files });
  });
}
