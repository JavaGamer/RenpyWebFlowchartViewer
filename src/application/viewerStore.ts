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
import { temporal } from 'zundo';
import { z } from 'zod';
import type { DialogueSearchResult } from '../infrastructure';
import type { ConditionVisibilityMode, EdgeKindFilter, ThemeName, LayoutDirection } from '../domain';
import { STORAGE_KEYS } from '../config/storageKeys';
import type { DialogueSearchMode } from './appStore';
import type { MockFlagValue } from '../domain';

import {
  createThemeSlice,
  defaultThemeState,
  createFilterSlice,
  defaultFilterState,
  createSearchSlice,
  defaultSearchState,
  createSelectionSlice,
  defaultSelectionState,
  createSimulationSlice,
  defaultSimulationState,
  createEmptyMockFlags,
} from './viewerStoreSlices';

// ─── Persisted slice ──────────────────────────────────────────────────────────

/**
 * State that is persisted to localStorage and restored between sessions.
 * Contains only display preferences that should survive a page refresh.
 */
export interface ViewerPersistedState {
  theme: ThemeName;
  showCallReturns: boolean;
  showAudioAssetCues: boolean;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
}

// ─── Session slice (reset on each new import) ─────────────────────────────────

/**
 * Transient UI state that is reset whenever `FlowchartViewer` unmounts.
 * Because `App` renders `<FlowchartViewer key={importRevision}>`, each
 * successful import effectively resets all session state automatically.
 */
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
  mockFlags: Record<string, MockFlagValue>;
  conditionVisibilityMode: ConditionVisibilityMode;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface ViewerActions {
  // Persisted setters
  setTheme: (theme: ThemeName) => void;
  setShowCallReturns: (show: boolean) => void;
  setShowAudioAssetCues: (show: boolean) => void;
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
  setShowAdvancedControls: (show: boolean) => void;
  toggleShowAllLabelSubgraphToggles: () => void;
  setStandaloneDialogueSearchMode: (mode: DialogueSearchMode) => void;
  setMockFlag: (flag: string, value: MockFlagValue) => void;
  resetMockFlags: () => void;
  setConditionVisibilityMode: (mode: ConditionVisibilityMode) => void;

  /** Resets all session state to defaults. Called on component unmount. */
  resetSession: () => void;
}

// ─── Full store type ──────────────────────────────────────────────────────────

export type ViewerStore = ViewerPersistedState & ViewerSessionState & ViewerActions;

// ─── Default values ───────────────────────────────────────────────────────────

const defaultPersistedState: ViewerPersistedState = { ...defaultThemeState };

const defaultSessionState: ViewerSessionState = {
  ...defaultFilterState,
  ...defaultSearchState,
  ...defaultSelectionState,
  ...defaultSimulationState,
};

// ─── Persist merge/validation helpers ────────────────────────────────────────

const viewerPersistedStateSchema = z.object({
  theme: z.enum(['violet', 'highContrast', 'colorblind']).catch(defaultPersistedState.theme),
  showCallReturns: z.boolean().catch(defaultPersistedState.showCallReturns),
  showAudioAssetCues: z.boolean().catch(defaultPersistedState.showAudioAssetCues),
  visibleEdgeKinds: z
    .object({
      sequence: z.boolean().catch(defaultPersistedState.visibleEdgeKinds.sequence),
      jump: z.boolean().catch(defaultPersistedState.visibleEdgeKinds.jump),
      call: z.boolean().catch(defaultPersistedState.visibleEdgeKinds.call),
      call_return: z.boolean().catch(defaultPersistedState.visibleEdgeKinds.call_return),
    })
    .catch(defaultPersistedState.visibleEdgeKinds),
});

/**
 * Validates and merges the raw persisted object from localStorage into the
 * current store state. Unknown or malformed keys are silently replaced with
 * their schema defaults via Zod `.catch()` clauses.
 */
function mergePersistedState(persisted: unknown, current: ViewerStore): ViewerStore {
  const parsed = viewerPersistedStateSchema.parse(
    persisted && typeof persisted === 'object' ? persisted : {},
  );
  return { ...current, ...parsed };
}

// ─── Legacy key migration ─────────────────────────────────────────────────────
//
// The previous implementation stored each setting under its own key
// (rfv.theme, rfv.showCallReturns, rfv.edge.*). On the first load after the
// migration to the consolidated key (rfv.viewer) those keys are still present
// but rfv.viewer is absent. We read the legacy values, build a Zustand persist
// payload, and delete the old keys so this only runs once.

const LEGACY_KEYS = [
  STORAGE_KEYS.theme,
  STORAGE_KEYS.showCallReturns,
  STORAGE_KEYS.edgeSequence,
  STORAGE_KEYS.edgeJump,
  STORAGE_KEYS.edgeCall,
  STORAGE_KEYS.edgeCallReturn,
] as const;

/**
 * One-time migration from the pre-consolidation per-key storage format.
 *
 * Previous versions stored each preference individually (`rfv.theme`,
 * `rfv.showCallReturns`, `rfv.edge.*`). After migrating to the consolidated
 * `rfv.viewer` key, this function reads the old keys on first load, constructs a
 * Zustand-compatible serialised payload, and removes the legacy keys so the
 * migration only runs once per browser profile.
 *
 * Returns `null` if no legacy keys are found.
 */
function migrateLegacyKeys(): string | null {
  try {
    const rawTheme = globalThis.localStorage.getItem(STORAGE_KEYS.theme);
    const rawCallReturns = globalThis.localStorage.getItem(STORAGE_KEYS.showCallReturns);
    const rawSeq = globalThis.localStorage.getItem(STORAGE_KEYS.edgeSequence);
    const rawJump = globalThis.localStorage.getItem(STORAGE_KEYS.edgeJump);
    const rawCall = globalThis.localStorage.getItem(STORAGE_KEYS.edgeCall);
    const rawCallReturn = globalThis.localStorage.getItem(STORAGE_KEYS.edgeCallReturn);

    const hasLegacy = [rawTheme, rawCallReturns, rawSeq, rawJump, rawCall, rawCallReturn].some(
      (v) => v !== null,
    );
    if (!hasLegacy) return null;

    const migratedState: ViewerPersistedState = {
      theme: viewerPersistedStateSchema.shape.theme.parse(rawTheme),
      showCallReturns: rawCallReturns === 'true',
      showAudioAssetCues: true,
      visibleEdgeKinds: {
        sequence: rawSeq !== 'false',
        jump: rawJump !== 'false',
        call: rawCall !== 'false',
        call_return: rawCallReturn !== 'false',
      },
    };

    for (const key of LEGACY_KEYS) {
      globalThis.localStorage.removeItem(key);
    }

    return JSON.stringify({ state: migratedState, version: 0 });
  } catch {
    return null;
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useViewerStore = create<ViewerStore>()(
  persist(
    temporal(
      immer((set, get, api) => ({
        ...createThemeSlice(set, get, api),
        ...createFilterSlice(set, get, api),
        ...createSearchSlice(set, get, api),
        ...createSelectionSlice(set, get, api),
        ...createSimulationSlice(set, get, api),

        // ── Reset ─────────────────────────────────────────────────────────────
        resetSession: () =>
          set((draft) => {
            Object.assign(draft, defaultSessionState);
            draft.mockFlags = createEmptyMockFlags();
          }),
      })),
      {
        partialize: (state) => ({
          layoutDirection: state.layoutDirection,
          minDialogue: state.minDialogue,
          collapsedChapters: state.collapsedChapters,
          collapsedParentLabels: state.collapsedParentLabels,
          mockFlags: state.mockFlags,
          conditionVisibilityMode: state.conditionVisibilityMode,
        }),
      }
    ),
    {
      name: STORAGE_KEYS.viewer,
      storage: createJSONStorage(() => ({
        getItem: (key: string) => {
          try {
            const stored = globalThis.localStorage.getItem(key);
            if (stored !== null) return stored;
            // One-time migration from pre-consolidation per-setting keys.
            return migrateLegacyKeys();
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
        showAudioAssetCues: state.showAudioAssetCues,
        visibleEdgeKinds: state.visibleEdgeKinds,
      }),
    },
  ),
);
