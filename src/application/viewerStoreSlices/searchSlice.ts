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
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface SearchSliceActions {
  setSearchInput: (value: string) => void;
  setActiveDialogueResultIndex: (index: number) => void;
  setDialogueSearchResults: (results: DialogueSearchResult[]) => void;
  setStandaloneDialogueSearchMode: (mode: DialogueSearchMode) => void;
}

export type SearchSlice = SearchSliceState & SearchSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultSearchState: SearchSliceState = {
  searchInput: '',
  activeDialogueResultIndex: -1,
  dialogueSearchResults: [],
  standaloneDialogueSearchMode: 'auto',
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
});
