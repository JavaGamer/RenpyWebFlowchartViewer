import { parseRenpyFiles } from './parser';
import { createGraphState } from './parser/pipelineState';
import { parseOneFile } from './parser/filePipeline';
import { finalizeRoles } from './parser/roleFinalization';
import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
  type ProgressResponseMessage,
  type DialogueSearchResult,
} from './infrastructure/workerProtocol';

let activeRequestId: number | null = null;
const cancelledRequests = new Set<number>();
let accumulatedState = createGraphState();
const dialogueIndex = new Map<string, Array<{ line: string; lowerLine: string; lineIndex: number }>>();

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

  if (message.type === 'search') {
    const startedAt = performance.now();
    const query = message.query.trim().toLowerCase();
    if (!query) {
      postMessageSafe({
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'search_result',
        requestId: message.requestId,
        results: [],
        elapsedMs: performance.now() - startedAt,
      });
      return;
    }
    const maxResults = Math.max(1, Math.min(message.maxResults ?? 500, 2000));
    const allowedIds = message.nodeIds ? new Set(message.nodeIds) : null;
    const results: DialogueSearchResult[] = [];
    for (const node of accumulatedState.nodes) {
      if (allowedIds && !allowedIds.has(node.id)) continue;
      const lines = dialogueIndex.get(node.id);
      if (!lines || lines.length === 0) continue;
      for (const line of lines) {
        if (line.lowerLine.includes(query)) {
          results.push({
            nodeId: node.id,
            nodeLabel: node.label,
            lineIndex: line.lineIndex,
            lineText: line.line,
          });
          if (results.length >= maxResults) break;
        }
      }
      if (results.length >= maxResults) break;
    }
    postMessageSafe({
      protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
      type: 'search_result',
      requestId: message.requestId,
      results,
      elapsedMs: performance.now() - startedAt,
    });
    return;
  }

  if (message.type !== 'parse') return;

  const { requestId, files } = message;
  activeRequestId = requestId;
  const startedAt = performance.now();
  const wantsProgress = message.wantsProgress !== false;
  const appendToActiveGraph = message.appendToActiveGraph === true;
  const resetActiveGraph = message.resetActiveGraph === true;
  const isFinalChunk = message.isFinalChunk !== false;
  const progressThrottleMs = files.length > 40 ? 30 : 0;
  let lastProgressAt = 0;
  let pendingProgress: ProgressResponseMessage | null = null;

  try {
    let result;
    if (appendToActiveGraph) {
      if (resetActiveGraph) {
        accumulatedState = createGraphState();
        dialogueIndex.clear();
      }
      if (message.requestId !== activeRequestId) return;
      for (let idx = 0; idx < files.length; idx += 1) {
        if (activeRequestId !== requestId) {
          return;
        }
        if (cancelledRequests.has(requestId)) {
          throw new Error('Parsing cancelled');
        }
        const file = files[idx];
        const prevNodeCount = accumulatedState.nodes.length;
        await parseOneFile(accumulatedState, file, {
          captureDialogueLines: message.captureDialogueLines !== false,
        });
        for (let nodeIdx = prevNodeCount; nodeIdx < accumulatedState.nodes.length; nodeIdx += 1) {
          const node = accumulatedState.nodes[nodeIdx];
          if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
          if (dialogueIndex.has(node.id)) continue;
          dialogueIndex.set(
            node.id,
            node.dialogueLines.map((line, idx) => ({
              line,
              lowerLine: line.toLowerCase(),
              lineIndex: idx + 1,
            })),
          );
        }
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
      accumulatedState = createGraphState();
      accumulatedState.nodes = result.nodes;
      accumulatedState.edges = result.edges;
      dialogueIndex.clear();
      for (const node of result.nodes) {
        if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
        dialogueIndex.set(
          node.id,
          node.dialogueLines.map((line, idx) => ({
            line,
            lowerLine: line.toLowerCase(),
            lineIndex: idx + 1,
          })),
        );
      }
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
      dialogueIndex.clear();
    }
  }
};
