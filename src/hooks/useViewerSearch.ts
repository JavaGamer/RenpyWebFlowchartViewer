import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import debounce from 'lodash.debounce';
import type { CanvasNode } from '../flowchartTransforms';
import type { ParseService } from '../application';
import type { DialogueSearchResult } from '../infrastructure';
import {
  DIALOGUE_FUSE_OPTIONS,
  NODE_FUSE_OPTIONS,
  type DialogueSearchDocument,
  type NodeSearchDocument,
} from '../config/searchConfig';
import { SEARCH_DEBOUNCE_MS, DIALOGUE_SEARCH_MAX_RESULTS } from '../config/viewerConfig';

interface UseViewerSearchParams {
  nodes: CanvasNode[];
  searchInput: string;
  largeGraphMode: boolean;
  dialogueLineSearchEnabled: boolean;
  collapsedChapters: Record<string, boolean>;
  collapsedLabelChildren: Set<string>;
  minDialogue: number;
  parseService: ParseService;
  /** Worker-backed results from the Zustand store. */
  dialogueSearchResults: DialogueSearchResult[];
  setDialogueSearchResults: (results: DialogueSearchResult[]) => void;
}

export interface UseViewerSearchResult {
  effectiveSearch: string;
  searchMatchNodeIds: Set<string> | null;
  dialogueMatchNodeIds: Set<string>;
  activeDialogueSearchResults: DialogueSearchResult[];
  /** Narrower match count used only for the node Fuse hits (label/count). */
  nodeSearchMatchIds: Set<string> | null;
}

export function useViewerSearch({
  nodes,
  searchInput,
  largeGraphMode,
  dialogueLineSearchEnabled,
  collapsedChapters,
  collapsedLabelChildren,
  minDialogue,
  parseService,
  dialogueSearchResults,
  setDialogueSearchResults,
}: UseViewerSearchParams): UseViewerSearchResult {
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), SEARCH_DEBOUNCE_MS),
    [],
  );

  useEffect(() => {
    debouncedSetSearch(searchInput);
  }, [debouncedSetSearch, searchInput]);

  useEffect(() => () => debouncedSetSearch.cancel(), [debouncedSetSearch]);

  const effectiveSearch = largeGraphMode ? debouncedSearch : searchInput;

  // ── Candidate node IDs for scoped worker search ───────────────────────────
  const dialogueSearchCandidateNodeIds = useMemo(() => {
    const ids: string[] = [];
    for (const node of nodes) {
      const nodeData = node.data as { chapter?: string; dialogueCount?: number } | undefined;
      const chapterCollapsed = nodeData?.chapter ? collapsedChapters[nodeData.chapter] : false;
      const labelCollapsed = collapsedLabelChildren.has(node.id);
      const dialogueCount = nodeData?.dialogueCount ?? 0;
      if (chapterCollapsed || labelCollapsed) continue;
      if (dialogueCount < minDialogue) continue;
      ids.push(node.id);
    }
    return ids;
  }, [collapsedChapters, collapsedLabelChildren, minDialogue, nodes]);

  // ── Worker-backed search (large graph mode) ───────────────────────────────
  useEffect(() => {
    if (!largeGraphMode) return;
    const query = effectiveSearch.trim();
    if (!dialogueLineSearchEnabled || !query) {
      searchAbortControllerRef.current?.abort();
      searchAbortControllerRef.current = null;
      setDialogueSearchResults([]);
      return;
    }
    searchAbortControllerRef.current?.abort();
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;
    void parseService
      .searchDialogueLines({
        query,
        nodeIds: dialogueSearchCandidateNodeIds,
        maxResults: 500,
        signal: controller.signal,
      })
      .then((results) => {
        if (controller.signal.aborted) return;
        setDialogueSearchResults(results);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDialogueSearchResults([]);
      });
    return () => controller.abort();
  }, [
    dialogueLineSearchEnabled,
    dialogueSearchCandidateNodeIds,
    effectiveSearch,
    largeGraphMode,
    parseService,
    setDialogueSearchResults,
  ]);

  // ── Local dialogue Fuse index (lazy: only built when there is an active query
  // and we are in small-graph mode; gated via hasActiveQuery to avoid rebuilding
  // on every keystroke) ─────────────────────────────────────────────────────────
  const searchableDocs = useMemo<DialogueSearchDocument[]>(() => {
    // Skip entirely in large-graph mode (worker handles search there) and when
    // dialogue-line search is disabled.
    if (!dialogueLineSearchEnabled || largeGraphMode) return [];
    const docs: DialogueSearchDocument[] = [];
    for (const node of nodes) {
      const nodeData = node.data as { label: string; chapter?: string; dialogueCount?: number; dialogueLines?: string[] };
      const chapterCollapsed = nodeData.chapter ? collapsedChapters[nodeData.chapter] : false;
      const labelCollapsed = collapsedLabelChildren.has(node.id);
      if (chapterCollapsed || labelCollapsed) continue;
      if ((nodeData.dialogueCount ?? 0) < minDialogue) continue;
      const lines = nodeData.dialogueLines ?? [];
      lines.forEach((line, idx) => {
        docs.push({
          nodeId: node.id,
          nodeLabel: nodeData.label,
          lineIndex: idx + 1,
          lineText: line,
        });
      });
    }
    return docs;
  }, [collapsedChapters, collapsedLabelChildren, dialogueLineSearchEnabled, largeGraphMode, minDialogue, nodes]);

  // A boolean that transitions only when the user starts/stops searching.
  // Using this (rather than the raw string) as a Fuse dep avoids rebuilding
  // the index on every keystroke while the query is non-empty.
  const hasActiveQuery = Boolean(effectiveSearch.trim());

  const localDialogueFuse = useMemo(
    () => (searchableDocs.length > 0 && hasActiveQuery ? new Fuse(searchableDocs, DIALOGUE_FUSE_OPTIONS) : null),
    [hasActiveQuery, searchableDocs],
  );

  const localDialogueSearchResults = useMemo<DialogueSearchResult[]>(() => {
    if (!localDialogueFuse) return [];
    const query = effectiveSearch.trim();
    if (!query) return [];
    return localDialogueFuse.search(query, { limit: DIALOGUE_SEARCH_MAX_RESULTS }).map((entry) => ({
      nodeId: entry.item.nodeId,
      nodeLabel: entry.item.nodeLabel,
      lineIndex: entry.item.lineIndex,
      lineText: entry.item.lineText,
    }));
  }, [effectiveSearch, localDialogueFuse]);

  const activeDialogueSearchResults = largeGraphMode ? dialogueSearchResults : localDialogueSearchResults;

  const dialogueMatchNodeIds = useMemo(
    () => new Set(activeDialogueSearchResults.map((r) => r.nodeId)),
    [activeDialogueSearchResults],
  );

  // ── Node Fuse index (lazy: only built when there is an active query) ─────────
  const nodeSearchDocs = useMemo<NodeSearchDocument[]>(
    () =>
      nodes.map((node) => {
        const nodeData = node.data as { label?: string; dialogueCount?: number };
        return {
          nodeId: node.id,
          label: nodeData.label ?? '',
          dialogueCountText: String(nodeData.dialogueCount ?? 0),
        };
      }),
    [nodes],
  );

  // Same hasActiveQuery boolean gates construction so the index is built once
  // on the first keystroke and reused until the query is cleared.
  const nodeFuse = useMemo(
    () => (hasActiveQuery ? new Fuse(nodeSearchDocs, NODE_FUSE_OPTIONS) : null),
    [hasActiveQuery, nodeSearchDocs],
  );

  const nodeSearchMatchIds = useMemo(() => {
    const query = effectiveSearch.trim();
    if (!query || !nodeFuse) return null;
    return new Set(nodeFuse.search(query).map((entry) => entry.item.nodeId));
  }, [effectiveSearch, nodeFuse]);

  const searchMatchNodeIds = useMemo(() => {
    if (!nodeSearchMatchIds) return null;
    const combined = new Set(nodeSearchMatchIds);
    dialogueMatchNodeIds.forEach((nodeId) => combined.add(nodeId));
    return combined;
  }, [dialogueMatchNodeIds, nodeSearchMatchIds]);

  return {
    effectiveSearch,
    searchMatchNodeIds,
    dialogueMatchNodeIds,
    activeDialogueSearchResults,
    nodeSearchMatchIds,
  };
}
