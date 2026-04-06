import type { ReactNode } from 'react';

export interface DialogueSearchResult {
  nodeId: string;
  nodeLabel: string;
  lineIndex: number;
  lineText: string;
}

export function truncateForAria(text: string, maxLength = 80): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function renderHighlightedText(text: string, query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, cursor);
    if (matchIndex === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex));
    }
    const matched = text.slice(matchIndex, matchIndex + normalizedQuery.length);
    const markKey = `hl-${key}`;
    key += 1;
    nodes.push(
      <mark key={markKey} className="bg-yellow-200 text-inherit rounded px-0.5">
        {matched}
      </mark>,
    );
    cursor = matchIndex + normalizedQuery.length;
  }

  return nodes;
}
