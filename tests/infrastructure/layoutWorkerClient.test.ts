import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowEdge, FlowNode } from "../../src/domain";

class SyncPromise {
  private value: unknown;
  private error: unknown;
  private state: "pending" | "resolved" | "rejected" = "pending";
  private resolveCallbacks: Array<(v: unknown) => void> = [];
  private rejectCallbacks: Array<(e: unknown) => void> = [];

  constructor(
    executor: (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => void,
  ) {
    const resolve = (val: unknown) => {
      if (this.state !== "pending") return;
      this.state = "resolved";
      this.value = val;
      for (const cb of this.resolveCallbacks) cb(val);
    };
    const reject = (err: unknown) => {
      if (this.state !== "pending") return;
      this.state = "rejected";
      this.error = err;
      for (const cb of this.rejectCallbacks) cb(err);
    };
    try {
      executor(resolve, reject);
    } catch (e) {
      reject(e);
    }
  }

  then(onResolve: (v: unknown) => unknown, onReject?: (e: unknown) => unknown) {
    if (this.state === "resolved") {
      try {
        const nextVal = onResolve(this.value);
        return SyncPromise.resolve(nextVal);
      } catch (e) {
        return SyncPromise.reject(e);
      }
    }
    if (this.state === "rejected") {
      if (onReject) {
        try {
          const nextVal = onReject(this.error);
          return SyncPromise.resolve(nextVal);
        } catch (e) {
          return SyncPromise.reject(e);
        }
      }
      return SyncPromise.reject(this.error);
    }
    return new SyncPromise((resolve, reject) => {
      this.resolveCallbacks.push((val) => {
        try {
          const res = onResolve(val);
          resolve(res);
        } catch (e) {
          reject(e);
        }
      });
      if (onReject) {
        this.rejectCallbacks.push((err) => {
          try {
            const res = onReject(err);
            resolve(res);
          } catch (e) {
            reject(e);
          }
        });
      } else {
        this.rejectCallbacks.push(reject);
      }
    });
  }

  catch(onReject: (e: unknown) => unknown) {
    return this.then((v) => v, onReject);
  }

  static resolve(val: unknown) {
    return new SyncPromise((resolve) => resolve(val));
  }

  static reject(err: unknown) {
    return new SyncPromise((_, reject) => reject(err));
  }
}

export const mockWorkersSupported = true;
vi.mock(
  "../../src/infrastructure/parserWorkerClient",
  async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>();
    return {
      ...original,
      areWorkersSupported: () => mockWorkersSupported,
    };
  },
);

vi.mock("comlink", () => {
  let activeRequestId = 0;
  return {
    wrap: (
      worker: {
        postMessage: (msg: unknown) => void;
        addEventListener: (
          type: string,
          listener: (event: MessageEvent) => void,
        ) => void;
        removeEventListener: (
          type: string,
          listener: (event: MessageEvent) => void,
        ) => void;
      },
    ) => {
      return {
        preWarm: () => {
          const requestId = ++activeRequestId;
          worker.postMessage({
            requestId,
            type: "preWarm",
          });
          return new SyncPromise((resolve, reject) => {
            const listener = (event: MessageEvent) => {
              const msg = event.data;
              if (msg.requestId !== requestId) return;
              worker.removeEventListener("message", listener);
              worker.removeEventListener("error", errorListener);
              if (msg.error) {
                reject(new Error(msg.error));
              } else {
                resolve(undefined);
              }
            };
            const errorListener = (event: ErrorEvent) => {
              worker.removeEventListener("error", errorListener);
              worker.removeEventListener("message", listener);
              reject(
                event.error || new Error(event.message || "worker crashed"),
              );
            };
            worker.addEventListener("message", listener);
            worker.addEventListener("error", errorListener);
          });
        },
        runLayout: (
          rawNodes: unknown,
          rawEdges: unknown,
          direction: unknown,
          options: unknown,
        ) => {
          const requestId = ++activeRequestId;
          worker.postMessage({
            requestId,
            rawNodes,
            rawEdges,
            direction,
            options,
          });
          return new SyncPromise((resolve, reject) => {
            const listener = (event: MessageEvent) => {
              const msg = event.data;
              if (msg.requestId !== requestId) return;
              worker.removeEventListener("message", listener);
              worker.removeEventListener("error", errorListener);
              if (msg.error) {
                reject(new Error(msg.error));
              } else {
                resolve(msg.result);
              }
            };
            const errorListener = (event: ErrorEvent) => {
              worker.removeEventListener("error", errorListener);
              worker.removeEventListener("message", listener);
              reject(
                event.error || new Error(event.message || "worker crashed"),
              );
            };
            worker.addEventListener("message", listener);
            worker.addEventListener("error", errorListener);
          });
        },
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Worker mock infrastructure
// ---------------------------------------------------------------------------

interface MockWorkerInstance {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  /** Helpers to simulate incoming messages / errors from the worker */
  triggerMessage: (data: unknown) => void;
  triggerError: (event?: Partial<ErrorEvent>) => void;
  /** Snapshot of registered listeners by type */
  listeners: Record<string, ((...args: unknown[]) => void)[]>;
}

let mockWorkerInstance: MockWorkerInstance;

/**
 * Returns a vi.fn() that can be called with `new`.
 * IMPORTANT: The implementation MUST be a regular function (not an arrow),
 * otherwise `new impl()` throws "is not a constructor".
 * Returning a plain object from a constructor function makes `new expr` use
 * that object rather than the implicit `this`.
 */
function createMockWorkerClass() {
  return vi.fn().mockImplementation(function MockWorkerImpl(this: unknown) {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    const instance: MockWorkerInstance = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      listeners,
      triggerMessage(data: unknown) {
        for (const h of listeners["message"] ?? []) h({ data } as MessageEvent);
      },
      triggerError(event: Partial<ErrorEvent> = {}) {
        for (const h of listeners["error"] ?? []) h(event as ErrorEvent);
      },
    };

    // Bind addEventListener / removeEventListener as real methods so the
    // module under test can register and remove event handlers.
    (instance as unknown as Record<string, unknown>)["addEventListener"] = (
      type: string,
      handler: (...args: unknown[]) => void,
    ) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(handler);
    };
    (instance as unknown as Record<string, unknown>)["removeEventListener"] = (
      type: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((h) => h !== handler);
    };

    mockWorkerInstance = instance;
    // Return the plain object — when a constructor returns an object,
    // `new expr` uses it as the result rather than `this`.
    return instance;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noNodes: FlowNode[] = [];
const noEdges: FlowEdge[] = [];

/**
 * Reset the module registry so each test gets a clean copy of the module
 * singleton (the `worker`, `activeRequestId`, and `isWorkerRunning` variables
 * inside layoutWorkerClient.ts are all reset).
 */
async function freshClient() {
  vi.resetModules();
  return await import("../../src/infrastructure/layoutWorkerClient");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("layoutWorkerClient", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", createMockWorkerClass());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a Worker and posts the layout message", async () => {
    const { runLayoutInWorker } = await freshClient();

    runLayoutInWorker(noNodes, noEdges, "TB", undefined, vi.fn());

    expect(vi.mocked(globalThis.Worker)).toHaveBeenCalledTimes(1);
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      rawNodes: noNodes,
      rawEdges: noEdges,
      direction: "TB",
    });
    expect(typeof payload["requestId"]).toBe("number");
  });

  it("calls onResult with the layout result when the worker replies with a matching requestId", async () => {
    const { runLayoutInWorker } = await freshClient();
    const onResult = vi.fn();

    runLayoutInWorker(noNodes, noEdges, "TB", undefined, onResult);

    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      requestId: number;
    };
    const fakeResult = { nodes: [], edges: [] };
    mockWorkerInstance.triggerMessage({
      requestId: payload.requestId,
      result: fakeResult,
    });

    expect(onResult).toHaveBeenCalledWith(fakeResult);
  });

  it("ignores messages whose requestId does not match", async () => {
    const { runLayoutInWorker } = await freshClient();
    const onResult = vi.fn();

    runLayoutInWorker(noNodes, noEdges, "TB", undefined, onResult);

    // Reply with a stale / wrong id
    mockWorkerInstance.triggerMessage({
      requestId: 9999,
      result: { nodes: [], edges: [] },
    });

    expect(onResult).not.toHaveBeenCalled();
  });

  it("removes BOTH message and error listeners after a successful result", async () => {
    const { runLayoutInWorker } = await freshClient();

    runLayoutInWorker(noNodes, noEdges, "TB", undefined, vi.fn());
    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      requestId: number;
    };
    mockWorkerInstance.triggerMessage({
      requestId: payload.requestId,
      result: { nodes: [], edges: [] },
    });

    // Both listener arrays should now be empty — no listener leaks
    expect(mockWorkerInstance.listeners["message"] ?? []).toHaveLength(0);
    expect(mockWorkerInstance.listeners["error"] ?? []).toHaveLength(0);
  });

  it("calls onError and cleans up listeners when the worker emits an error event", async () => {
    const { runLayoutInWorker } = await freshClient();
    const onResult = vi.fn();
    const onError = vi.fn();

    runLayoutInWorker(noNodes, noEdges, "TB", undefined, onResult, onError);

    const fakeError = new Error("worker crashed");
    mockWorkerInstance.triggerError({
      error: fakeError,
      message: "worker crashed",
    });

    expect(onError).toHaveBeenCalledWith(fakeError);
    expect(onResult).not.toHaveBeenCalled();
    expect(mockWorkerInstance.listeners["message"] ?? []).toHaveLength(0);
    expect(mockWorkerInstance.listeners["error"] ?? []).toHaveLength(0);
  });

  it("falls back to Error(event.message) when ErrorEvent.error is falsy", async () => {
    const { runLayoutInWorker } = await freshClient();
    const onError = vi.fn();

    runLayoutInWorker(noNodes, noEdges, "TB", undefined, vi.fn(), onError);
    mockWorkerInstance.triggerError({
      error: null as unknown as Error,
      message: "oops",
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect((onError.mock.calls[0][0] as Error).message).toBe("oops");
  });

  it("coalesces overlapping requests in a latest-wins single-slot queue on the warm worker without terminating it", async () => {
    const { runLayoutInWorker } = await freshClient();
    const onResult1 = vi.fn();
    const onResult2 = vi.fn();
    const onResult3 = vi.fn();

    // First request — in flight
    runLayoutInWorker(noNodes, noEdges, "TB", undefined, onResult1);
    const firstInstance = mockWorkerInstance;
    expect(firstInstance.postMessage).toHaveBeenCalledTimes(1);

    // Second request arrives while first is in flight — queued
    runLayoutInWorker(noNodes, noEdges, "LR", undefined, onResult2);
    // Third request arrives while first is still in flight — replaces second (latest-wins)
    runLayoutInWorker(
      noNodes,
      noEdges,
      "LR",
      { layoutDensity: "compact" },
      onResult3,
    );

    // Warm worker is NOT terminated and no second Worker is constructed
    expect(firstInstance.terminate).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.Worker)).toHaveBeenCalledTimes(1);
    expect(firstInstance.postMessage).toHaveBeenCalledTimes(1);

    // Resolve the first in-flight request
    const firstPayload = firstInstance.postMessage.mock.calls[0][0] as {
      requestId: number;
    };
    firstInstance.triggerMessage({
      requestId: firstPayload.requestId,
      result: { nodes: [], edges: [] },
    });

    // First and second callbacks were superseded; third request is now dispatched on the same worker
    expect(onResult1).not.toHaveBeenCalled();
    expect(onResult2).not.toHaveBeenCalled();
    expect(firstInstance.postMessage).toHaveBeenCalledTimes(2);

    const thirdPayload = firstInstance.postMessage.mock.calls[1][0] as {
      requestId: number;
      direction: string;
      options: { layoutDensity: string };
    };
    expect(thirdPayload.direction).toBe("LR");
    expect(thirdPayload.options.layoutDensity).toBe("compact");

    // Resolve the third request
    const finalResult = { nodes: [], edges: [] };
    firstInstance.triggerMessage({
      requestId: thirdPayload.requestId,
      result: finalResult,
    });
    expect(onResult3).toHaveBeenCalledWith(finalResult);
  });

  it("serialises a Map previousPositions to an array before posting", async () => {
    const { runLayoutInWorker } = await freshClient();

    const prev = new Map<string, { x: number; y: number }>([["node1", {
      x: 10,
      y: 20,
    }]]);
    runLayoutInWorker(
      noNodes,
      noEdges,
      "TB",
      { previousPositions: prev },
      vi.fn(),
    );

    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      options: { previousPositions: unknown };
    };
    expect(Array.isArray(payload.options.previousPositions)).toBe(true);
    expect(payload.options.previousPositions).toEqual([["node1", {
      x: 10,
      y: 20,
    }]]);
  });

  it("terminateLayoutWorker terminates the worker and resets running state", async () => {
    const { runLayoutInWorker, terminateLayoutWorker, isLayoutRunning } =
      await freshClient();

    runLayoutInWorker(noNodes, noEdges, "TB", undefined, vi.fn());
    expect(isLayoutRunning()).toBe(true);

    terminateLayoutWorker();

    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
    expect(isLayoutRunning()).toBe(false);
  });

  it("cancel function returned by runLayoutInWorker cancels the request without terminating the warm worker", async () => {
    const { runLayoutInWorker, isLayoutRunning } = await freshClient();
    const onResult = vi.fn();

    const cancel = runLayoutInWorker(
      noNodes,
      noEdges,
      "TB",
      undefined,
      onResult,
    );
    expect(isLayoutRunning()).toBe(true);

    cancel();

    expect(mockWorkerInstance.terminate).not.toHaveBeenCalled();
    expect(isLayoutRunning()).toBe(false);

    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      requestId: number;
    };
    mockWorkerInstance.triggerMessage({
      requestId: payload.requestId,
      result: { nodes: [], edges: [] },
    });
    expect(onResult).not.toHaveBeenCalled();
  });

  it("cancel is a no-op after the layout has already completed", async () => {
    const { runLayoutInWorker } = await freshClient();

    const cancel = runLayoutInWorker(
      noNodes,
      noEdges,
      "TB",
      undefined,
      vi.fn(),
    );
    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      requestId: number;
    };
    // Resolve the layout first
    mockWorkerInstance.triggerMessage({
      requestId: payload.requestId,
      result: { nodes: [], edges: [] },
    });

    // Now cancel should be a no-op
    cancel();
    expect(mockWorkerInstance.terminate).not.toHaveBeenCalled();
  });

  it("terminates a hung worker and calls onError when the watchdog timeout expires", async () => {
    vi.useFakeTimers();
    try {
      const {
        runLayoutInWorker,
        setLayoutWatchdogTimeoutMs,
        isLayoutRunning,
      } = await freshClient();
      setLayoutWatchdogTimeoutMs(200);
      const onError = vi.fn();

      runLayoutInWorker(noNodes, noEdges, "TB", undefined, vi.fn(), onError);
      expect(isLayoutRunning()).toBe(true);

      vi.advanceTimersByTime(250);

      expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
      expect(isLayoutRunning()).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect((onError.mock.calls[0][0] as Error).message).toContain(
        "Layout worker timed out",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("strips dialogueLines/dialogueLineNums before IPC, re-hydrates them on result (including collapsedNodeIds), and omits unchanged rawNodes on repeat calls", async () => {
    const { runLayoutInWorker } = await freshClient();
    const nodesWithDialogue: FlowNode[] = [
      {
        id: "n1",
        type: "LABEL",
        label: "Start",
        dialogueCount: 2,
        dialogueLines: ["Hello", "World"],
        dialogueLineNums: [10, 11],
      },
      {
        id: "n2",
        type: "LABEL",
        label: "Next",
        dialogueCount: 1,
        dialogueLines: ["Continuation"],
        dialogueLineNums: [20],
      },
    ];
    const edges: FlowEdge[] = [
      { id: "e1", source: "n1", target: "n2", kind: "sequence" },
    ];

    const onResult1 = vi.fn();
    runLayoutInWorker(nodesWithDialogue, edges, "TB", undefined, onResult1);

    const firstPayload = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      requestId: number;
      rawNodes: FlowNode[];
      rawEdges: FlowEdge[];
    };
    expect(firstPayload.rawNodes).toHaveLength(2);
    expect(firstPayload.rawNodes[0]?.dialogueLines).toBeUndefined();
    expect(firstPayload.rawNodes[0]?.dialogueLineNums).toBeUndefined();

    // Simulate worker returning a merged node n1 with collapsedNodeIds: ["n1", "n2"]
    mockWorkerInstance.triggerMessage({
      requestId: firstPayload.requestId,
      result: {
        nodes: [
          {
            id: "n1",
            type: "labelNode",
            position: { x: 0, y: 0 },
            data: {
              label: "Start",
              dialogueCount: 3,
              nodeType: "LABEL",
              collapsedLabels: ["Next"],
              collapsedNodeIds: ["n1", "n2"],
            },
          },
        ],
        edges: [],
      },
    });

    expect(onResult1).toHaveBeenCalledTimes(1);
    const rehydratedNode = onResult1.mock.calls[0][0].nodes[0];
    expect(rehydratedNode.data.dialogueLines).toEqual([
      "Hello",
      "World",
      "Continuation",
    ]);
    expect(rehydratedNode.data.dialogueLineNums).toEqual([10, 11, 20]);

    // Second call with the same rawNodes & rawEdges references should send null, null
    const onResult2 = vi.fn();
    runLayoutInWorker(nodesWithDialogue, edges, "LR", undefined, onResult2);
    const secondPayload = mockWorkerInstance.postMessage.mock.calls[1][0] as {
      requestId: number;
      rawNodes: FlowNode[] | null;
      rawEdges: FlowEdge[] | null;
      options: { graphRevision?: number };
    };
    expect(secondPayload.rawNodes).toBeNull();
    expect(secondPayload.rawEdges).toBeNull();
    expect(typeof secondPayload.options.graphRevision).toBe("number");
  });

  describe("preWarmLayoutWorker", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("creates a Worker and posts the preWarm message", async () => {
      const { preWarmLayoutWorker } = await freshClient();

      preWarmLayoutWorker();

      expect(vi.mocked(globalThis.Worker)).toHaveBeenCalledTimes(1);
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
      const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(payload).toMatchObject({ type: "preWarm" });
      expect(typeof payload["requestId"]).toBe("number");
    });

    it("bypasses pre-warming when workers are not supported", async () => {
      const { preWarmLayoutWorker } = await freshClient();
      vi.stubGlobal("Worker", undefined);

      preWarmLayoutWorker();
    });

    it("bypasses pre-warming when NODE_ENV is test", async () => {
      vi.stubEnv("NODE_ENV", "test");
      const { preWarmLayoutWorker } = await freshClient();

      preWarmLayoutWorker();

      expect(vi.mocked(globalThis.Worker)).not.toHaveBeenCalled();
    });
  });
});
