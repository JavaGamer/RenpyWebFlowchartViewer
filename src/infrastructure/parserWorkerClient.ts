import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerResponseMessage,
  type ParseRequestMessage,
  type CancelRequestMessage,
  type ParseWorkerClientRequest,
  type ParseWorkerClientResult,
} from './workerProtocol';

let requestCounter = 0;

let worker: Worker | null = null;

function getParserWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../parserWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function parseRenpyFilesInWorker({
  files,
  onProgress,
  signal,
}: ParseWorkerClientRequest): Promise<ParseWorkerClientResult> {
  const parserWorker = getParserWorker();
  const requestId = ++requestCounter;
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Parsing cancelled', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cb();
    };

    const onMessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;
      if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) return;
      if (message.requestId !== requestId) return;

      if (message.type === 'progress') {
        onProgress?.({
          doneFiles: message.doneFiles,
          totalFiles: message.totalFiles,
          currentFile: message.currentFile,
          elapsedMs: message.elapsedMs,
        });
        return;
      }

      settle(() => {
        parserWorker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
      });

      if (message.type === 'result') {
        resolve({ nodes: message.nodes, edges: message.edges });
        return;
      }

      reject(new Error(message.message));
    };

    const onAbort = () => {
      settle(() => {
        parserWorker.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
        const cancelMessage: CancelRequestMessage = {
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'cancel',
          requestId,
        };
        parserWorker.postMessage(cancelMessage);
        reject(new DOMException('Parsing cancelled', 'AbortError'));
      });
    };

    parserWorker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    const parseMessage: ParseRequestMessage = {
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'parse',
      requestId,
      files,
      wantsProgress: Boolean(onProgress),
    };
    parserWorker.postMessage(parseMessage);
  });
}
