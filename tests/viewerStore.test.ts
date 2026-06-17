// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useViewerStore } from "../src/application/viewerStore";
import { STORAGE_KEYS } from "../src/config/storageKeys";

// Tests rely on the store's initial state rather than re-importing private symbols.
const DEFAULTS = {
  theme: "violet" as const,
  layoutDensity: "normal" as const,
  showCallReturns: false,
  minimapPannable: true,
  minimapZoomable: true,
  visibleEdgeKinds: {
    sequence: true,
    jump: true,
    call: true,
    call_return: true,
  },
};

const DEFAULT_SESSION = {
  layoutDirection: "TB" as const,
  searchInput: "",
  labelSubgraphSearchInput: "",
  minDialogue: 0,
  collapsedChapters: {},
  collapsedParentLabels: {},
  focusNodeId: "",
  largeGraphModeOverride: null,
  selectedNodeId: "",
  selectedDialogueLineIndex: null,
  showAllInspectorLines: false,
  activeDialogueResultIndex: -1,
  dialogueSearchResults: [],
  showAdvancedControls: false,
  showAllLabelSubgraphToggles: false,
  standaloneDialogueSearchMode: "auto" as const,
  mockFlags: Object.create(null) as Record<
    string,
    "true" | "false" | "unknown"
  >,
  conditionVisibilityMode: "fade" as const,
};

describe("useViewerStore persistence", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    // Reset the store to its initial default state between tests.
    useViewerStore.setState({
      ...DEFAULTS,
      ...DEFAULT_SESSION,
    });
  });

  // ── Defaults ────────────────────────────────────────────────────────────────

  it("returns defaults when storage is empty", () => {
    const s = useViewerStore.getState();
    expect(s.theme).toBe(DEFAULTS.theme);
    expect(s.showCallReturns).toBe(DEFAULTS.showCallReturns);
    expect(s.minimapPannable).toBe(DEFAULTS.minimapPannable);
    expect(s.minimapZoomable).toBe(DEFAULTS.minimapZoomable);
    expect(s.visibleEdgeKinds).toEqual(DEFAULTS.visibleEdgeKinds);
  });

  // ── Persistence ─────────────────────────────────────────────────────────────

  it("writes state under STORAGE_KEYS.viewer when theme changes", () => {
    useViewerStore.getState().setTheme("highContrast");
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.viewer);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as { state?: { theme?: string } };
    expect(parsed.state?.theme).toBe("highContrast");
  });

  it("writes showCallReturns and visibleEdgeKinds under STORAGE_KEYS.viewer", () => {
    useViewerStore.getState().setShowCallReturns(true);
    useViewerStore.getState().setEdgeKindVisible("jump", false);
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.viewer);
    const parsed = JSON.parse(raw as string) as {
      state?: {
        showCallReturns?: boolean;
        visibleEdgeKinds?: Record<string, boolean>;
      };
    };
    expect(parsed.state?.showCallReturns).toBe(true);
    expect(parsed.state?.visibleEdgeKinds?.jump).toBe(false);
  });

  it("writes minimapPannable and minimapZoomable under STORAGE_KEYS.viewer", () => {
    useViewerStore.getState().setMinimapPannable(false);
    useViewerStore.getState().setMinimapZoomable(false);
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.viewer);
    const parsed = JSON.parse(raw as string) as {
      state?: {
        minimapPannable?: boolean;
        minimapZoomable?: boolean;
      };
    };
    expect(parsed.state?.minimapPannable).toBe(false);
    expect(parsed.state?.minimapZoomable).toBe(false);
  });

  // ── Rehydration / normalisation ──────────────────────────────────────────────

  it("falls back to default theme when an invalid theme is rehydrated", async () => {
    const raw = JSON.stringify({
      state: {
        theme: "not-a-real-theme",
        showCallReturns: false,
        visibleEdgeKinds: DEFAULTS.visibleEdgeKinds,
      },
      version: 0,
    });
    globalThis.localStorage.setItem(STORAGE_KEYS.viewer, raw);
    await useViewerStore.persist.rehydrate();
    expect(useViewerStore.getState().theme).toBe(DEFAULTS.theme);
  });

  it("falls back to default for invalid visibleEdgeKinds entries", async () => {
    const raw = JSON.stringify({
      state: {
        theme: "violet",
        showCallReturns: true,
        visibleEdgeKinds: {
          sequence: "yes",
          jump: null,
          call: false,
          call_return: true,
        },
      },
      version: 0,
    });
    globalThis.localStorage.setItem(STORAGE_KEYS.viewer, raw);
    await useViewerStore.persist.rehydrate();
    const { visibleEdgeKinds } = useViewerStore.getState();
    // Non-boolean values fall back to the defaults.
    expect(visibleEdgeKinds.sequence).toBe(DEFAULTS.visibleEdgeKinds.sequence);
    expect(visibleEdgeKinds.jump).toBe(DEFAULTS.visibleEdgeKinds.jump);
    // Valid boolean values are preserved.
    expect(visibleEdgeKinds.call).toBe(false);
    expect(visibleEdgeKinds.call_return).toBe(true);
  });

  it("preserves valid rehydrated values intact", async () => {
    const raw = JSON.stringify({
      state: {
        theme: "colorblind",
        showCallReturns: true,
        visibleEdgeKinds: {
          sequence: false,
          jump: true,
          call: false,
          call_return: false,
        },
      },
      version: 0,
    });
    globalThis.localStorage.setItem(STORAGE_KEYS.viewer, raw);
    await useViewerStore.persist.rehydrate();
    const s = useViewerStore.getState();
    expect(s.theme).toBe("colorblind");
    expect(s.showCallReturns).toBe(true);
    expect(s.visibleEdgeKinds).toEqual({
      sequence: false,
      jump: true,
      call: false,
      call_return: false,
    });
  });

  it("validates and preserves the dark theme value during rehydration", async () => {
    const raw = JSON.stringify({
      state: {
        theme: "dark",
        showCallReturns: false,
      },
      version: 0,
    });
    globalThis.localStorage.setItem(STORAGE_KEYS.viewer, raw);
    await useViewerStore.persist.rehydrate();
    const s = useViewerStore.getState();
    expect(s.theme).toBe("dark");
  });

  // ── Legacy key migration ─────────────────────────────────────────────────────

  it("migrates legacy per-setting keys into rfv.viewer on rehydration", async () => {
    // Remove the consolidated key written by beforeEach so migration can fire.
    globalThis.localStorage.removeItem(STORAGE_KEYS.viewer);
    globalThis.localStorage.setItem(STORAGE_KEYS.theme, "highContrast");
    globalThis.localStorage.setItem(STORAGE_KEYS.showCallReturns, "true");
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeSequence, "true");
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeJump, "false");
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeCall, "true");
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeCallReturn, "false");

    await useViewerStore.persist.rehydrate();
    const s = useViewerStore.getState();

    expect(s.theme).toBe("highContrast");
    expect(s.showCallReturns).toBe(true);
    expect(s.visibleEdgeKinds.sequence).toBe(true);
    expect(s.visibleEdgeKinds.jump).toBe(false);
    expect(s.visibleEdgeKinds.call).toBe(true);
    expect(s.visibleEdgeKinds.call_return).toBe(false);
  });

  it("removes legacy keys after migration so it only runs once", async () => {
    // Remove the consolidated key written by beforeEach so migration can fire.
    globalThis.localStorage.removeItem(STORAGE_KEYS.viewer);
    globalThis.localStorage.setItem(STORAGE_KEYS.theme, "colorblind");
    globalThis.localStorage.setItem(STORAGE_KEYS.showCallReturns, "false");

    await useViewerStore.persist.rehydrate();

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.theme)).toBeNull();
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.showCallReturns))
      .toBeNull();
  });

  it("uses default theme when legacy theme value is invalid", async () => {
    // Remove the consolidated key written by beforeEach so migration can fire.
    globalThis.localStorage.removeItem(STORAGE_KEYS.viewer);
    globalThis.localStorage.setItem(STORAGE_KEYS.theme, "banana");

    await useViewerStore.persist.rehydrate();
    expect(useViewerStore.getState().theme).toBe(DEFAULTS.theme);
  });

  it("uses defaults when no legacy keys or stored state are present", async () => {
    // Remove the consolidated key written by beforeEach so we start from blank storage.
    globalThis.localStorage.removeItem(STORAGE_KEYS.viewer);
    // No legacy keys or new key — should get defaults.
    await useViewerStore.persist.rehydrate();
    const s = useViewerStore.getState();
    expect(s.theme).toBe(DEFAULTS.theme);
    expect(s.showCallReturns).toBe(DEFAULTS.showCallReturns);
    expect(s.visibleEdgeKinds).toEqual(DEFAULTS.visibleEdgeKinds);
  });
});

describe("useViewerStore session state actions", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    useViewerStore.setState({
      ...DEFAULTS,
      ...DEFAULT_SESSION,
    });
  });

  it("setLayoutDirection updates layoutDirection", () => {
    useViewerStore.getState().setLayoutDirection("LR");
    expect(useViewerStore.getState().layoutDirection).toBe("LR");
  });

  it("setSearchInput updates searchInput", () => {
    useViewerStore.getState().setSearchInput("hello");
    expect(useViewerStore.getState().searchInput).toBe("hello");
  });

  it("setLabelSubgraphSearchInput updates labelSubgraphSearchInput", () => {
    useViewerStore.getState().setLabelSubgraphSearchInput("chapter1");
    expect(useViewerStore.getState().labelSubgraphSearchInput).toBe("chapter1");
  });

  it("setMinDialogue updates minDialogue", () => {
    useViewerStore.getState().setMinDialogue(5);
    expect(useViewerStore.getState().minDialogue).toBe(5);
  });

  it("toggleChapter toggles a chapter collapsed state", () => {
    useViewerStore.getState().toggleChapter("ch1");
    expect(useViewerStore.getState().collapsedChapters["ch1"]).toBe(true);
    useViewerStore.getState().toggleChapter("ch1");
    expect(useViewerStore.getState().collapsedChapters["ch1"]).toBe(false);
  });

  it("toggleParentLabel toggles a label collapsed state", () => {
    useViewerStore.getState().toggleParentLabel("label_a");
    expect(useViewerStore.getState().collapsedParentLabels["label_a"]).toBe(
      true,
    );
    useViewerStore.getState().toggleParentLabel("label_a");
    expect(useViewerStore.getState().collapsedParentLabels["label_a"]).toBe(
      false,
    );
  });

  it("setAllParentLabelsCollapsed collapses all provided labels", () => {
    useViewerStore.getState().setAllParentLabelsCollapsed(
      ["a", "b", "c"],
      true,
    );
    const { collapsedParentLabels } = useViewerStore.getState();
    expect(collapsedParentLabels["a"]).toBe(true);
    expect(collapsedParentLabels["b"]).toBe(true);
    expect(collapsedParentLabels["c"]).toBe(true);
  });

  it("setAllParentLabelsCollapsed expands all provided labels", () => {
    useViewerStore.getState().setAllParentLabelsCollapsed(["a", "b"], true);
    useViewerStore.getState().setAllParentLabelsCollapsed(["a", "b"], false);
    const { collapsedParentLabels } = useViewerStore.getState();
    expect(collapsedParentLabels["a"]).toBe(false);
    expect(collapsedParentLabels["b"]).toBe(false);
  });

  it("setFocusNodeId updates focusNodeId", () => {
    useViewerStore.getState().setFocusNodeId("node_42");
    expect(useViewerStore.getState().focusNodeId).toBe("node_42");
  });

  it("setLargeGraphModeOverride updates largeGraphModeOverride", () => {
    useViewerStore.getState().setLargeGraphModeOverride(true);
    expect(useViewerStore.getState().largeGraphModeOverride).toBe(true);
    useViewerStore.getState().setLargeGraphModeOverride(null);
    expect(useViewerStore.getState().largeGraphModeOverride).toBeNull();
  });

  it("setSelectedNodeId updates selectedNodeId", () => {
    useViewerStore.getState().setSelectedNodeId("node_1");
    expect(useViewerStore.getState().selectedNodeId).toBe("node_1");
  });

  it("setSelectedDialogueLineIndex updates selectedDialogueLineIndex", () => {
    useViewerStore.getState().setSelectedDialogueLineIndex(3);
    expect(useViewerStore.getState().selectedDialogueLineIndex).toBe(3);
    useViewerStore.getState().setSelectedDialogueLineIndex(null);
    expect(useViewerStore.getState().selectedDialogueLineIndex).toBeNull();
  });

  it("toggleShowAllInspectorLines flips showAllInspectorLines", () => {
    expect(useViewerStore.getState().showAllInspectorLines).toBe(false);
    useViewerStore.getState().toggleShowAllInspectorLines();
    expect(useViewerStore.getState().showAllInspectorLines).toBe(true);
    useViewerStore.getState().toggleShowAllInspectorLines();
    expect(useViewerStore.getState().showAllInspectorLines).toBe(false);
  });

  it("setShowAllInspectorLines sets showAllInspectorLines directly", () => {
    useViewerStore.getState().setShowAllInspectorLines(true);
    expect(useViewerStore.getState().showAllInspectorLines).toBe(true);
    useViewerStore.getState().setShowAllInspectorLines(false);
    expect(useViewerStore.getState().showAllInspectorLines).toBe(false);
  });

  it("setActiveDialogueResultIndex updates activeDialogueResultIndex", () => {
    useViewerStore.getState().setActiveDialogueResultIndex(2);
    expect(useViewerStore.getState().activeDialogueResultIndex).toBe(2);
  });

  it("setDialogueSearchResults updates dialogueSearchResults", () => {
    const results = [{
      nodeId: "n1",
      nodeLabel: "start",
      lineIndex: 0,
      lineText: "hello",
    }];
    useViewerStore.getState().setDialogueSearchResults(results);
    expect(useViewerStore.getState().dialogueSearchResults).toEqual(results);
  });

  it("toggleShowAdvancedControls flips showAdvancedControls", () => {
    expect(useViewerStore.getState().showAdvancedControls).toBe(false);
    useViewerStore.getState().toggleShowAdvancedControls();
    expect(useViewerStore.getState().showAdvancedControls).toBe(true);
    useViewerStore.getState().toggleShowAdvancedControls();
    expect(useViewerStore.getState().showAdvancedControls).toBe(false);
  });

  it("toggleShowAllLabelSubgraphToggles flips showAllLabelSubgraphToggles", () => {
    expect(useViewerStore.getState().showAllLabelSubgraphToggles).toBe(false);
    useViewerStore.getState().toggleShowAllLabelSubgraphToggles();
    expect(useViewerStore.getState().showAllLabelSubgraphToggles).toBe(true);
  });

  it("setStandaloneDialogueSearchMode updates standaloneDialogueSearchMode", () => {
    useViewerStore.getState().setStandaloneDialogueSearchMode("full");
    expect(useViewerStore.getState().standaloneDialogueSearchMode).toBe("full");
  });

  it("sets and resets mock flags for conditional simulation", () => {
    useViewerStore.getState().setMockFlag("flag_a", "true");
    useViewerStore.getState().setMockFlag("flag_b", "false");
    expect(
      Object.fromEntries(Object.entries(useViewerStore.getState().mockFlags)),
    ).toEqual({
      flag_a: "true",
      flag_b: "false",
    });

    useViewerStore.getState().resetMockFlags();
    expect(Object.keys(useViewerStore.getState().mockFlags)).toEqual([]);
  });

  it("ignores unsafe mock flag keys to prevent prototype pollution", () => {
    useViewerStore.getState().setMockFlag("__proto__", "true");
    useViewerStore.getState().setMockFlag("constructor", "false");
    useViewerStore.getState().setMockFlag("prototype", "unknown");
    useViewerStore.getState().setMockFlag("safe_flag", "true");

    const mockFlags = useViewerStore.getState().mockFlags;
    expect(Object.prototype.hasOwnProperty.call(mockFlags, "__proto__")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(mockFlags, "constructor")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(mockFlags, "prototype")).toBe(
      false,
    );
    expect(mockFlags.safe_flag).toBe("true");
  });

  it("setConditionVisibilityMode updates conditional visibility mode", () => {
    useViewerStore.getState().setConditionVisibilityMode("hide");
    expect(useViewerStore.getState().conditionVisibilityMode).toBe("hide");
  });

  it("resetSession resets all session state to defaults without touching persisted state", () => {
    // Mutate persisted state.
    useViewerStore.getState().setTheme("highContrast");
    useViewerStore.getState().setShowCallReturns(true);
    // Mutate session state.
    useViewerStore.getState().setSearchInput("foo");
    useViewerStore.getState().setMinDialogue(10);
    useViewerStore.getState().toggleChapter("ch1");
    useViewerStore.getState().setFocusNodeId("n1");
    useViewerStore.getState().setSelectedNodeId("n2");

    useViewerStore.getState().resetSession();

    const s = useViewerStore.getState();
    // Persisted state should survive.
    expect(s.theme).toBe("highContrast");
    expect(s.showCallReturns).toBe(true);
    // Session state should be reset.
    expect(s.searchInput).toBe("");
    expect(s.minDialogue).toBe(0);
    expect(s.collapsedChapters).toEqual({});
    expect(s.focusNodeId).toBe("");
    expect(s.selectedNodeId).toBe("");
    expect(s.layoutDirection).toBe("TB");
    expect(Object.keys(s.mockFlags)).toEqual([]);
    expect(s.conditionVisibilityMode).toBe("fade");
  });
});
