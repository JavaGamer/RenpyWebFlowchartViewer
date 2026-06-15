// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewerSearch } from '../src/ui/hooks/useViewerSearch';
import { useViewerStore } from '../src/application/viewerStore';
import type { CanvasNode } from '../src/domain';
import type { ParseService } from '../src/application/parseService';

const mockParseService: ParseService = {
  parse: vi.fn(),
  searchDialogueLines: vi.fn().mockResolvedValue([]),
};

const mockNodes: CanvasNode[] = [
  {
    id: 'node_1',
    type: 'labelNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'start',
      chapter: 'intro',
      dialogueCount: 5,
      dialogueLines: ['Welcome to the story', 'This is a start'],
      nodeType: 'LABEL',
    },
  },
  {
    id: 'node_2',
    type: 'menuNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'choice_menu',
      chapter: 'intro',
      dialogueCount: 0,
      nodeType: 'MENU',
    },
  },
  {
    id: 'node_3',
    type: 'labelNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'outro',
      chapter: 'ending',
      dialogueCount: 2,
      dialogueLines: ['The end', 'Goodbye'],
      nodeType: 'LABEL',
    },
  },
];

describe('Search Scoping and Filtering', () => {
  it('updates selectedSearchChapter and selectedSearchNodeKinds state', () => {
    const store = useViewerStore.getState();
    expect(store.selectedSearchChapter).toBe('');
    expect(store.selectedSearchNodeKinds).toEqual({ LABEL: true, MENU: true, DECISION: true });

    store.setSelectedSearchChapter('ending');
    store.setSelectedSearchNodeKinds({ LABEL: true, MENU: false, DECISION: false });

    const updated = useViewerStore.getState();
    expect(updated.selectedSearchChapter).toBe('ending');
    expect(updated.selectedSearchNodeKinds).toEqual({ LABEL: true, MENU: false, DECISION: false });

    // Reset session should clear them
    updated.resetSession();
    const reset = useViewerStore.getState();
    expect(reset.selectedSearchChapter).toBe('');
    expect(reset.selectedSearchNodeKinds).toEqual({ LABEL: true, MENU: true, DECISION: true });
  });

  it('filters local node search docs by chapter scope and node kinds', () => {
    const { result } = renderHook(() =>
      useViewerSearch({
        nodes: mockNodes,
        searchInput: 'o', // Matches "intro" (chapter name/label) and "outro"
        largeGraphMode: false,
        dialogueLineSearchEnabled: true,
        collapsedChapters: {},
        collapsedLabelChildren: new Set(),
        minDialogue: 0,
        parseService: mockParseService,
        dialogueSearchResults: [],
        setDialogueSearchResults: vi.fn(),
        selectedSearchChapter: 'ending', // restricts to ending
        selectedSearchNodeKinds: { LABEL: true, MENU: true, DECISION: true },
      })
    );

    // Matches should only contain node_3 (outro), not node_1 (start) which is in intro
    expect(result.current.searchMatchNodeIds).toBeDefined();
    expect(result.current.searchMatchNodeIds?.has('node_3')).toBe(true);
    expect(result.current.searchMatchNodeIds?.has('node_1')).toBe(false);
  });

  it('filters local node search docs by node kinds', () => {
    const { result } = renderHook(() =>
      useViewerSearch({
        nodes: mockNodes,
        searchInput: 'choice', // matches choice_menu
        largeGraphMode: false,
        dialogueLineSearchEnabled: true,
        collapsedChapters: {},
        collapsedLabelChildren: new Set(),
        minDialogue: 0,
        parseService: mockParseService,
        dialogueSearchResults: [],
        setDialogueSearchResults: vi.fn(),
        selectedSearchChapter: '',
        selectedSearchNodeKinds: { LABEL: true, MENU: false, DECISION: true }, // MENU is disabled
      })
    );

    // matches should exclude node_2 (choice_menu) because MENU kind is disabled
    expect(result.current.searchMatchNodeIds?.has('node_2')).toBe(false);
  });
});
