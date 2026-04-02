import type { FlowNode, FlowEdge } from './types';

interface ParseRequestPayload {
  files: Array<{ name: string; content: string }>;
  onProgress?: (progress: { doneFiles: number; totalFiles: number; currentFile: string }) => void;
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
    }
  | {
      type: 'result';
      requestId: number;
      nodes: FlowNode[];
      edges: FlowEdge[];
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };

let requestCounter = 0;

const worker = new Worker(new URL('./parserWorker.ts', import.meta.url), { type: 'module' });

export function parseRenpyFilesInWorker({
  files,
  onProgress,
  signal,
}: ParseRequestPayload): Promise<ParseResultPayload> {
  const requestId = ++requestCounter;

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;

      if (message.type === 'progress') {
        onProgress?.({
          doneFiles: message.doneFiles,
          totalFiles: message.totalFiles,
          currentFile: message.currentFile,
        });
        return;
      }

      worker.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);

      if (message.type === 'result') {
        resolve({ nodes: message.nodes, edges: message.edges });
        return;
      }

      reject(new Error(message.message));
    };

    const onAbort = () => {
      worker.removeEventListener('message', onMessage);
      worker.postMessage({ type: 'cancel', requestId });
      reject(new DOMException('Parsing cancelled', 'AbortError'));
    };

    worker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ type: 'parse', requestId, files });
  });
}
