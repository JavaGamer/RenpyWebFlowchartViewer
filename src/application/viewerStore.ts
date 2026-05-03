/**
 * src/application/viewerStore.ts
 *
 * Zustand store for FlowchartViewer UI state.
 *
 * - Persisted state (theme, showCallReturns, visibleEdgeKinds) is saved to
 *   localStorage via persist middleware.
 * - Session state (search text, collapsed subgraphs, selection, etc.) lives in
 *   the store but is reset whenever FlowchartViewer unmounts (i.e. on each new
 *   import, since App renders it with key={importRevision}).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { DialogueSearchResult } from '../infrastructure';
import type { EdgeKindFilter } from '../flowchartTransforms';
import type { ThemeName, LayoutDirection } from '../ui';
import { STORAGE_KEYS } from '../config/storageKeys';
import type { DialogueSearchMode } from './appStore';

// ─── Persisted slice ──────────────────────────────────────────────────────────

export interface ViewerPersistedState {
  theme: ThemeName;
  showCallReturns: boolean;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
}

// ─── Session slice (reset on each new import) ─────────────────────────────────

export interface ViewerSessionState {
  layoutDirection: LayoutDirection;
  searchInput: string;
  labelSubgraphSearchInput: string;
  minDialogue: number;
  collapsedChapters: Record<string, boolean>;
  collapsedParentLabels: Record<string, boolean>;
  focusNodeId: string;
  largeGraphModeOverride: boolean | null;
  selectedNodeId: string;
  selectedDialogueLineIndex: number | null;
  showAllInspectorLines: boolean;
  activeDialogueResultIndex: number;
  dialogueSearchResults: DialogueSearchResult[];
  showAdvancedControls: boolean;
  showAllLabelSubgraphToggles: boolean;
  standaloneDialogueSearchMode: DialogueSearchMode;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface ViewerActions {
  // Persisted setters
  setTheme: (theme: ThemeName) => void;
  setShowCallReturns: (show: boolean) => void;
  setEdgeKindVisible: (kind: EdgeKindFilter, visible: boolean) => void;

  // Session setters
  setLayoutDirection: (direction: LayoutDirection) => void;
  setSearchInput: (value: string) => void;
  setLabelSubgraphSearchInput: (value: string) => void;
  setMinDialogue: (value: number) => void;
  toggleChapter: (chapter: string) => void;
  toggleParentLabel: (label: string) => void;
  setAllParentLabelsCollapsed: (labels: string[], collapsed: boolean) => void;
  setFocusNodeId: (id: string) => void;
  setLargeGraphModeOverride: (value: boolean | null) => void;
  setSelectedNodeId: (id: string) => void;
  setSelectedDialogueLineIndex: (index: number | null) => void;
  toggleShowAllInspectorLines: () => void;
  setShowAllInspectorLines: (show: boolean) => void;
  setActiveDialogueResultIndex: (index: number) => void;
  setDialogueSearchResults: (results: DialogueSearchResult[]) => void;
  toggleShowAdvancedControls: () => void;
  toggleShowAllLabelSubgraphToggles: () => void;
  setStandaloneDialogueSearchMode: (mode: DialogueSearchMode) => void;

  /** Resets all session state to defaults. Called on component unmount. */
  resetSession: () => void;
}

// ─── Full store type ──────────────────────────────────────────────────────────

export type ViewerStore = ViewerPersistedState & ViewerSessionState & ViewerActions;

// ─── Default values ───────────────────────────────────────────────────────────

const defaultPersistedState: ViewerPersistedState = {
  theme: 'violet',
  showCallReturns: false,
  visibleEdgeKinds: {
    sequence: true,
    jump: true,
    call: true,
    call_return: true,
  },
};

const defaultSessionState: ViewerSessionState = {
  layoutDirection: 'TB',
  searchInput: '',
  labelSubgraphSearchInput: '',
  minDialogue: 0,
  collapsedChapters: {},
  collapsedParentLabels: {},
  focusNodeId: '',
  largeGraphModeOverride: null,
  selectedNodeId: '',
  selectedDialogueLineIndex: null,
  showAllInspectorLines: false,
  activeDialogueResultIndex: -1,
  dialogueSearchResults: [],
  showAdvancedControls: false,
  showAllLabelSubgraphToggles: false,
  standaloneDialogueSearchMode: 'auto',
};

// ─── Persist merge/validation helpers ────────────────────────────────────────

function isThemeName(v: unknown): v is ThemeName {
  return v === 'violet' || v === 'highContrast' || v === 'colorblind';
}

function mergePersistedState(persisted: unknown, current: ViewerStore): ViewerStore {
  if (!persisted || typeof persisted !== 'object') return current;
  const p = persisted as Partial<ViewerPersistedState>;

  const theme = isThemeName(p.theme) ? p.theme : defaultPersistedState.theme;
  const showCallReturns =
    typeof p.showCallReturns === 'boolean'
      ? p.showCallReturns
      : defaultPersistedState.showCallReturns;

  const persisted_kinds = p.visibleEdgeKinds;
  const visibleEdgeKinds: Record<EdgeKindFilter, boolean> = {
    sequence:
      typeof persisted_kinds?.sequence === 'boolean'
        ? persisted_kinds.sequence
        : defaultPersistedState.visibleEdgeKinds.sequence,
    jump:
      typeof persisted_kinds?.jump === 'boolean'
        ? persisted_kinds.jump
        : defaultPersistedState.visibleEdgeKinds.jump,
    call:
      typeof persisted_kinds?.call === 'boolean'
        ? persisted_kinds.call
        : defaultPersistedState.visibleEdgeKinds.call,
    call_return:
      typeof persisted_kinds?.call_return === 'boolean'
        ? persisted_kinds.call_return
        : defaultPersistedState.visibleEdgeKinds.call_return,
  };

  return { ...current, theme, showCallReturns, visibleEdgeKinds };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useViewerStore = create<ViewerStore>()(
  persist(
    immer((set) => ({
      ...defaultPersistedState,
      ...defaultSessionState,

      // ── Persisted actions ─────────────────────────────────────────────────
      setTheme: (theme) =>
        set((draft) => {
          draft.theme = theme;
        }),

      setShowCallReturns: (show) =>
        set((draft) => {
          draft.showCallReturns = show;
        }),

      setEdgeKindVisible: (kind, visible) =>
        set((draft) => {
          draft.visibleEdgeKinds[kind] = visible;
        }),

      // ── Session actions ───────────────────────────────────────────────────
      setLayoutDirection: (direction) =>
        set((draft) => {
          draft.layoutDirection = direction;
        }),

      setSearchInput: (value) =>
        set((draft) => {
          draft.searchInput = value;
        }),

      setLabelSubgraphSearchInput: (value) =>
        set((draft) => {
          draft.labelSubgraphSearchInput = value;
        }),

      setMinDialogue: (value) =>
        set((draft) => {
          draft.minDialogue = value;
        }),

      toggleChapter: (chapter) =>
        set((draft) => {
          draft.collapsedChapters[chapter] = !draft.collapsedChapters[chapter];
        }),

      toggleParentLabel: (label) =>
        set((draft) => {
          draft.collapsedParentLabels[label] = !draft.collapsedParentLabels[label];
        }),

      setAllParentLabelsCollapsed: (labels, collapsed) =>
        set((draft) => {
          for (const label of labels) {
            draft.collapsedParentLabels[label] = collapsed;
          }
        }),

      setFocusNodeId: (id) =>
        set((draft) => {
          draft.focusNodeId = id;
        }),

      setLargeGraphModeOverride: (value) =>
        set((draft) => {
          draft.largeGraphModeOverride = value;
        }),

      setSelectedNodeId: (id) =>
        set((draft) => {
          draft.selectedNodeId = id;
        }),

      setSelectedDialogueLineIndex: (index) =>
        set((draft) => {
          draft.selectedDialogueLineIndex = index;
        }),

      toggleShowAllInspectorLines: () =>
        set((draft) => {
          draft.showAllInspectorLines = !draft.showAllInspectorLines;
        }),

      setShowAllInspectorLines: (show) =>
        set((draft) => {
          draft.showAllInspectorLines = show;
        }),

      setActiveDialogueResultIndex: (index) =>
        set((draft) => {
          draft.activeDialogueResultIndex = index;
        }),

      setDialogueSearchResults: (results) =>
        set((draft) => {
          draft.dialogueSearchResults = results;
        }),

      toggleShowAdvancedControls: () =>
        set((draft) => {
          draft.showAdvancedControls = !draft.showAdvancedControls;
        }),

      toggleShowAllLabelSubgraphToggles: () =>
        set((draft) => {
          draft.showAllLabelSubgraphToggles = !draft.showAllLabelSubgraphToggles;
        }),

      setStandaloneDialogueSearchMode: (mode) =>
        set((draft) => {
          draft.standaloneDialogueSearchMode = mode;
        }),

      // ── Reset ─────────────────────────────────────────────────────────────
      resetSession: () =>
        set((draft) => {
          Object.assign(draft, defaultSessionState);
        }),
    })),
    {
      name: STORAGE_KEYS.viewer,
      storage: createJSONStorage(() => ({
        getItem: (key: string) => {
          try {
            return globalThis.localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        setItem: (key: string, value: string) => {
          try {
            globalThis.localStorage.setItem(key, value);
          } catch {
            // Ignore write failures (e.g. quota exceeded, restricted browsing mode).
          }
        },
        removeItem: (key: string) => {
          try {
            globalThis.localStorage.removeItem(key);
          } catch {
            // Ignore.
          }
        },
      })),
      merge: (persisted, current) => mergePersistedState(persisted, current),
      partialize: (state): ViewerPersistedState => ({
        theme: state.theme,
        showCallReturns: state.showCallReturns,
        visibleEdgeKinds: state.visibleEdgeKinds,
      }),
    },
  ),
);
