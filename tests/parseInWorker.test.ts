import { describe, expect, it, vi, beforeEach } from 'vitest';

let workerMessageHandlers = new Set<(event: MessageEvent) => void>();
let postedMessages: unknown[] = [];

class MockWorker {
  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (type === 'message') workerMessageHandlers.add(handler);
  }
  removeEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (type === 'message') workerMessageHandlers.delete(handler);
  }
  postMessage(message: unknown) {
    postedMessages.push(message);
  }
}

vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);

describe('parseRenpyFilesInWorker', () => {
  beforeEach(() => {
    postedMessages = [];
    workerMessageHandlers = new Set();
    vi.resetModules();
  });

  const emitWorkerMessage = (data: unknown) => {
    const handlers = Array.from(workerMessageHandlers);
    for (const handler of handlers) {
      handler({ data } as MessageEvent);
    }
  };

  it('supports concurrent requests and resolves each by requestId', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/parseInWorker');

    const first = parseRenpyFilesInWorker({ files: [{ name: 'a.rpy', content: 'label a:' }] });
    const second = parseRenpyFilesInWorker({ files: [{ name: 'b.rpy', content: 'label b:' }] });

    const firstRequestId = (postedMessages[0] as { requestId: number }).requestId;
    const secondRequestId = (postedMessages[1] as { requestId: number }).requestId;

    emitWorkerMessage({ type: 'result', requestId: secondRequestId, nodes: [{ id: 'b' }], edges: [] });
    emitWorkerMessage({ type: 'result', requestId: firstRequestId, nodes: [{ id: 'a' }], edges: [] });

    await expect(second).resolves.toEqual({ nodes: [{ id: 'b' }], edges: [] });
    await expect(first).resolves.toEqual({ nodes: [{ id: 'a' }], edges: [] });
  });

  it('posts cancel message and rejects with AbortError when signal aborts', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/parseInWorker');
    const controller = new AbortController();
    const promise = parseRenpyFilesInWorker({
      files: [{ name: 'a.rpy', content: 'label a:' }],
      signal: controller.signal,
    });
    controller.abort();

    const cancelMessage = postedMessages.find(
      (m) => (m as { type?: string }).type === 'cancel',
    ) as { type: string } | undefined;
    expect(cancelMessage?.type).toBe('cancel');
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
