import { parseRenpyFiles } from './parser';
import { createGraphState } from './parser/pipelineState';
import { parseOneFile } from './parser/filePipeline';
import { finalizeRoles } from './parser/roleFinalization';
import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
  type ProgressResponseMessage,
} from './infrastructure/workerProtocol';

let activeRequestId: number | null = null;
const cancelledRequests = new Set<number>();
let accumulatedState = createGraphState();

function postMessageSafe(message: WorkerResponseMessage) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) return;

  if (message.type === 'cancel') {
    cancelledRequests.add(message.requestId);
    return;
  }

  if (message.type !== 'parse') return;

  const { requestId, files } = message;
  activeRequestId = requestId;
  const startedAt = performance.now();
  const wantsProgress = message.wantsProgress !== false;
  const appendToActiveGraph = message.appendToActiveGraph === true;
  const isFinalChunk = message.isFinalChunk !== false;
  const progressThrottleMs = files.length > 40 ? 30 : 0;
  let lastProgressAt = 0;
  let pendingProgress: ProgressResponseMessage | null = null;

  try {
    let result;
    if (appendToActiveGraph) {
      if (message.requestId !== activeRequestId) return;
      for (let idx = 0; idx < files.length; idx += 1) {
        if (cancelledRequests.has(requestId)) {
          throw new Error('Parsing cancelled');
        }
        const file = files[idx];
        await parseOneFile(accumulatedState, file, {
          captureDialogueLines: message.captureDialogueLines !== false,
        });
        if (wantsProgress) {
          const now = performance.now();
          const nextProgress: ProgressResponseMessage = {
            protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
            type: 'progress',
            requestId,
            doneFiles: idx + 1,
            totalFiles: files.length,
            currentFile: file.name,
            elapsedMs: performance.now() - startedAt,
          };
          pendingProgress = nextProgress;
          if (
            progressThrottleMs <= 0 ||
            now - lastProgressAt >= progressThrottleMs ||
            idx + 1 === files.length
          ) {
            postMessageSafe(nextProgress);
            lastProgressAt = now;
            pendingProgress = null;
          }
        }
      }
      if (isFinalChunk) {
        finalizeRoles(accumulatedState);
      }
      result = { nodes: accumulatedState.nodes, edges: accumulatedState.edges };
    } else {
      result = await parseRenpyFiles(files, {
        captureDialogueLines: message.captureDialogueLines !== false,
        onProgress: ({ doneFiles, totalFiles, currentFile }) => {
          if (cancelledRequests.has(requestId)) {
            throw new Error('Parsing cancelled');
          }
          if (!wantsProgress) return;
          const now = performance.now();
          const nextProgress: ProgressResponseMessage = {
            protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
            type: 'progress',
            requestId,
            doneFiles,
            totalFiles,
            currentFile,
            elapsedMs: performance.now() - startedAt,
          };
          pendingProgress = nextProgress;
          if (progressThrottleMs <= 0 || now - lastProgressAt >= progressThrottleMs || doneFiles === totalFiles) {
            postMessageSafe(nextProgress);
            lastProgressAt = now;
            pendingProgress = null;
          }
        },
      });
    }

    if (wantsProgress && pendingProgress) {
      postMessageSafe(pendingProgress);
      pendingProgress = null;
    }

    if (!cancelledRequests.has(requestId)) {
      postMessageSafe({
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'result',
        requestId,
        nodes: result.nodes,
        edges: result.edges,
        elapsedMs: performance.now() - startedAt,
        partial: appendToActiveGraph && !isFinalChunk,
      });
    }
  } catch (error: unknown) {
    if (!cancelledRequests.has(requestId)) {
      const messageText = error instanceof Error ? error.message : String(error);
      postMessageSafe({
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId,
        message: messageText,
        elapsedMs: performance.now() - startedAt,
      });
    }
  } finally {
    const wasCancelled = cancelledRequests.has(requestId);
    if (activeRequestId === requestId) {
      activeRequestId = null;
    }
    cancelledRequests.delete(requestId);
    if ((appendToActiveGraph && isFinalChunk) || wasCancelled) {
      accumulatedState = createGraphState();
    }
  }
};
