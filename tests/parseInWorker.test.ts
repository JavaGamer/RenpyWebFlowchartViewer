import { describe, expect, it, vi, beforeEach } from 'vitest';

let workerMessageHandler: ((event: MessageEvent) => void) | null = null;
let postedMessages: unknown[] = [];

class MockWorker {
  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (type === 'message') workerMessageHandler = handler;
  }
  removeEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (type === 'message' && workerMessageHandler === handler) workerMessageHandler = null;
  }
  postMessage(message: unknown) {
    postedMessages.push(message);
  }
}

vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);

describe('parseRenpyFilesInWorker', () => {
  beforeEach(() => {
    postedMessages = [];
    workerMessageHandler = null;
    vi.resetModules();
  });

  it('ignores stale responses from older requests and resolves latest request', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/parseInWorker');

    const first = parseRenpyFilesInWorker({ files: [{ name: 'a.rpy', content: 'label a:' }] });
    const second = parseRenpyFilesInWorker({ files: [{ name: 'b.rpy', content: 'label b:' }] });

    const firstRequestId = (postedMessages[0] as { requestId: number }).requestId;
    const secondRequestId = (postedMessages[1] as { requestId: number }).requestId;

    workerMessageHandler?.({
      data: { type: 'result', requestId: firstRequestId, nodes: [{ id: 'a' }], edges: [] },
    } as MessageEvent);
    workerMessageHandler?.({
      data: { type: 'result', requestId: secondRequestId, nodes: [{ id: 'b' }], edges: [] },
    } as MessageEvent);

    await expect(second).resolves.toEqual({ nodes: [{ id: 'b' }], edges: [] });
    await expect(Promise.race([first.then(() => 'resolved'), Promise.resolve('pending')])).resolves.toBe('pending');
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
