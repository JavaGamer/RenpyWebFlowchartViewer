/**
 * src/application/viewerStoreSlices/simulationSlice.ts
 *
 * Session state for condition-simulation mock flags. Includes prototype-
 * pollution safeguards so user-supplied flag keys cannot overwrite built-in
 * object properties.
 */

import type { StateCreator } from 'zustand';
import type { MockFlagValue } from '../../domain';
import type { ViewerStore } from '../viewerStore';

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Set of property names forbidden as mock-flag keys to prevent prototype pollution
 * when user-supplied flag strings are written to the flags record.
 */
export const UNSAFE_MOCK_FLAG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Creates an empty mock-flags object with a null prototype to avoid pollution. */
export function createEmptyMockFlags(): Record<string, MockFlagValue> {
  return Object.create(null) as Record<string, MockFlagValue>;
}

/** Returns `true` when `flag` is safe to use as a mock-flags record key. */
export function isSafeMockFlagKey(flag: string): boolean {
  return !UNSAFE_MOCK_FLAG_KEYS.has(flag);
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface SimulationSliceState {
  mockFlags: Record<string, MockFlagValue>;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface SimulationSliceActions {
  setMockFlag: (flag: string, value: MockFlagValue) => void;
  resetMockFlags: () => void;
}

export type SimulationSlice = SimulationSliceState & SimulationSliceActions;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const defaultSimulationState: SimulationSliceState = {
  mockFlags: createEmptyMockFlags(),
};

// ─── Slice creator ────────────────────────────────────────────────────────────

export const createSimulationSlice: StateCreator<
  ViewerStore,
  [['zustand/immer', never]],
  [],
  SimulationSlice
> = (set) => ({
  ...defaultSimulationState,

  setMockFlag: (flag, value) =>
    set((draft) => {
      if (!isSafeMockFlagKey(flag)) return;
      draft.mockFlags[flag] = value;
    }),

  resetMockFlags: () =>
    set((draft) => {
      draft.mockFlags = createEmptyMockFlags();
    }),
});
