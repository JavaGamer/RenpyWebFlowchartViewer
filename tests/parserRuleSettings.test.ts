// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useParserRuleSettingsStore, defaultParserRuleSettings } from '../src/application/parserRuleSettingsStore';
import { STORAGE_KEYS } from '../src/config/storageKeys';

describe('useParserRuleSettingsStore persistence', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    useParserRuleSettingsStore.setState(defaultParserRuleSettings);
  });

  it('returns defaults when storage is empty', () => {
    const state = useParserRuleSettingsStore.getState();
    expect(state.selectedVariant).toBe(defaultParserRuleSettings.selectedVariant);
    expect(state.customRulesByVariant).toEqual(defaultParserRuleSettings.customRulesByVariant);
  });

  it('persists settings to localStorage when variant is changed', () => {
    useParserRuleSettingsStore.getState().setSelectedVariant('st');
    const raw = globalThis.localStorage.getItem(STORAGE_KEYS.parserSettings);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as { state?: { selectedVariant?: string } };
    expect(parsed.state?.selectedVariant).toBe('st');
  });

  it('adds and removes custom rules for the active variant', () => {
    useParserRuleSettingsStore.getState().addCustomRule();
    useParserRuleSettingsStore.getState().updateCustomRule(0, { actionName: 'Warp', actionKind: 'call' });
    let state = useParserRuleSettingsStore.getState();
    expect(state.customRulesByVariant.renpy).toEqual([{ actionName: 'Warp', actionKind: 'call' }]);

    useParserRuleSettingsStore.getState().removeCustomRule(0);
    state = useParserRuleSettingsStore.getState();
    expect(state.customRulesByVariant.renpy).toEqual([]);
  });

  it('resets to defaults', () => {
    useParserRuleSettingsStore.getState().setSelectedVariant('st');
    useParserRuleSettingsStore.getState().addCustomRule();
    useParserRuleSettingsStore.getState().resetSettings();
    const state = useParserRuleSettingsStore.getState();
    expect(state.selectedVariant).toBe('renpy');
    expect(state.customRulesByVariant).toEqual(defaultParserRuleSettings.customRulesByVariant);
  });

  it('validates and normalizes data rehydrated from localStorage', () => {
    // Write a payload with an invalid variant and a malformed rule directly to the
    // store's underlying localStorage (the same storage instance the persist middleware uses).
    const raw = JSON.stringify({
      state: {
        selectedVariant: 'unknown',
        customRulesByVariant: {
          renpy: [{ actionName: 'Warp', actionKind: 'jump' }, { actionName: '', actionKind: 'jump' }],
          st: [],
        },
      },
      version: 0,
    });
    globalThis.localStorage.setItem(STORAGE_KEYS.parserSettings, raw);

    // Trigger rehydration so the store reads and validates the stored data.
    useParserRuleSettingsStore.persist.rehydrate();
    const state = useParserRuleSettingsStore.getState();
    // Invalid variant falls back to default.
    expect(state.selectedVariant).toBe('renpy');
    // Valid rule is kept, empty actionName rule is filtered.
    expect(state.customRulesByVariant.renpy).toEqual([{ actionName: 'Warp', actionKind: 'jump' }]);
  });
});
