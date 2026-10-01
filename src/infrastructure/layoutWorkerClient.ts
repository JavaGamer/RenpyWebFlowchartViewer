import { releaseProxy, type Remote, wrap } from "comlink";
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
import type { AABB, SpatialItem } from "./spatialIndex.ts";

let worker: Worker | null = null;

function isWorkerSupported(): boolean {
  if (typeof globalThis.Worker === "undefined") return false;
  if (
    typeof window !== "undefined" &&
    window.location?.hostname === "localhost" &&
    typeof (window as unknown as { __vitest_worker__?: unknown })
        .__vitest_worker__ !== "undefined" &&
    globalThis.Worker.name !== "MockWorker"
  ) {
    return false;
  }
  return true;
}
let apiProxy: Remote<LayoutWorkerApi> | null = null;
let isWorkerBusy = false;
let activeInFlightCancelled = false;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

export const DEFAULT_LAYOUT_WATCHDOG_TIMEOUT_MS = 5000;
let layoutWatchdogTimeoutMs = DEFAULT_LAYOUT_WATCHDOG_TIMEOUT_MS;

export function setLayoutWatchdogTimeoutMs(ms: number): void {
  layoutWatchdogTimeoutMs = ms;
}

let lastSyncedRawNodesRef: FlowNode[] | null = null;
let lastSyncedRawEdgesRef: FlowEdge[] | null = null;
let currentGraphRevision = 0;
let workerHasSyncedGraph = false;

interface LayoutRequestOptions {
  progressive?: boolean;
  previousPositions?:
    | Map<string, { x: number; y: number }>
    | Array<[string, { x: number; y: number }]>;
  theme?: ThemeName;
  layoutDensity?: LayoutDensity;
  simplifyOptions?: GraphSimplificationOptions;
  enableCompoundContainers?: boolean;
  collapsedChapters?: Record<string, boolean>;
  collapsedParentLabels?: Record<string, boolean>;
}

type LayoutResultCallback = (result: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  spatialItems?: SpatialItem[];
  spatialBounds?: AABB;
}) => void;

interface QueuedLayoutRequest {
  requestId: number;
  rawNodes: FlowNode[];
  rawEdges: FlowEdge[];
  direction: "TB" | "LR";
  options?: LayoutRequestOptions;
  onResult: LayoutResultCallback;
  onError?: (error: Error) => void;
  isCancelled: () => boolean;
  markCompleted: () => void;
}

let pendingRequest: QueuedLayoutRequest | null = null;
let activeInFlightRequest: QueuedLayoutRequest | null = null;

function clearWatchdogTimer() {
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function getLayoutWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), {
      type: "module",
    });
    apiProxy = wrap<LayoutWorkerApi>(worker);
    workerHasSyncedGraph = false;
  }
  return worker;
}

let currentRequestId = 0;

export function terminateLayoutWorker() {
  currentRequestId += 1;
  clearWatchdogTimer();
  pendingRequest = null;
  activeInFlightRequest = null;
  activeInFlightCancelled = true;
  workerHasSyncedGraph = false;
  if (apiProxy) {
    try {
      apiProxy[releaseProxy]();
    } catch {
      // Ignore
    }
    apiProxy = null;
  }
  if (worker) {
    worker.terminate();
    worker = null;
  }
  isWorkerBusy = false;
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
  return (isWorkerBusy && !activeInFlightCancelled) || pendingRequest !== null;
}

function stripDialoguePayload(rawNodes: FlowNode[]): FlowNode[] {
  let hasDialoguePayload = false;
  for (let i = 0; i < rawNodes.length; i++) {
    const n = rawNodes[i]!;
    if (n.dialogueLines !== undefined || n.dialogueLineNums !== undefined) {
      hasDialoguePayload = true;
      break;
    }
  }
  if (!hasDialoguePayload) return rawNodes;
  return rawNodes.map((n) => {
    if (n.dialogueLines === undefined && n.dialogueLineNums === undefined) {
      return n;
    }
    const copy = { ...n };
    delete copy.dialogueLines;
    delete copy.dialogueLineNums;
    return copy;
  });
}

function rehydrateCanvasNodes(
  nodes: CanvasNode[],
  rawNodes: FlowNode[],
): CanvasNode[] {
  if (nodes.length === 0 || rawNodes.length === 0) return nodes;
  const rawById = new Map<string, FlowNode>();
  let anyDialogue = false;
  for (let i = 0; i < rawNodes.length; i++) {
    const rn = rawNodes[i]!;
    rawById.set(rn.id, rn);
    if (rn.dialogueLines !== undefined || rn.dialogueLineNums !== undefined) {
      anyDialogue = true;
    }
  }
  if (!anyDialogue) return nodes;

  return nodes.map((cn) => {
    const collapsedIds = cn.data?.collapsedNodeIds;
    if (collapsedIds && collapsedIds.length > 1) {
      const dialogueLines: string[] = [];
      const dialogueLineNums: number[] = [];
      let hasLines = false;
      let hasLineNums = false;
      for (const id of collapsedIds) {
        const member = rawById.get(id);
        if (member?.dialogueLines && member.dialogueLines.length > 0) {
          hasLines = true;
          for (let idx = 0; idx < member.dialogueLines.length; idx++) {
            dialogueLines.push(member.dialogueLines[idx]!);
            if (
              member.dialogueLineNums && idx < member.dialogueLineNums.length
            ) {
              hasLineNums = true;
              dialogueLineNums.push(member.dialogueLineNums[idx]!);
            } else {
              dialogueLineNums.push(member.sourceLocation?.start.line ?? 0);
            }
          }
        }
      }
      return {
        ...cn,
        data: {
          ...cn.data,
          dialogueLines: hasLines ? dialogueLines : cn.data.dialogueLines,
          dialogueLineNums: hasLineNums
            ? dialogueLineNums
            : cn.data.dialogueLineNums,
        },
      };
    }

    const orig = rawById.get(cn.id);
    if (!orig) return cn;
    if (
      orig.dialogueLines === cn.data?.dialogueLines &&
      orig.dialogueLineNums === cn.data?.dialogueLineNums
    ) {
      return cn;
    }
    return {
      ...cn,
      data: {
        ...cn.data,
        dialogueLines: orig.dialogueLines,
        dialogueLineNums: orig.dialogueLineNums,
      },
    };
  });
}

function dispatchRequest(req: QueuedLayoutRequest): void {
  isWorkerBusy = true;
  activeInFlightCancelled = req.isCancelled();
  activeInFlightRequest = req;
  getLayoutWorker();

  if (
    req.rawNodes !== lastSyncedRawNodesRef ||
    req.rawEdges !== lastSyncedRawEdgesRef
  ) {
    currentGraphRevision += 1;
    lastSyncedRawNodesRef = req.rawNodes;
    lastSyncedRawEdgesRef = req.rawEdges;
    workerHasSyncedGraph = false;
  }

  let nodesToSend: FlowNode[] | null;
  let edgesToSend: FlowEdge[] | null;
  if (workerHasSyncedGraph && req.rawNodes.length > 0) {
    nodesToSend = null;
    edgesToSend = null;
  } else {
    nodesToSend = stripDialoguePayload(req.rawNodes);
    edgesToSend = req.rawEdges;
    workerHasSyncedGraph = true;
  }

  let serializedPreviousPositions:
    | Array<[string, { x: number; y: number }]>
    | undefined;
  if (req.options?.previousPositions) {
    if (req.options.previousPositions instanceof Map) {
      serializedPreviousPositions = Array.from(
        req.options.previousPositions.entries(),
      );
    } else {
      serializedPreviousPositions = req.options.previousPositions;
    }
  }

  clearWatchdogTimer();
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    const targetReq = pendingRequest ?? activeInFlightRequest;
    const errCallback = targetReq && !targetReq.isCancelled()
      ? targetReq.onError
      : undefined;
    if (targetReq) {
      targetReq.markCompleted();
    }
    terminateLayoutWorker();
    if (errCallback) {
      errCallback(new Error("Layout worker timed out"));
    }
  }, layoutWatchdogTimeoutMs);

  apiProxy!.runLayout(nodesToSend, edgesToSend, req.direction, {
    theme: req.options?.theme,
    layoutDensity: req.options?.layoutDensity,
    previousPositions: serializedPreviousPositions,
    simplifyOptions: req.options?.simplifyOptions,
    enableCompoundContainers: req.options?.enableCompoundContainers,
    collapsedChapters: req.options?.collapsedChapters,
    collapsedParentLabels: req.options?.collapsedParentLabels,
    graphRevision: currentGraphRevision,
  })
    .then((result) => {
      clearWatchdogTimer();
      isWorkerBusy = false;
      activeInFlightRequest = null;

      if (pendingRequest) {
        req.markCompleted();
        const next = pendingRequest;
        pendingRequest = null;
        dispatchRequest(next);
        return;
      }

      if (req.isCancelled() || req.requestId !== currentRequestId) return;
      req.markCompleted();
      const rehydratedNodes = rehydrateCanvasNodes(result.nodes, req.rawNodes);
      req.onResult(
        rehydratedNodes === result.nodes
          ? result
          : { ...result, nodes: rehydratedNodes },
      );
    })
    .catch((error) => {
      clearWatchdogTimer();
      isWorkerBusy = false;
      activeInFlightRequest = null;
      workerHasSyncedGraph = false;
      lastSyncedRawNodesRef = null;
      lastSyncedRawEdgesRef = null;

      if (pendingRequest) {
        req.markCompleted();
        const next = pendingRequest;
        pendingRequest = null;
        dispatchRequest(next);
        return;
      }

      if (req.isCancelled() || req.requestId !== currentRequestId) return;
      req.markCompleted();
      if (req.onError) {
        req.onError(error instanceof Error ? error : new Error(String(error)));
      } else {
        console.error(error);
      }
    });
}

export function runLayoutInWorker(
  rawNodes: FlowNode[],
  rawEdges: FlowEdge[],
  direction: "TB" | "LR",
  options: LayoutRequestOptions | undefined,
  onResult: LayoutResultCallback,
  onError?: (error: Error) => void,
): () => void {
  if (!isWorkerSupported()) {
    if (onError) {
      onError(new Error("Web Worker is not supported in this environment"));
    }
    return () => {};
  }

  currentRequestId += 1;
  const thisRequestId = currentRequestId;

  let cancelled = false;
  let completed = false;

  const req: QueuedLayoutRequest = {
    requestId: thisRequestId,
    rawNodes,
    rawEdges,
    direction,
    options,
    onResult,
    onError,
    isCancelled: () => cancelled,
    markCompleted: () => {
      completed = true;
    },
  };

  if (isWorkerBusy) {
    pendingRequest = req;
  } else {
    dispatchRequest(req);
  }

  return () => {
    if (!completed) {
      cancelled = true;
      if (pendingRequest?.requestId === thisRequestId) {
        pendingRequest = null;
      }
      if (activeInFlightRequest?.requestId === thisRequestId) {
        activeInFlightCancelled = true;
      }
    }
  };
}
