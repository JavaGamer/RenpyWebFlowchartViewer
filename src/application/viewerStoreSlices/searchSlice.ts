/**
 * src/application/viewerStoreSlices/searchSlice.ts
 *
 * Session state for the dialogue / node search feature: search input text,
 * the computed result list, the currently-active result index, and the
 * standalone-vs-auto search mode toggle.
 */

import type { StateCreator } from 'zustand';
import type { DialogueSearchResult } from '../../infrastructure';
import type { DialogueSearchMode } from '../appStore';
import type { ViewerStore } from '../viewerStore';

// ─── State ────────────────────────────────────────────────────────────────────

export interface SearchSliceState {
  searchInput: string;
  activeDialogueResultIndex: number;
  dialogueSearchResults: DialogueSearchResult[];
  standaloneDialogueSearchMode: DialogueSearchMode;
  selectedSearchChapter: string;
  selectedSearchNodeKinds: Record<'LABEL' | 'MENU' | 'DECISION', boolean>;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface SearchSliceActions {
  setSearchInput: (value: string) => void;
  setActiveDialogueResultIndex: (index: number) => void;
  setDialogueSearchResults: (results: DialogueSearchResult[]) => void;
  setStandaloneDialogueSearchMode: (mode: DialogueSearchMode) => void;
  setSelectedSearchChapter: (chapter: string) => void;
  setSelectedSearchNodeKinds: (kinds: Record<'LABEL' | 'MENU' | 'DECISION', boolean>) => void;
}

export type SearchSlice = SearchSliceState & SearchSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultSearchState: SearchSliceState = {
  searchInput: '',
  activeDialogueResultIndex: -1,
  dialogueSearchResults: [],
  standaloneDialogueSearchMode: 'auto',
  selectedSearchChapter: '',
  selectedSearchNodeKinds: { LABEL: true, MENU: true, DECISION: true },
};

// ─── Slice creator ────────────────────────────────────────────────────────────

export const createSearchSlice: StateCreator<
  ViewerStore,
  [['zustand/immer', never]],
  [],
  SearchSlice
> = (set) => ({
  ...defaultSearchState,

  setSearchInput: (value) =>
    set((draft) => {
      draft.searchInput = value;
    }),

  setActiveDialogueResultIndex: (index) =>
    set((draft) => {
      draft.activeDialogueResultIndex = index;
    }),

  setDialogueSearchResults: (results) =>
    set((draft) => {
      draft.dialogueSearchResults = results;
    }),

  setStandaloneDialogueSearchMode: (mode) =>
    set((draft) => {
      draft.standaloneDialogueSearchMode = mode;
    }),

  setSelectedSearchChapter: (chapter) =>
    set((draft) => {
      draft.selectedSearchChapter = chapter;
    }),

  setSelectedSearchNodeKinds: (kinds) =>
    set((draft) => {
      draft.selectedSearchNodeKinds = kinds;
    }),
});
