import { wrap, type Remote } from 'comlink';
import type { FlowNode, FlowEdge, CanvasNode, CanvasEdge, ThemeName, LayoutDensity } from '../domain';
import type { LayoutWorkerApi } from './layoutWorker';

let worker: Worker | null = null;

function isWorkerSupported(): boolean {
  return typeof globalThis.Worker !== 'undefined';
}
let apiProxy: Remote<LayoutWorkerApi> | null = null;
let isWorkerRunning = false;

function getLayoutWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' });
    apiProxy = wrap<LayoutWorkerApi>(worker);
  }
  return worker;
}

export function terminateLayoutWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  apiProxy = null;
  isWorkerRunning = false;
}

export function preWarmLayoutWorker(): void {
  // Skip pre-warming in test environments to prevent worker instantiation during integration tests
  const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  if (isTest) {
    return;
  }

  if (!isWorkerSupported()) return;

  getLayoutWorker();
  if (apiProxy) {
    apiProxy.preWarm().catch((error) => {
      console.error('Failed to pre-warm layout worker:', error);
    });
  }
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
    layoutDensity?: LayoutDensity;
  } | undefined,
  onResult: (result: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => void,
  onError?: (error: Error) => void
): () => void {
  if (isWorkerRunning) {
    terminateLayoutWorker();
  }

  isWorkerRunning = true;
  getLayoutWorker();

  let cancelled = false;
  let completed = false;

  let serializedPreviousPositions: Array<[string, { x: number; y: number }]> | undefined;
  if (options?.previousPositions) {
    if (options.previousPositions instanceof Map) {
      serializedPreviousPositions = Array.from(options.previousPositions.entries());
    } else {
      serializedPreviousPositions = options.previousPositions;
    }
  }

  apiProxy!.runLayout(rawNodes, rawEdges, direction, {
    theme: options?.theme,
    layoutDensity: options?.layoutDensity,
    previousPositions: serializedPreviousPositions,
  })
    .then((result) => {
      if (cancelled) return;
      completed = true;
      isWorkerRunning = false;
      onResult(result);
    })
    .catch((error) => {
      if (cancelled) return;
      completed = true;
      isWorkerRunning = false;
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      } else {
        console.error(error);
      }
    });

  return () => {
    if (!completed) {
      cancelled = true;
      terminateLayoutWorker();
    }
  };
}
