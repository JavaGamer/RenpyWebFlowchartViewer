import { type Remote, wrap } from "comlink";
import type {
  CanvasEdge,
  CanvasNode,
  FlowEdge,
  FlowNode,
  GraphSimplificationOptions,
  LayoutDensity,
  ThemeName,
} from "../domain/index.ts";
import type { LayoutWorkerApi } from "./layoutWorker.ts";

let worker: Worker | null = null;

function isWorkerSupported(): boolean {
  return typeof globalThis.Worker !== "undefined";
}
let apiProxy: Remote<LayoutWorkerApi> | null = null;
let isWorkerRunning = false;

function getLayoutWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), {
      type: "module",
    });
    apiProxy = wrap<LayoutWorkerApi>(worker);
  }
  return worker;
}

let currentRequestId = 0;

export function terminateLayoutWorker() {
  currentRequestId += 1;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  apiProxy = null;
  isWorkerRunning = false;
}

export function preWarmLayoutWorker(): void {
  // Skip pre-warming in test environments to prevent worker instantiation during integration tests
  const globalProcess =
    (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } })
      .process;
  const isTest = typeof globalProcess !== "undefined" &&
    globalProcess.env?.NODE_ENV === "test";
  if (isTest) {
    return;
  }

  if (!isWorkerSupported()) return;

  getLayoutWorker();
  if (apiProxy) {
    apiProxy.preWarm().catch((error) => {
      console.error("Failed to pre-warm layout worker:", error);
    });
  }
}

export function isLayoutRunning(): boolean {
  return isWorkerRunning;
}

export function runLayoutInWorker(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: "TB" | "LR",
  options: {
    progressive?: boolean;
    previousPositions?:
      | Map<string, { x: number; y: number }>
      | Array<[string, { x: number; y: number }]>;
    theme?: ThemeName;
    layoutDensity?: LayoutDensity;
    simplifyOptions?: GraphSimplificationOptions;
  } | undefined,
  onResult: (result: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => void,
  onError?: (error: Error) => void,
): () => void {
  if (isWorkerRunning) {
    terminateLayoutWorker();
  }

  currentRequestId += 1;
  const thisRequestId = currentRequestId;
  isWorkerRunning = true;
  getLayoutWorker();

  let cancelled = false;
  let completed = false;

  let serializedPreviousPositions:
    | Array<[string, { x: number; y: number }]>
    | undefined;
  if (options?.previousPositions) {
    if (options.previousPositions instanceof Map) {
      serializedPreviousPositions = Array.from(
        options.previousPositions.entries(),
      );
    } else {
      serializedPreviousPositions = options.previousPositions;
    }
  }

  apiProxy!.runLayout(rawNodes, rawEdges, direction, {
    theme: options?.theme,
    layoutDensity: options?.layoutDensity,
    previousPositions: serializedPreviousPositions,
    simplifyOptions: options?.simplifyOptions,
  })
    .then((result) => {
      if (cancelled || thisRequestId !== currentRequestId) return;
      completed = true;
      isWorkerRunning = false;
      onResult(result);
    })
    .catch((error) => {
      if (cancelled || thisRequestId !== currentRequestId) return;
      completed = true;
      isWorkerRunning = false;
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      } else {
        console.error(error);
      }
    });

  return () => {
    if (!completed && thisRequestId === currentRequestId) {
      cancelled = true;
      terminateLayoutWorker();
    }
  };
}
