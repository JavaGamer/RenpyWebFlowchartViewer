import { parseRenpyFiles } from '../parser/parser';
import MiniSearch from 'minisearch';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { TokenTree } from '@renpy/ast/out/tokenizer/token-definitions';
import { createGraphState } from '../parser/pipelineState';
import type { ParseDiagnostic } from '../parser/pipelineTypes';
import pLimit from 'p-limit';
import { tokenizeOneFile, processTokenizedFile, type TokenizedFile } from '../parser/filePipeline';
import { finalizeRoles } from '../parser/roleFinalization';
import { DIALOGUE_MINISEARCH_OPTIONS, type DialogueSearchDocument } from '../config/searchConfig';
import { DIALOGUE_SEARCH_MAX_RESULTS } from '../config/viewerConfig';
import {
  PARSER_WORKER_PROTOCOL_VERSION,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
  type ProgressResponseMessage,
  type DialogueSearchResult,
} from './workerProtocol';

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
let dialogueSearchMiniSearch: MiniSearch<DialogueSearchDocument> | null = null;

function buildDialogueSearchIndex(nodes: { id: string; label: string; dialogueLines?: string[] }[]) {
  dialogueSearchDocs = [];
  for (const node of nodes) {
    if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
    for (let idx = 0; idx < node.dialogueLines.length; idx += 1) {
      dialogueSearchDocs.push({
        id: `${node.id}::${idx + 1}`,
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }
  if (dialogueSearchDocs.length > 0) {
    dialogueSearchMiniSearch = new MiniSearch(DIALOGUE_MINISEARCH_OPTIONS);
    dialogueSearchMiniSearch.addAll(dialogueSearchDocs);
  } else {
    dialogueSearchMiniSearch = null;
  }
}

function postMessageSafe(message: WorkerResponseMessage) {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (message.protocolVersion !== PARSER_WORKER_PROTOCOL_VERSION) {
    const raw = event.data as { requestId?: unknown; protocolVersion?: unknown };
    if (typeof raw.requestId === 'number') {
      self.postMessage({
        protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
        type: 'error',
        requestId: raw.requestId,
        message:
          `Worker protocol version mismatch: expected ${PARSER_WORKER_PROTOCOL_VERSION}, received ${String(raw.protocolVersion)}. ` +
          'Please reload the page to use the latest worker version.',
      });
    }
    return;
  }

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
    const maxResults = Math.max(1, Math.min(message.maxResults ?? 500, DIALOGUE_SEARCH_MAX_RESULTS));
    const allowedIds = message.nodeIds ? new Set(message.nodeIds) : null;
    let results: DialogueSearchResult[] = [];
    if (dialogueSearchMiniSearch) {
      const rawResults = dialogueSearchMiniSearch.search(query);
      const filtered = allowedIds
        ? rawResults.filter((entry) => allowedIds.has(entry.nodeId))
        : rawResults;
      results = filtered.slice(0, maxResults).map((entry) => ({
        nodeId: entry.nodeId,
        nodeLabel: entry.nodeLabel,
        lineIndex: entry.lineIndex,
        lineText: entry.lineText,
      })) as DialogueSearchResult[];
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

  if (message.type === 'parse_chunk') {
    const { requestId, files, fileCacheKeys } = message;
    const startedAt = performance.now();
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      return;
    }
    try {
      const chunkState = createGraphState();
      for (let idx = 0; idx < files.length; idx += 1) {
        if (cancelledRequests.has(requestId)) {
          throw new Error('Chunk parsing cancelled');
        }
        const tokenized = await tokenizeOneFile(
          files[idx],
          { tokenizedCache, fileCacheKeys },
          idx,
        );
        processTokenizedFile(chunkState, tokenized, {
          captureDialogueLines: message.captureDialogueLines !== false,
          parserVariant: message.parserVariant,
          screenActionRules: message.screenActionRules,
        });
      }
      if (!cancelledRequests.has(requestId)) {
        postMessageSafe({
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'chunk_result' as const,
          requestId,
          nodes: chunkState.nodes,
          edges: chunkState.edges,
          diagnostics: chunkState.diagnostics.length > 0 ? chunkState.diagnostics : undefined,
          pendingCallReturns: chunkState.pendingCallReturns,
          hasReliableReturnInLabel: Array.from(chunkState.hasReliableReturnInLabel),
          globalScreens: Array.from(chunkState.globalScreens),
          labelDefinitionCount: Array.from(chunkState.labelDefinitionCountByName.entries()),
          canonicalLabelIds: Array.from(chunkState.canonicalLabelIdByName.entries()),
          elapsedMs: performance.now() - startedAt,
        } as WorkerResponseMessage);
      }
    } catch (error: unknown) {
      if (!cancelledRequests.has(requestId)) {
        postMessageSafe({
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'error',
          requestId,
          message: error instanceof Error ? error.message : String(error),
          elapsedMs: performance.now() - startedAt,
        });
      }
    } finally {
      cancelledRequests.delete(requestId);
    }
    return;
  }

  if (message.type === 'finalize') {
    const {
      requestId,
      nodes,
      edges,
      diagnostics,
      pendingCallReturns,
      hasReliableReturnInLabel,
      globalScreens,
      labelDefinitionCount,
      canonicalLabelIds,
      appendToActiveGraph,
      resetActiveGraph,
      isFinalChunk,
    } = message;
    const startedAt = performance.now();
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      return;
    }
    try {
      if (appendToActiveGraph) {
        if (resetActiveGraph) {
          accumulatedState = createGraphState();
          dialogueSearchDocs = [];
          dialogueSearchMiniSearch = null;
        }

        // Merge chunk data into accumulatedState
        accumulatedState.nodes.push(...nodes);
        accumulatedState.edges.push(...edges);
        if (diagnostics) {
          accumulatedState.diagnostics.push(...(diagnostics as ParseDiagnostic[]));
        }
        accumulatedState.pendingCallReturns.push(...pendingCallReturns);
        for (const label of hasReliableReturnInLabel) {
          accumulatedState.hasReliableReturnInLabel.add(label);
        }
        for (const screen of globalScreens) {
          accumulatedState.globalScreens.add(screen);
        }
        for (const [name, count] of labelDefinitionCount) {
          accumulatedState.labelDefinitionCountByName.set(
            name,
            (accumulatedState.labelDefinitionCountByName.get(name) ?? 0) + count,
          );
        }
        for (const [name, id] of canonicalLabelIds) {
          accumulatedState.canonicalLabelIdByName.set(name, id);
        }

        if (isFinalChunk) {
          finalizeRoles(accumulatedState);
          buildDialogueSearchIndex(accumulatedState.nodes);
        }

        if (!cancelledRequests.has(requestId)) {
          postMessageSafe({
            protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
            type: 'finalize_result',
            requestId,
            nodes: accumulatedState.nodes,
            edges: accumulatedState.edges,
            diagnostics: accumulatedState.diagnostics.length > 0 ? accumulatedState.diagnostics : undefined,
            elapsedMs: performance.now() - startedAt,
            partial: !isFinalChunk,
          } as WorkerResponseMessage);
        }
      } else {
        // Stateless finalize
        const state = createGraphState();
        state.nodes = nodes;
        state.edges = edges;
        state.diagnostics = diagnostics ? (diagnostics as ParseDiagnostic[]) : [];
        state.pendingCallReturns = pendingCallReturns;
        state.hasReliableReturnInLabel = new Set(hasReliableReturnInLabel);
        state.globalScreens = new Set(globalScreens);
        state.labelDefinitionCountByName = new Map(labelDefinitionCount);
        state.canonicalLabelIdByName = new Map(canonicalLabelIds);

        finalizeRoles(state);
        buildDialogueSearchIndex(state.nodes);

        if (!cancelledRequests.has(requestId)) {
          postMessageSafe({
            protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
            type: 'finalize_result',
            requestId,
            nodes: state.nodes,
            edges: state.edges,
            diagnostics: state.diagnostics.length > 0 ? state.diagnostics : undefined,
            elapsedMs: performance.now() - startedAt,
          } as WorkerResponseMessage);
        }
      }
    } catch (error: unknown) {
      if (!cancelledRequests.has(requestId)) {
        postMessageSafe({
          protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
          type: 'error',
          requestId,
          message: error instanceof Error ? error.message : String(error),
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
      if (wasCancelled) {
        dialogueSearchDocs = [];
        dialogueSearchMiniSearch = null;
      }
    }
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
        dialogueSearchMiniSearch = null;
      }

      const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 1;
      const defaultMaxParallel = Math.max(1, Math.min(4, hardwareConcurrency));
      const effectiveMaxParallel = maxParallelFiles ?? defaultMaxParallel;

      let tokenizedFiles: Array<TokenizedFile | undefined> = [];
      if (files.length > 1 && effectiveMaxParallel > 1) {
        const limit = pLimit(effectiveMaxParallel);
        tokenizedFiles = await Promise.all(
          files.map((file, idx) =>
            limit(async () => {
              if (activeRequestId !== requestId || cancelledRequests.has(requestId)) {
                return undefined;
              }
              return tokenizeOneFile(
                file,
                {
                  tokenizedCache,
                  fileCacheKeys,
                },
                idx,
              );
            }),
          ),
        );
      }

      for (let idx = 0; idx < files.length; idx += 1) {
        if (activeRequestId !== requestId) {
          return;
        }
        if (cancelledRequests.has(requestId)) {
          throw new Error('Parsing cancelled');
        }
        const file = files[idx];
        let tokenized = tokenizedFiles[idx];
        if (!tokenized) {
          tokenized = await tokenizeOneFile(
            file,
            {
              tokenizedCache,
              fileCacheKeys,
            },
            idx,
          );
        }
        processTokenizedFile(accumulatedState, tokenized, {
          captureDialogueLines: message.captureDialogueLines !== false,
          parserVariant: message.parserVariant,
          screenActionRules: message.screenActionRules,
        });
        if (wantsProgress) {
          const now = performance.now();
          const nextProgress: ProgressResponseMessage = {
            protocolVersion: PARSER_WORKER_PROTOCOL_VERSION,
            type: 'progress',
            requestId,
            doneFiles: idx + 1,
            totalFiles: files.length,
            currentFile: file.relativePath ?? file.name,
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
        diagnostics: accumulatedState.diagnostics.length > 0 ? accumulatedState.diagnostics : undefined,
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
        diagnostics: result.diagnostics,
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
    if (wasCancelled) {
      dialogueSearchDocs = [];
      dialogueSearchMiniSearch = null;
    }
  }
};
