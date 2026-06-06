import type { FlowNode, FlowEdge, CanvasNode, CanvasEdge, ThemeName } from '../domain';


let worker: Worker | null = null;
let activeRequestId = 0;
let isWorkerRunning = false;

function getLayoutWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function terminateLayoutWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  isWorkerRunning = false;
}

export function isLayoutRunning(): boolean {
  return isWorkerRunning;
}

export function runLayoutInWorker(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: 'TB' | 'LR',
  options: {
    progressive?: boolean;
    previousPositions?: Map<string, { x: number; y: number }> | Array<[string, { x: number; y: number }]>;
    theme?: ThemeName;
  } | undefined,
  onResult: (result: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => void,
  onError?: (error: Error) => void
): () => void {
  if (isWorkerRunning) {
    terminateLayoutWorker();
  }

  const requestId = ++activeRequestId;
  isWorkerRunning = true;

  const layoutWorker = getLayoutWorker();

  let serializedPreviousPositions: Array<[string, { x: number; y: number }]> | undefined;
  if (options?.previousPositions) {
    if (options.previousPositions instanceof Map) {
      serializedPreviousPositions = Array.from(options.previousPositions.entries());
    } else {
      serializedPreviousPositions = options.previousPositions;
    }
  }

  const payload = {
    requestId,
    rawNodes,
    rawEdges,
    direction,
    options: options
      ? {
          ...options,
          previousPositions: serializedPreviousPositions,
        }
      : undefined,
  };

  let completed = false;

  const messageHandler = (event: MessageEvent) => {
    const { requestId: responseId, result } = event.data;
    if (responseId === requestId) {
      completed = true;
      isWorkerRunning = false;
      layoutWorker.removeEventListener('message', messageHandler);
      layoutWorker.removeEventListener('error', errorHandler);
      onResult(result);
    }
  };

  const errorHandler = (event: ErrorEvent) => {
    completed = true;
    isWorkerRunning = false;
    layoutWorker.removeEventListener('message', messageHandler);
    layoutWorker.removeEventListener('error', errorHandler);
    if (onError) {
      onError(event.error || new Error(event.message));
    }
  };

  layoutWorker.addEventListener('message', messageHandler);
  layoutWorker.addEventListener('error', errorHandler);
  layoutWorker.postMessage(payload);

  return () => {
    if (!completed && activeRequestId === requestId) {
      terminateLayoutWorker();
    }
  };
}
