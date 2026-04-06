import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PARSER_WORKER_PROTOCOL_VERSION } from '../src/infrastructure/workerProtocol';

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

const emitWorkerMessage = (data: unknown) => {
  const handlers = Array.from(workerMessageHandlers);
  for (const handler of handlers) {
    handler({ data } as MessageEvent);
  }
};

describe('parseRenpyFilesInWorker', () => {
  beforeEach(() => {
    postedMessages = [];
    workerMessageHandlers = new Set();
    vi.resetModules();
  });

  it('supports concurrent requests and resolves each by requestId', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/parseInWorker');

    const first = parseRenpyFilesInWorker({ files: [{ name: 'a.rpy', content: 'label a:' }] });
    const second = parseRenpyFilesInWorker({ files: [{ name: 'b.rpy', content: 'label b:' }] });

    const firstRequestId = (postedMessages[0] as { requestId: number }).requestId;
    const secondRequestId = (postedMessages[1] as { requestId: number }).requestId;
    expect((postedMessages[0] as { wantsProgress?: boolean }).wantsProgress).toBe(false);
    expect((postedMessages[1] as { wantsProgress?: boolean }).wantsProgress).toBe(false);
    expect((postedMessages[0] as { protocolVersion?: number }).protocolVersion).toBe(
      PARSER_WORKER_PROTOCOL_VERSION,
    );
    expect((postedMessages[1] as { protocolVersion?: number }).protocolVersion).toBe(
      PARSER_WORKER_PROTOCOL_VERSION,
    );

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: secondRequestId,
      nodes: [{ id: 'b' }],
      edges: [],
    });
    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: firstRequestId,
      nodes: [{ id: 'a' }],
      edges: [],
    });

    await expect(second).resolves.toEqual({ nodes: [{ id: 'b' }], edges: [] });
    await expect(first).resolves.toEqual({ nodes: [{ id: 'a' }], edges: [] });
  });

  it('accepts partial result messages and resolves only on final result', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/parseInWorker');
    const onPartialResult = vi.fn();
    const request = parseRenpyFilesInWorker({
      files: [{ name: 'a.rpy', content: 'label a:' }],
      onPartialResult,
    });
    const requestId = (postedMessages[0] as { requestId: number }).requestId;

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId,
      partial: true,
      nodes: [{ id: 'partial' }],
      edges: [],
    });
    expect(onPartialResult).toHaveBeenCalledWith({ nodes: [{ id: 'partial' }], edges: [] });

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId,
      nodes: [{ id: 'final' }],
      edges: [],
    });
    await expect(request).resolves.toEqual({ nodes: [{ id: 'final' }], edges: [] });
  });

  it('ignores stale responses with a different requestId for the active request', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/parseInWorker');

    const request = parseRenpyFilesInWorker({ files: [{ name: 'a.rpy', content: 'label a:' }] });
    const requestId = (postedMessages[0] as { requestId: number }).requestId;

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: requestId + 1000,
      nodes: [{ id: 'stale' }],
      edges: [],
    });
    await expect(
      Promise.race([request.then(() => 'resolved'), Promise.resolve('pending')]),
    ).resolves.toBe('pending');

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId,
      nodes: [{ id: 'a' }],
      edges: [],
    });
    await expect(request).resolves.toEqual({ nodes: [{ id: 'a' }], edges: [] });
  });

  it('posts cancel message and rejects with AbortError when signal aborts', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/parseInWorker');
    const controller = new AbortController();
    const promise = parseRenpyFilesInWorker({
      files: [{ name: 'a.rpy', content: 'label a:' }],
      signal: controller.signal,
      onProgress: () => {},
    });
    expect((postedMessages[0] as { wantsProgress?: boolean }).wantsProgress).toBe(true);
    controller.abort();

    const cancelMessage = postedMessages.find(
      (m) => (m as { type?: string }).type === 'cancel',
    ) as { type: string; protocolVersion?: number } | undefined;
    expect(cancelMessage?.type).toBe('cancel');
    expect(cancelMessage?.protocolVersion).toBe(PARSER_WORKER_PROTOCOL_VERSION);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('supports worker-side dialogue search requests', async () => {
    const { searchDialogueLinesInWorker } = await import('../src/parseInWorker');
    const request = searchDialogueLinesInWorker({
      query: 'needle',
      nodeIds: ['start'],
      maxResults: 5,
    });

    const searchMessage = postedMessages[0] as {
      type: string;
      requestId: number;
      query?: string;
      nodeIds?: string[];
      maxResults?: number;
    };
    expect(searchMessage.type).toBe('search');
    expect(searchMessage.query).toBe('needle');
    expect(searchMessage.nodeIds).toEqual(['start']);
    expect(searchMessage.maxResults).toBe(5);

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'search_result',
      requestId: searchMessage.requestId,
      results: [
        {
          nodeId: 'start',
          nodeLabel: 'start',
          lineIndex: 1,
          lineText: 'needle line',
        },
      ],
    });

    await expect(request).resolves.toEqual([
      {
        nodeId: 'start',
        nodeLabel: 'start',
        lineIndex: 1,
        lineText: 'needle line',
      },
    ]);
  });
});
