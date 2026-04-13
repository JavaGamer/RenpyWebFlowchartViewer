import { parseRenpyFiles } from './parser';
import Fuse from 'fuse.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree } from '@renpy/ast/out/tokenizer/token-definitions';
import { createGraphState } from './parser/pipelineState';
import { parseOneFile } from './parser/filePipeline';
import { finalizeRoles } from './parser/roleFinalization';
import { DIALOGUE_FUSE_OPTIONS, type DialogueSearchDocument } from './config/searchConfig';
import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
  type ProgressResponseMessage,
  type DialogueSearchResult,
} from './infrastructure/workerProtocol';

type TokenizedCacheEntry = { document: TextDocument; tokenTree: TokenTree };

class BoundedTokenizedCache extends Map<string, TokenizedCacheEntry> {
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    super();
    this.maxEntries = maxEntries;
  }

  override get(key: string): TokenizedCacheEntry | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  override set(key: string, value: TokenizedCacheEntry): this {
    if (super.has(key)) {
      super.delete(key);
    }
    super.set(key, value);
    while (this.size > this.maxEntries) {
      const oldestKey = this.keys().next().value;
      if (oldestKey === undefined) break;
      super.delete(oldestKey);
    }
    return this;
  }
}

const MAX_TOKENIZED_CACHE_ENTRIES = 200;

let activeRequestId: number | null = null;
const cancelledRequests = new Set<number>();
const tokenizedCache = new BoundedTokenizedCache(MAX_TOKENIZED_CACHE_ENTRIES);
let accumulatedState = createGraphState();
let dialogueSearchDocs: DialogueSearchDocument[] = [];
let dialogueSearchFuse: Fuse<DialogueSearchDocument> | null = null;

function buildDialogueSearchIndex(nodes: { id: string; label: string; dialogueLines?: string[] }[]) {
  dialogueSearchDocs = [];
  for (const node of nodes) {
    if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
    for (let idx = 0; idx < node.dialogueLines.length; idx += 1) {
      dialogueSearchDocs.push({
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }
  dialogueSearchFuse = dialogueSearchDocs.length > 0 ? new Fuse(dialogueSearchDocs, DIALOGUE_FUSE_OPTIONS) : null;
}

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
    const requestId = message.requestId;
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      return;
    }
    const query = message.query.trim();
    if (!query) {
      if (!cancelledRequests.has(requestId)) {
        postMessageSafe({
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'search_result',
          requestId,
          results: [],
          elapsedMs: performance.now() - startedAt,
        });
      }
      cancelledRequests.delete(requestId);
      return;
    }
    const maxResults = Math.max(1, Math.min(message.maxResults ?? 500, 2000));
    const allowedIds = message.nodeIds ? new Set(message.nodeIds) : null;
    let results: DialogueSearchResult[] = [];
    if (allowedIds) {
      const scopedDocs = dialogueSearchDocs.filter((doc) => allowedIds.has(doc.nodeId));
      if (scopedDocs.length > 0) {
        const scopedFuse = new Fuse(scopedDocs, DIALOGUE_FUSE_OPTIONS);
        results = scopedFuse.search(query, { limit: maxResults }).map((entry) => ({
          nodeId: entry.item.nodeId,
          nodeLabel: entry.item.nodeLabel,
          lineIndex: entry.item.lineIndex,
          lineText: entry.item.lineText,
        }));
      }
    } else if (dialogueSearchFuse) {
      results = dialogueSearchFuse.search(query, { limit: maxResults }).map((entry) => ({
        nodeId: entry.item.nodeId,
        nodeLabel: entry.item.nodeLabel,
        lineIndex: entry.item.lineIndex,
        lineText: entry.item.lineText,
      }));
    }
    if (!cancelledRequests.has(requestId)) {
      postMessageSafe({
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'search_result',
        requestId,
        results,
        elapsedMs: performance.now() - startedAt,
      });
    }
    cancelledRequests.delete(requestId);
    return;
  }

  if (message.type !== 'parse') return;

  const { requestId, files, maxParallelFiles, fileCacheKeys } = message;
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
          dialogueSearchDocs = [];
          dialogueSearchFuse = null;
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
          await parseOneFile(
            accumulatedState,
            file,
          {
            captureDialogueLines: message.captureDialogueLines !== false,
            tokenizedCache,
            fileCacheKeys,
            parserVariant: message.parserVariant,
            screenActionRules: message.screenActionRules,
          },
            idx,
          );
          buildDialogueSearchIndex(accumulatedState.nodes);
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
        buildDialogueSearchIndex(accumulatedState.nodes);
      }
      result = {
        nodes: accumulatedState.nodes,
        edges: accumulatedState.edges,
        warnings: accumulatedState.warnings.length > 0 ? accumulatedState.warnings : undefined,
      };
    } else {
      result = await parseRenpyFiles(files, {
        maxParallelFiles,
        tokenizedCache,
        fileCacheKeys,
        captureDialogueLines: message.captureDialogueLines !== false,
        parserVariant: message.parserVariant,
        screenActionRules: message.screenActionRules,
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
      buildDialogueSearchIndex(result.nodes);
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
        warnings: result.warnings,
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
      dialogueSearchDocs = [];
      dialogueSearchFuse = null;
    }
  }
};
