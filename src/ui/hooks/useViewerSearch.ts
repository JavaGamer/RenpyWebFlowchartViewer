import { useEffect, useMemo, useRef, useState } from "react";
import MiniSearch from "minisearch";
import type { CanvasNode } from "../../domain/index.ts";
import type { ParseService } from "../../application/index.ts";
import type { DialogueSearchResult } from "../../infrastructure/index.ts";
import {
  DIALOGUE_MINISEARCH_OPTIONS,
  type DialogueSearchDocument,
  NODE_MINISEARCH_OPTIONS,
  type NodeSearchDocument,
} from "../../config/searchConfig.ts";
import {
  DIALOGUE_SEARCH_MAX_RESULTS,
  SEARCH_DEBOUNCE_MS,
} from "../../config/viewerConfig.ts";

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
  selectedSearchChapter: string;
  selectedSearchNodeKinds: Record<"LABEL" | "MENU" | "DECISION", boolean>;
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
  selectedSearchChapter,
  selectedSearchNodeKinds,
}: UseViewerSearchParams): UseViewerSearchResult {
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(searchInput);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(handler);
    };
  }, [searchInput]);

  const effectiveSearch = largeGraphMode ? debouncedSearch : searchInput;
  const trimmedSearch = effectiveSearch.trim();
  const hasActiveQuery = trimmedSearch.length > 0;

  // ── Candidate node IDs for scoped worker search ───────────────────────────
  const dialogueSearchCandidateNodeIdsKey = useMemo(() => {
    const ids: string[] = [];
    for (const node of nodes) {
      const nodeData = node.data as
        | { chapter?: string; dialogueCount?: number }
        | undefined;
      const chapterCollapsed = nodeData?.chapter
        ? collapsedChapters[nodeData.chapter]
        : false;
      const labelCollapsed = collapsedLabelChildren.has(node.id);
      const dialogueCount = nodeData?.dialogueCount ?? 0;
      if (chapterCollapsed || labelCollapsed) continue;
      if (dialogueCount < minDialogue) continue;
      if (
        selectedSearchChapter && nodeData?.chapter !== selectedSearchChapter
      ) continue;
      ids.push(node.id);
    }
    return JSON.stringify(ids);
  }, [
    collapsedChapters,
    collapsedLabelChildren,
    minDialogue,
    nodes,
    selectedSearchChapter,
  ]);

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
    const nodeIds = JSON.parse(dialogueSearchCandidateNodeIdsKey) as string[];
    void parseService
      .searchDialogueLines({
        query,
        nodeIds,
        maxResults: 500,
        signal: controller.signal,
      })
      .then((results) => {
        if (controller.signal.aborted) return;
        setDialogueSearchResults(results);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError") ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setDialogueSearchResults([]);
      });
    return () => controller.abort();
  }, [
    dialogueLineSearchEnabled,
    dialogueSearchCandidateNodeIdsKey,
    effectiveSearch,
    largeGraphMode,
    parseService,
    setDialogueSearchResults,
  ]);

  // ── Local dialogue MiniSearch index (lazy: only built when there is an active query
  // and we are in small-graph mode; gated via hasActiveQuery to avoid rebuilding
  // on every keystroke) ─────────────────────────────────────────────────────────
  const searchableDocs = useMemo<DialogueSearchDocument[]>(() => {
    // Skip entirely in large-graph mode (worker handles search there) and when
    // dialogue-line search is disabled.
    if (!dialogueLineSearchEnabled || largeGraphMode || !hasActiveQuery) {
      return [];
    }
    const docs: DialogueSearchDocument[] = [];
    for (const node of nodes) {
      const nodeData = node.data as {
        label: string;
        chapter?: string;
        dialogueCount?: number;
        dialogueLines?: string[];
      };
      const chapterCollapsed = nodeData.chapter
        ? collapsedChapters[nodeData.chapter]
        : false;
      const labelCollapsed = collapsedLabelChildren.has(node.id);
      if (chapterCollapsed || labelCollapsed) continue;
      if ((nodeData.dialogueCount ?? 0) < minDialogue) continue;
      if (selectedSearchChapter && nodeData.chapter !== selectedSearchChapter) {
        continue;
      }
      const lines = nodeData.dialogueLines ?? [];
      lines.forEach((line, idx) => {
        docs.push({
          id: `${node.id}::${idx + 1}`,
          nodeId: node.id,
          nodeLabel: nodeData.label,
          lineIndex: idx + 1,
          lineText: line,
        });
      });
    }
    return docs;
  }, [
    collapsedChapters,
    collapsedLabelChildren,
    dialogueLineSearchEnabled,
    hasActiveQuery,
    largeGraphMode,
    minDialogue,
    nodes,
    selectedSearchChapter,
  ]);

  const localDialogueMiniSearch = useMemo(() => {
    if (searchableDocs.length === 0 || !hasActiveQuery) return null;
    const mini = new MiniSearch(DIALOGUE_MINISEARCH_OPTIONS);
    mini.addAll(searchableDocs);
    return mini;
  }, [hasActiveQuery, searchableDocs]);

  const localDialogueSearchResults = useMemo<DialogueSearchResult[]>(() => {
    if (!localDialogueMiniSearch) return [];
    return localDialogueMiniSearch.search(trimmedSearch).slice(
      0,
      DIALOGUE_SEARCH_MAX_RESULTS,
    ).map((entry) => ({
      nodeId: entry.nodeId,
      nodeLabel: entry.nodeLabel,
      lineIndex: entry.lineIndex,
      lineText: entry.lineText,
    })) as DialogueSearchResult[];
  }, [localDialogueMiniSearch, trimmedSearch]);

  const rawDialogueSearchResults = largeGraphMode
    ? dialogueSearchResults
    : localDialogueSearchResults;
  const activeDialogueSearchResults = useMemo<DialogueSearchResult[]>(() => {
    if (!selectedSearchNodeKinds.LABEL) return [];
    return rawDialogueSearchResults;
  }, [rawDialogueSearchResults, selectedSearchNodeKinds.LABEL]);

  const dialogueMatchNodeIds = useMemo(
    () => new Set(activeDialogueSearchResults.map((r) => r.nodeId)),
    [activeDialogueSearchResults],
  );

  // ── Node MiniSearch index (lazy: only built when there is an active query) ─────────
  const nodeSearchDocs = useMemo<NodeSearchDocument[]>(
    () => {
      if (!hasActiveQuery) return [];
      const docs: NodeSearchDocument[] = [];
      for (const node of nodes) {
        const nodeData = node.data as {
          label?: string;
          dialogueCount?: number;
          chapter?: string;
          nodeType: "LABEL" | "MENU" | "DECISION";
        };
        if (
          selectedSearchChapter && nodeData.chapter !== selectedSearchChapter
        ) continue;
        if (!selectedSearchNodeKinds[nodeData.nodeType]) continue;
        docs.push({
          id: node.id,
          nodeId: node.id,
          label: nodeData.label ?? "",
          dialogueCountText: String(nodeData.dialogueCount ?? 0),
        });
      }
      return docs;
    },
    [hasActiveQuery, nodes, selectedSearchChapter, selectedSearchNodeKinds],
  );

  const nodeMiniSearch = useMemo(() => {
    if (!hasActiveQuery || nodeSearchDocs.length === 0) return null;
    const mini = new MiniSearch(NODE_MINISEARCH_OPTIONS);
    mini.addAll(nodeSearchDocs);
    return mini;
  }, [hasActiveQuery, nodeSearchDocs]);

  const nodeSearchMatchIds = useMemo(() => {
    if (!nodeMiniSearch || !hasActiveQuery) return null;
    return new Set(
      nodeMiniSearch.search(trimmedSearch).map((entry) => entry.nodeId),
    );
  }, [hasActiveQuery, nodeMiniSearch, trimmedSearch]);

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
