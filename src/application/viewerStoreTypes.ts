/**
 * src/application/viewerStoreTypes.ts
 *
 * Unified interfaces for the ViewerStore.
 * Extracted here to prevent circular imports between store slices and the main store.
 */

import type { DialogueSearchResult } from "../infrastructure/index.ts";
import type {
  ConditionVisibilityMode,
  EdgeKindFilter,
  LayoutDensity,
  LayoutDirection,
  MockFlagValue,
  ThemeName,
} from "../domain/index.ts";
import type { DebugBundlePrivacyOptions } from "./debugBundle.ts";
import type { DialogueSearchMode } from "./appStore.ts";

/**
 * State that is persisted to localStorage and restored between sessions.
 * Contains only display preferences that should survive a page refresh.
 */
export interface ViewerPersistedState {
  theme: ThemeName;
  layoutDensity: LayoutDensity;
  showCallReturns: boolean;
  showAudioAssetCues: boolean;
  showMediaCuesInDialogue: boolean;
  showPacingHeatmap: boolean;
  minimapPannable: boolean;
  minimapZoomable: boolean;
  visibleEdgeKinds: Record<EdgeKindFilter, boolean>;
  simplifyCollapseLinearChains: boolean;
  simplifyInlineUtilities: boolean;
  simplifyInlineDetours: boolean;
  simplifyInlineStateToggles: boolean;
  simplifyInlineEmptyLabels: boolean;
  simplifyInlineDialogueThreshold: number;
  debugPrivacyOptions: DebugBundlePrivacyOptions;
  /** Reading speed in words per minute for reading time calculations. */
  readingSpeedWpm: number;
}

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
  selectedSearchChapter: string;
  selectedSearchNodeKinds: Record<"LABEL" | "MENU" | "DECISION", boolean>;
  selectedCallContextId: string | null;
  loadingNodeDetailIds: Set<string>;
  hydratedNodeDetailIds: Set<string>;
}

export interface ViewerActions {
  fetchNodeDetails: (nodeIds: string[]) => Promise<void>;
  markNodesHydrated: (ids: string[]) => void;
  // Persisted setters
  setTheme: (theme: ThemeName) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setShowCallReturns: (show: boolean) => void;
  setShowAudioAssetCues: (show: boolean) => void;
  setShowMediaCuesInDialogue: (show: boolean) => void;
  setShowPacingHeatmap: (show: boolean) => void;
  setMinimapPannable: (pannable: boolean) => void;
  setMinimapZoomable: (zoomable: boolean) => void;
  setEdgeKindVisible: (kind: EdgeKindFilter, visible: boolean) => void;
  setSimplifyCollapseLinearChains: (collapse: boolean) => void;
  setSimplifyInlineUtilities: (inline: boolean) => void;
  setSimplifyInlineDetours: (inline: boolean) => void;
  setSimplifyInlineStateToggles: (inline: boolean) => void;
  setSimplifyInlineEmptyLabels: (inline: boolean) => void;
  setSimplifyInlineDialogueThreshold: (threshold: number) => void;
  setDebugPrivacyOptions: (options: DebugBundlePrivacyOptions) => void;
  updateDebugPrivacyOptions: (
    patch: Partial<DebugBundlePrivacyOptions>,
  ) => void;
  setReadingSpeedWpm: (wpm: number) => void;

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
  setSelectedSearchChapter: (chapter: string) => void;
  setSelectedSearchNodeKinds: (
    kinds: Record<"LABEL" | "MENU" | "DECISION", boolean>,
  ) => void;
  setSelectedCallContextId: (id: string | null) => void;
  clearCallContextHighlight: () => void;

  /** Resets all session state to defaults. Called on component unmount. */
  resetSession: () => void;
}

export type ViewerStore =
  & ViewerPersistedState
  & ViewerSessionState
  & ViewerActions;
