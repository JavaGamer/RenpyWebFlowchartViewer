import MiniSearch from "minisearch";
import {
  DIALOGUE_MINISEARCH_OPTIONS,
  type DialogueSearchDocument,
} from "../config/searchConfig.ts";
import { DIALOGUE_SEARCH_MAX_RESULTS } from "../config/viewerConfig.ts";
import type {
  DialogueSearchResult,
  FlowNode,
  ProjectTranslations,
} from "../domain/index.ts";
import type { ParseGraphState } from "./pipelineTypes.ts";

export interface DialogueSearchTargetSession {
  accumulatedState: ParseGraphState;
  dialogueSearchDocs: DialogueSearchDocument[];
  dialogueSearchMiniSearch: MiniSearch<DialogueSearchDocument> | null;
}

function resolveCanonicalNodeId(
  rawBlockId: string,
  state: ParseGraphState,
): string {
  if (state.nodeMap.has(rawBlockId)) {
    return rawBlockId;
  }
  const hashMatch = /^(.+)_[0-9a-fA-F]{8}$/.exec(rawBlockId);
  if (hashMatch) {
    const stripped = hashMatch[1]!;
    if (state.nodeMap.has(stripped)) {
      return stripped;
    }
    if (state.canonicalLabelIdByName?.has(stripped)) {
      return state.canonicalLabelIdByName.get(stripped)!;
    }
  } else if (state.canonicalLabelIdByName?.has(rawBlockId)) {
    return state.canonicalLabelIdByName.get(rawBlockId)!;
  }
  return rawBlockId;
}

function appendTranslationDocs(
  docs: DialogueSearchDocument[],
  translations: ProjectTranslations,
  state: ParseGraphState,
): void {
  for (
    const [lang, langData] of Object.entries(
      translations.translationsByLanguage,
    )
  ) {
    for (
      const [rawBlockId, lines] of Object.entries(langData.dialogueByNodeId)
    ) {
      const canonicalNodeId = resolveCanonicalNodeId(rawBlockId, state);
      const targetNode = state.nodeMap.get(canonicalNodeId);
      const nodeLabel = targetNode?.label ?? canonicalNodeId;

      for (let idx = 0; idx < lines.length; idx += 1) {
        docs.push({
          id: `${rawBlockId}::tl_${lang}::${idx + 1}`,
          nodeId: canonicalNodeId,
          nodeLabel,
          lineIndex: idx + 1,
          lineText: lines[idx]!,
        });
      }
    }
  }
}

export function buildDialogueSearchIndex(
  session: DialogueSearchTargetSession,
  nodes: FlowNode[],
  translations?: ProjectTranslations,
): void {
  const docs: DialogueSearchDocument[] = [];

  for (const node of nodes) {
    if (!node.dialogueLines || node.dialogueLines.length === 0) continue;
    for (let idx = 0; idx < node.dialogueLines.length; idx += 1) {
      docs.push({
        id: `${node.id}::${idx + 1}`,
        nodeId: node.id,
        nodeLabel: node.label,
        lineIndex: idx + 1,
        lineText: node.dialogueLines[idx]!,
      });
    }
  }

  const effectiveTranslations = translations ??
    session.accumulatedState.translations;
  if (effectiveTranslations) {
    appendTranslationDocs(
      docs,
      effectiveTranslations,
      session.accumulatedState,
    );
  }

  session.dialogueSearchDocs = docs;
  if (docs.length > 0) {
    session.dialogueSearchMiniSearch = new MiniSearch(
      DIALOGUE_MINISEARCH_OPTIONS,
    );
    session.dialogueSearchMiniSearch.addAll(docs);
  } else {
    session.dialogueSearchMiniSearch = null;
  }
}

export function searchDialogueIndex(
  session: DialogueSearchTargetSession,
  query: string,
  options: {
    nodeIds?: string[];
    maxResults?: number;
  } = {},
): DialogueSearchResult[] {
  const q = query.trim();
  if (!q || !session.dialogueSearchMiniSearch) {
    return [];
  }

  const maxResults = Math.max(
    1,
    Math.min(options.maxResults ?? 500, DIALOGUE_SEARCH_MAX_RESULTS),
  );
  const allowedIds = options.nodeIds ? new Set(options.nodeIds) : null;
  const rawResults = session.dialogueSearchMiniSearch.search(q);
  const filtered = allowedIds
    ? rawResults.filter((entry) => allowedIds.has(entry.nodeId))
    : rawResults;

  return filtered.slice(0, maxResults).map((entry) => ({
    nodeId: entry.nodeId,
    nodeLabel: entry.nodeLabel,
    lineIndex: entry.lineIndex,
    lineText: entry.lineText,
  }));
}
