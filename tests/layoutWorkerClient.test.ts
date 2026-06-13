import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowNode, FlowEdge } from '../src/domain';

class SyncPromise {
  private value: any;
  private error: any;
  private state: 'pending' | 'resolved' | 'rejected' = 'pending';
  private resolveCallbacks: Array<(v: any) => void> = [];
  private rejectCallbacks: Array<(e: any) => void> = [];

  constructor(executor: (resolve: (v: any) => void, reject: (e: any) => void) => void) {
    const resolve = (val: any) => {
      if (this.state !== 'pending') return;
      this.state = 'resolved';
      this.value = val;
      for (const cb of this.resolveCallbacks) cb(val);
    };
    const reject = (err: any) => {
      if (this.state !== 'pending') return;
      this.state = 'rejected';
      this.error = err;
      for (const cb of this.rejectCallbacks) cb(err);
    };
    try {
      executor(resolve, reject);
    } catch (e) {
      reject(e);
    }
  }

  then(onResolve: (v: any) => any, onReject?: (e: any) => any) {
    if (this.state === 'resolved') {
      try {
        const nextVal = onResolve(this.value);
        return SyncPromise.resolve(nextVal);
      } catch (e) {
        return SyncPromise.reject(e);
      }
    }
    if (this.state === 'rejected') {
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

  catch(onReject: (e: any) => any) {
    return this.then((v) => v, onReject);
  }

  static resolve(val: any) {
    return new SyncPromise((resolve) => resolve(val));
  }

  static reject(err: any) {
    return new SyncPromise((_, reject) => reject(err));
  }
}

vi.mock('comlink', () => {
  let activeRequestId = 0;
  return {
    wrap: (worker: any) => {
      return {
        runLayout: (rawNodes: any, rawEdges: any, direction: any, options: any) => {
          const requestId = ++activeRequestId;
          worker.postMessage({
            requestId,
            rawNodes,
            rawEdges,
            direction,
            options,
          });
          return new SyncPromise((resolve, reject) => {
            const listener = (event: any) => {
              const msg = event.data;
              if (msg.requestId !== requestId) return;
              worker.removeEventListener('message', listener);
              worker.removeEventListener('error', errorListener);
              if (msg.error) {
                reject(new Error(msg.error));
              } else {
                resolve(msg.result);
              }
            };
            const errorListener = (event: any) => {
              worker.removeEventListener('error', errorListener);
              worker.removeEventListener('message', listener);
              reject(event.error || new Error(event.message || 'worker crashed'));
            };
            worker.addEventListener('message', listener);
            worker.addEventListener('error', errorListener);
          });
        }
      };
    }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return vi.fn().mockImplementation(function MockWorkerImpl(this: any) {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    const instance: MockWorkerInstance = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      listeners,
      triggerMessage(data: unknown) {
        for (const h of listeners['message'] ?? []) h({ data } as MessageEvent);
      },
      triggerError(event: Partial<ErrorEvent> = {}) {
        for (const h of listeners['error'] ?? []) h(event as ErrorEvent);
      },
    };

    // Bind addEventListener / removeEventListener as real methods so the
    // module under test can register and remove event handlers.
    (instance as unknown as Record<string, unknown>)['addEventListener'] = (
      type: string,
      handler: (...args: unknown[]) => void,
    ) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(handler);
    };
    (instance as unknown as Record<string, unknown>)['removeEventListener'] = (
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
  return import('../src/infrastructure/layoutWorkerClient');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('layoutWorkerClient', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', createMockWorkerClass());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a Worker and posts the layout message', async () => {
    const { runLayoutInWorker } = await freshClient();

    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, vi.fn());

    expect(vi.mocked(globalThis.Worker)).toHaveBeenCalledTimes(1);
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ rawNodes: noNodes, rawEdges: noEdges, direction: 'TB' });
    expect(typeof payload['requestId']).toBe('number');
  });

  it('calls onResult with the layout result when the worker replies with a matching requestId', async () => {
    const { runLayoutInWorker } = await freshClient();
    const onResult = vi.fn();

    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, onResult);

    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as { requestId: number };
    const fakeResult = { nodes: [], edges: [] };
    mockWorkerInstance.triggerMessage({ requestId: payload.requestId, result: fakeResult });

    expect(onResult).toHaveBeenCalledWith(fakeResult);
  });

  it('ignores messages whose requestId does not match', async () => {
    const { runLayoutInWorker } = await freshClient();
    const onResult = vi.fn();

    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, onResult);

    // Reply with a stale / wrong id
    mockWorkerInstance.triggerMessage({ requestId: 9999, result: { nodes: [], edges: [] } });

    expect(onResult).not.toHaveBeenCalled();
  });

  it('removes BOTH message and error listeners after a successful result', async () => {
    const { runLayoutInWorker } = await freshClient();

    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, vi.fn());
    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as { requestId: number };
    mockWorkerInstance.triggerMessage({ requestId: payload.requestId, result: { nodes: [], edges: [] } });

    // Both listener arrays should now be empty — no listener leaks
    expect(mockWorkerInstance.listeners['message'] ?? []).toHaveLength(0);
    expect(mockWorkerInstance.listeners['error'] ?? []).toHaveLength(0);
  });

  it('calls onError and cleans up listeners when the worker emits an error event', async () => {
    const { runLayoutInWorker } = await freshClient();
    const onResult = vi.fn();
    const onError = vi.fn();

    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, onResult, onError);

    const fakeError = new Error('worker crashed');
    mockWorkerInstance.triggerError({ error: fakeError, message: 'worker crashed' });

    expect(onError).toHaveBeenCalledWith(fakeError);
    expect(onResult).not.toHaveBeenCalled();
    expect(mockWorkerInstance.listeners['message'] ?? []).toHaveLength(0);
    expect(mockWorkerInstance.listeners['error'] ?? []).toHaveLength(0);
  });

  it('falls back to Error(event.message) when ErrorEvent.error is falsy', async () => {
    const { runLayoutInWorker } = await freshClient();
    const onError = vi.fn();

    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, vi.fn(), onError);
    mockWorkerInstance.triggerError({ error: null as unknown as Error, message: 'oops' });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect((onError.mock.calls[0][0] as Error).message).toBe('oops');
  });

  it('terminates an active worker when a new layout request arrives', async () => {
    const { runLayoutInWorker } = await freshClient();

    // First request — do NOT resolve it, so the worker is still "running"
    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, vi.fn());
    const firstInstance = mockWorkerInstance;

    // Second request should terminate the first worker and create a new one
    runLayoutInWorker(noNodes, noEdges, 'LR', undefined, vi.fn());

    expect(firstInstance.terminate).toHaveBeenCalledTimes(1);
    // A new Worker should have been created for the second request
    expect(vi.mocked(globalThis.Worker)).toHaveBeenCalledTimes(2);
  });

  it('serialises a Map previousPositions to an array before posting', async () => {
    const { runLayoutInWorker } = await freshClient();

    const prev = new Map<string, { x: number; y: number }>([['node1', { x: 10, y: 20 }]]);
    runLayoutInWorker(noNodes, noEdges, 'TB', { previousPositions: prev }, vi.fn());

    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      options: { previousPositions: unknown };
    };
    expect(Array.isArray(payload.options.previousPositions)).toBe(true);
    expect(payload.options.previousPositions).toEqual([['node1', { x: 10, y: 20 }]]);
  });

  it('terminateLayoutWorker terminates the worker and resets running state', async () => {
    const { runLayoutInWorker, terminateLayoutWorker, isLayoutRunning } = await freshClient();

    runLayoutInWorker(noNodes, noEdges, 'TB', undefined, vi.fn());
    expect(isLayoutRunning()).toBe(true);

    terminateLayoutWorker();

    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
    expect(isLayoutRunning()).toBe(false);
  });

  it('cancel function returned by runLayoutInWorker terminates the worker', async () => {
    const { runLayoutInWorker, isLayoutRunning } = await freshClient();

    const cancel = runLayoutInWorker(noNodes, noEdges, 'TB', undefined, vi.fn());
    expect(isLayoutRunning()).toBe(true);

    cancel();

    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
    expect(isLayoutRunning()).toBe(false);
  });

  it('cancel is a no-op after the layout has already completed', async () => {
    const { runLayoutInWorker } = await freshClient();

    const cancel = runLayoutInWorker(noNodes, noEdges, 'TB', undefined, vi.fn());
    const payload = mockWorkerInstance.postMessage.mock.calls[0][0] as { requestId: number };
    // Resolve the layout first
    mockWorkerInstance.triggerMessage({ requestId: payload.requestId, result: { nodes: [], edges: [] } });

    // Now cancel should be a no-op (the requestId no longer matches activeRequestId)
    cancel();
    expect(mockWorkerInstance.terminate).not.toHaveBeenCalled();
  });
});
