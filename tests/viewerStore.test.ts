// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  useViewerStore,
  defaultPersistedState as _defaultPersisted,
} from '../src/application/viewerStore';
import { STORAGE_KEYS } from '../src/config/storageKeys';

// Re-export private defaults via a white-box approach: we rely on the store's
// initial state rather than re-importing private symbols.
const DEFAULTS = {
  theme: 'violet' as const,
  showCallReturns: false,
  visibleEdgeKinds: {
    sequence: true,
    jump: true,
    call: true,
    call_return: true,
  },
};

describe('useViewerStore persistence', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    // Reset the store to its initial default state between tests.
    useViewerStore.setState({
      ...DEFAULTS,
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
    });
  });

  // ── Defaults ────────────────────────────────────────────────────────────────

  it('returns defaults when storage is empty', () => {
    const s = useViewerStore.getState();
    expect(s.theme).toBe(DEFAULTS.theme);
    expect(s.showCallReturns).toBe(DEFAULTS.showCallReturns);
    expect(s.visibleEdgeKinds).toEqual(DEFAULTS.visibleEdgeKinds);
  });

  // ── Persistence ─────────────────────────────────────────────────────────────

  it('writes state under STORAGE_KEYS.viewer when theme changes', () => {
    useViewerStore.getState().setTheme('highContrast');
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.viewer);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as { state?: { theme?: string } };
    expect(parsed.state?.theme).toBe('highContrast');
  });

  it('writes showCallReturns and visibleEdgeKinds under STORAGE_KEYS.viewer', () => {
    useViewerStore.getState().setShowCallReturns(true);
    useViewerStore.getState().setEdgeKindVisible('jump', false);
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

  // ── Rehydration / normalisation ──────────────────────────────────────────────

  it('falls back to default theme when an invalid theme is rehydrated', async () => {
    const raw = JSON.stringify({
      state: { theme: 'not-a-real-theme', showCallReturns: false, visibleEdgeKinds: DEFAULTS.visibleEdgeKinds },
      version: 0,
    });
    globalThis.localStorage.setItem(STORAGE_KEYS.viewer, raw);
    await useViewerStore.persist.rehydrate();
    expect(useViewerStore.getState().theme).toBe(DEFAULTS.theme);
  });

  it('falls back to default for invalid visibleEdgeKinds entries', async () => {
    const raw = JSON.stringify({
      state: {
        theme: 'violet',
        showCallReturns: true,
        visibleEdgeKinds: { sequence: 'yes', jump: null, call: false, call_return: true },
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

  it('preserves valid rehydrated values intact', async () => {
    const raw = JSON.stringify({
      state: {
        theme: 'colorblind',
        showCallReturns: true,
        visibleEdgeKinds: { sequence: false, jump: true, call: false, call_return: false },
      },
      version: 0,
    });
    globalThis.localStorage.setItem(STORAGE_KEYS.viewer, raw);
    await useViewerStore.persist.rehydrate();
    const s = useViewerStore.getState();
    expect(s.theme).toBe('colorblind');
    expect(s.showCallReturns).toBe(true);
    expect(s.visibleEdgeKinds).toEqual({ sequence: false, jump: true, call: false, call_return: false });
  });

  // ── Legacy key migration ─────────────────────────────────────────────────────

  it('migrates legacy per-setting keys into rfv.viewer on rehydration', async () => {
    // Remove the consolidated key written by beforeEach so migration can fire.
    globalThis.localStorage.removeItem(STORAGE_KEYS.viewer);
    globalThis.localStorage.setItem(STORAGE_KEYS.theme, 'highContrast');
    globalThis.localStorage.setItem(STORAGE_KEYS.showCallReturns, 'true');
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeSequence, 'true');
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeJump, 'false');
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeCall, 'true');
    globalThis.localStorage.setItem(STORAGE_KEYS.edgeCallReturn, 'false');

    await useViewerStore.persist.rehydrate();
    const s = useViewerStore.getState();

    expect(s.theme).toBe('highContrast');
    expect(s.showCallReturns).toBe(true);
    expect(s.visibleEdgeKinds.sequence).toBe(true);
    expect(s.visibleEdgeKinds.jump).toBe(false);
    expect(s.visibleEdgeKinds.call).toBe(true);
    expect(s.visibleEdgeKinds.call_return).toBe(false);
  });

  it('removes legacy keys after migration so it only runs once', async () => {
    // Remove the consolidated key written by beforeEach so migration can fire.
    globalThis.localStorage.removeItem(STORAGE_KEYS.viewer);
    globalThis.localStorage.setItem(STORAGE_KEYS.theme, 'colorblind');
    globalThis.localStorage.setItem(STORAGE_KEYS.showCallReturns, 'false');

    await useViewerStore.persist.rehydrate();

    expect(globalThis.localStorage.getItem(STORAGE_KEYS.theme)).toBeNull();
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.showCallReturns)).toBeNull();
  });

  it('uses default theme when legacy theme value is invalid', async () => {
    // Remove the consolidated key written by beforeEach so migration can fire.
    globalThis.localStorage.removeItem(STORAGE_KEYS.viewer);
    globalThis.localStorage.setItem(STORAGE_KEYS.theme, 'banana');

    await useViewerStore.persist.rehydrate();
    expect(useViewerStore.getState().theme).toBe(DEFAULTS.theme);
  });

  it('uses defaults when no legacy keys or stored state are present', async () => {
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
