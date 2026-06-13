import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PARSER_WORKER_PROTOCOL_VERSION, type ParseChunkRequestMessage, type FinalizeRequestMessage } from '../src/infrastructure/workerProtocol';

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

async function waitForPostedMessages(count: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (postedMessages.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected at least ${count} posted messages, got ${postedMessages.length}`);
}

describe('parseRenpyFilesInWorker', () => {
  beforeEach(() => {
    postedMessages = [];
    workerMessageHandlers = new Set();
    vi.resetModules();
  });

  it('supports concurrent requests and resolves each by requestId', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/infrastructure');

    const first = parseRenpyFilesInWorker({ files: [{ name: 'a.rpy', content: 'label a:' }] });
    const second = parseRenpyFilesInWorker({ files: [{ name: 'b.rpy', content: 'label b:' }] });

    await waitForPostedMessages(2);
    const requestIdByFile = new Map(
      postedMessages.map((message) => [
        (message as { files?: Array<{ name: string }> }).files?.[0]?.name,
        (message as { requestId: number }).requestId,
      ]),
    );
    const firstRequestId = requestIdByFile.get('a.rpy');
    const secondRequestId = requestIdByFile.get('b.rpy');
    expect(firstRequestId).toBeTypeOf('number');
    expect(secondRequestId).toBeTypeOf('number');
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
      requestId: secondRequestId!,
      nodes: [{ id: 'b' }],
      edges: [],
    });
    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId: firstRequestId!,
      nodes: [{ id: 'a' }],
      edges: [],
    });

    await expect(second).resolves.toEqual({ nodes: [{ id: 'b' }], edges: [] });
    await expect(first).resolves.toEqual({ nodes: [{ id: 'a' }], edges: [] });
  });

  it('accepts partial result messages and resolves request for chunk responses', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/infrastructure');    const onPartialResult = vi.fn();
    const request = parseRenpyFilesInWorker({
      files: [{ name: 'a.rpy', content: 'label a:' }],
      onPartialResult,
    });
    await waitForPostedMessages(1);    const requestId = (postedMessages[0] as { requestId: number }).requestId;

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId,
      partial: true,
      nodes: [{ id: 'partial' }],
      edges: [],
    });
    expect(onPartialResult).toHaveBeenCalledWith({ nodes: [{ id: 'partial' }], edges: [] });
    await expect(request).resolves.toEqual({ nodes: [{ id: 'partial' }], edges: [] });
    expect(workerMessageHandlers.size).toBe(0);
  });

  it('propagates diagnostics from worker result messages to partial callback and resolve value', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/infrastructure');
    const onPartialResult = vi.fn();
    const request = parseRenpyFilesInWorker({
      files: [{ name: 'warned.rpy', content: 'label warned:' }],
      onPartialResult,
    });
    await waitForPostedMessages(1);
    const requestId = (postedMessages[0] as { requestId: number }).requestId;
    const diagnostics = [{
      code: 'dynamic_target',
      severity: 'warning',
      location: {
        chapter: 'warned',
        construct: 'renpy.call',
        targetExpression: 'dynamic_target',
      },
      message: 'Dynamic target',
    }];

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'result',
      requestId,
      partial: true,
      nodes: [{ id: 'warned' }],
      edges: [],
      diagnostics,
    });

    expect(onPartialResult).toHaveBeenCalledWith({
      nodes: [{ id: 'warned' }],
      edges: [],
      diagnostics,
    });
    await expect(request).resolves.toEqual({
      nodes: [{ id: 'warned' }],
      edges: [],
      diagnostics,
    });
  });

  it('ignores stale responses with a different requestId for the active request', async () => {
    const { parseRenpyFilesInWorker } = await import('../src/infrastructure');

    const request = parseRenpyFilesInWorker({ files: [{ name: 'a.rpy', content: 'label a:' }] });
    await waitForPostedMessages(1);
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
    const { parseRenpyFilesInWorker } = await import('../src/infrastructure');
    const controller = new AbortController();
    const promise = parseRenpyFilesInWorker({
      files: [{ name: 'a.rpy', content: 'label a:' }],
      signal: controller.signal,
      onProgress: () => {},
    });
    await waitForPostedMessages(1);
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
    const { searchDialogueLinesInWorker } = await import('../src/infrastructure');    const request = searchDialogueLinesInWorker({
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

  it('rejects worker-side dialogue search on error response', async () => {
    const { searchDialogueLinesInWorker } = await import('../src/infrastructure');    const request = searchDialogueLinesInWorker({ query: 'needle' });
    const requestId = (postedMessages[0] as { requestId: number }).requestId;

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId,
      message: 'search failed',
    });

    await expect(request).rejects.toThrow('search failed');
  });

  it('posts cancel message and rejects with AbortError when dialogue search signal aborts', async () => {
    const { searchDialogueLinesInWorker } = await import('../src/infrastructure');
    const controller = new AbortController();
    const promise = searchDialogueLinesInWorker({
      query: 'needle',
      signal: controller.signal,
    });
    expect((postedMessages[0] as { type?: string }).type).toBe('search');
    controller.abort();

    const cancelMessage = postedMessages.find(
      (m) => (m as { type?: string }).type === 'cancel',
    ) as { type: string; protocolVersion?: number } | undefined;
    expect(cancelMessage?.type).toBe('cancel');
    expect(cancelMessage?.protocolVersion).toBe(PARSER_WORKER_PROTOCOL_VERSION);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('runs parallel chunk parsing and finalizes when files count > 1 and multiple workers available', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    const { parseRenpyFilesInWorker } = await import('../src/infrastructure');

    const promise = parseRenpyFilesInWorker({
      files: [
        { name: 'a.rpy', content: 'label a:' },
        { name: 'b.rpy', content: 'label b:' },
      ],
      maxParallelFiles: 4,
    });

    await waitForPostedMessages(2);
    const parseChunks = postedMessages.filter((m): m is ParseChunkRequestMessage => (m as { type: string }).type === 'parse_chunk');
    expect(parseChunks.length).toBe(2);
    expect(parseChunks[0]!.files[0]!.name).toBe('a.rpy');
    expect(parseChunks[1]!.files[0]!.name).toBe('b.rpy');

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'chunk_result',
      requestId: parseChunks[0].requestId,
      nodes: [{ id: 'a' }],
      edges: [],
      pendingCallReturns: [],
      hasReliableReturnInLabel: [],
      globalScreens: [],
      labelDefinitionCount: [],
      canonicalLabelIds: [],
    });

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'chunk_result',
      requestId: parseChunks[1].requestId,
      nodes: [{ id: 'b' }],
      edges: [],
      pendingCallReturns: [],
      hasReliableReturnInLabel: [],
      globalScreens: [],
      labelDefinitionCount: [],
      canonicalLabelIds: [],
    });

    await waitForPostedMessages(3);
    const finalizeMsg = postedMessages.find((m): m is FinalizeRequestMessage => (m as { type: string }).type === 'finalize');
    expect(finalizeMsg).toBeDefined();
    expect(finalizeMsg!.nodes).toEqual([{ id: 'a' }, { id: 'b' }]);

    emitWorkerMessage({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'finalize_result',
      requestId: finalizeMsg!.requestId,
      nodes: [{ id: 'a', role: 'story' }, { id: 'b', role: 'story' }],
      edges: [],
    });

    await expect(promise).resolves.toEqual({
      nodes: [{ id: 'a', role: 'story' }, { id: 'b', role: 'story' }],
      edges: [],
      diagnostics: undefined,
    });

    vi.unstubAllGlobals();
  });
});
