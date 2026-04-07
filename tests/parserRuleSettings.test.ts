import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultParserRuleSettings,
  loadParserRuleSettings,
  saveParserRuleSettings,
} from '../src/application/parserRuleSettings';
import { STORAGE_KEYS } from '../src/config/storageKeys';

describe('parserRuleSettings storage', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('returns defaults when storage is empty', () => {
    expect(loadParserRuleSettings()).toEqual(defaultParserRuleSettings);
  });

  it('persists and restores selected variant with per-variant custom rules', () => {
    saveParserRuleSettings({
      selectedVariant: 'st',
      customRulesByVariant: {
        renpy: [{ actionName: 'Warp', actionKind: 'jump' }],
        st: [{ actionName: 'Title', actionKind: 'call' }],
      },
    });
    expect(loadParserRuleSettings()).toEqual({
      selectedVariant: 'st',
      customRulesByVariant: {
        renpy: [{ actionName: 'Warp', actionKind: 'jump' }],
        st: [{ actionName: 'Title', actionKind: 'call' }],
      },
    });
  });

  it('falls back to defaults when storage payload is invalid', () => {
    globalThis.localStorage.setItem(STORAGE_KEYS.parserSettings, '{"selectedVariant":"unknown"}');
    expect(loadParserRuleSettings()).toEqual(defaultParserRuleSettings);
  });
});
