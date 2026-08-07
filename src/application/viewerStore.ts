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

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage, persist } from "zustand/middleware";
import { temporal } from "zundo";
import { z } from "zod";
import { STORAGE_KEYS } from "../config/storageKeys.ts";

import {
  createEmptyMockFlags,
  createFilterSlice,
  createSearchSlice,
  createSelectionSlice,
  createSimulationSlice,
  createThemeSlice,
  defaultFilterState,
  defaultSearchState,
  defaultSelectionState,
  defaultSimulationState,
  defaultThemeState,
} from "./viewerStoreSlices/index.ts";

import type {
  ViewerActions,
  ViewerPersistedState,
  ViewerSessionState,
  ViewerStore,
} from "./viewerStoreTypes.ts";

export type {
  ViewerActions,
  ViewerPersistedState,
  ViewerSessionState,
  ViewerStore,
};

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
  theme: z.enum(["violet", "highContrast", "colorblind", "dark"]).catch(
    defaultPersistedState.theme,
  ),
  layoutDensity: z.enum(["compact", "normal", "spacious"]).catch(
    defaultPersistedState.layoutDensity,
  ),
  showCallReturns: z.boolean().catch(defaultPersistedState.showCallReturns),
  showAudioAssetCues: z.boolean().catch(
    defaultPersistedState.showAudioAssetCues,
  ),
  showMediaCuesInDialogue: z.boolean().catch(
    defaultPersistedState.showMediaCuesInDialogue,
  ),
  showPacingHeatmap: z.boolean().catch(
    defaultPersistedState.showPacingHeatmap,
  ),
  minimapPannable: z.boolean().catch(defaultPersistedState.minimapPannable),
  minimapZoomable: z.boolean().catch(defaultPersistedState.minimapZoomable),
  visibleEdgeKinds: z
    .object({
      sequence: z.boolean().catch(
        defaultPersistedState.visibleEdgeKinds.sequence,
      ),
      jump: z.boolean().catch(defaultPersistedState.visibleEdgeKinds.jump),
      call: z.boolean().catch(defaultPersistedState.visibleEdgeKinds.call),
      call_return: z.boolean().catch(
        defaultPersistedState.visibleEdgeKinds.call_return,
      ),
    })
    .catch(defaultPersistedState.visibleEdgeKinds),
  simplifyCollapseLinearChains: z.boolean().catch(
    defaultPersistedState.simplifyCollapseLinearChains,
  ),
  simplifyInlineUtilities: z.boolean().catch(
    defaultPersistedState.simplifyInlineUtilities,
  ),
  simplifyInlineDetours: z.boolean().catch(
    defaultPersistedState.simplifyInlineDetours,
  ),
  simplifyInlineStateToggles: z.boolean().catch(
    defaultPersistedState.simplifyInlineStateToggles,
  ),
  simplifyInlineEmptyLabels: z.boolean().catch(
    defaultPersistedState.simplifyInlineEmptyLabels,
  ),
  simplifyInlineDialogueThreshold: z.number().catch(
    defaultPersistedState.simplifyInlineDialogueThreshold,
  ),
  readingSpeedWpm: z
    .number()
    .min(100)
    .max(400)
    .catch(defaultPersistedState.readingSpeedWpm),
  debugPrivacyOptions: z
    .object({
      includeFileNames: z.boolean().catch(
        defaultPersistedState.debugPrivacyOptions.includeFileNames,
      ),
      includeRawScriptDetails: z.boolean().catch(
        defaultPersistedState.debugPrivacyOptions.includeRawScriptDetails,
      ),
      includeExtraDiagnostics: z.boolean().catch(
        defaultPersistedState.debugPrivacyOptions.includeExtraDiagnostics,
      ),
    })
    .catch(defaultPersistedState.debugPrivacyOptions),
});

/**
 * Validates and merges the raw persisted object from localStorage into the
 * current store state. Unknown or malformed keys are silently replaced with
 * their schema defaults via Zod `.catch()` clauses.
 */
function mergePersistedState(
  persisted: unknown,
  current: ViewerStore,
): ViewerStore {
  const parsed = viewerPersistedStateSchema.parse(
    persisted && typeof persisted === "object" ? persisted : {},
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
    const rawCallReturns = globalThis.localStorage.getItem(
      STORAGE_KEYS.showCallReturns,
    );
    const rawSeq = globalThis.localStorage.getItem(STORAGE_KEYS.edgeSequence);
    const rawJump = globalThis.localStorage.getItem(STORAGE_KEYS.edgeJump);
    const rawCall = globalThis.localStorage.getItem(STORAGE_KEYS.edgeCall);
    const rawCallReturn = globalThis.localStorage.getItem(
      STORAGE_KEYS.edgeCallReturn,
    );

    const hasLegacy = [
      rawTheme,
      rawCallReturns,
      rawSeq,
      rawJump,
      rawCall,
      rawCallReturn,
    ].some(
      (v) => v !== null,
    );
    if (!hasLegacy) return null;

    const migratedState: ViewerPersistedState = {
      theme: viewerPersistedStateSchema.shape.theme.parse(rawTheme),
      layoutDensity: "normal",
      showCallReturns: rawCallReturns === "true",
      showAudioAssetCues: true,
      showMediaCuesInDialogue: false,
      showPacingHeatmap: defaultPersistedState.showPacingHeatmap,
      minimapPannable: true,
      minimapZoomable: true,
      visibleEdgeKinds: {
        sequence: rawSeq !== "false",
        jump: rawJump !== "false",
        call: rawCall !== "false",
        call_return: rawCallReturn !== "false",
      },
      simplifyCollapseLinearChains: false,
      simplifyInlineUtilities: false,
      simplifyInlineDetours: false,
      simplifyInlineStateToggles: false,
      simplifyInlineEmptyLabels: false,
      simplifyInlineDialogueThreshold: 1,
      debugPrivacyOptions: defaultPersistedState.debugPrivacyOptions,
      readingSpeedWpm: defaultPersistedState.readingSpeedWpm,
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
            draft.loadingNodeDetailIds = new Set<string>();
            draft.hydratedNodeDetailIds = new Set<string>();
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
      },
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
        layoutDensity: state.layoutDensity,
        showCallReturns: state.showCallReturns,
        showAudioAssetCues: state.showAudioAssetCues,
        showMediaCuesInDialogue: state.showMediaCuesInDialogue,
        showPacingHeatmap: state.showPacingHeatmap,
        minimapPannable: state.minimapPannable,
        minimapZoomable: state.minimapZoomable,
        visibleEdgeKinds: state.visibleEdgeKinds,
        simplifyCollapseLinearChains: state.simplifyCollapseLinearChains,
        simplifyInlineUtilities: state.simplifyInlineUtilities,
        simplifyInlineDetours: state.simplifyInlineDetours,
        simplifyInlineStateToggles: state.simplifyInlineStateToggles,
        simplifyInlineEmptyLabels: state.simplifyInlineEmptyLabels,
        simplifyInlineDialogueThreshold: state.simplifyInlineDialogueThreshold,
        debugPrivacyOptions: state.debugPrivacyOptions,
        readingSpeedWpm: state.readingSpeedWpm,
      }),
    },
  ),
);
