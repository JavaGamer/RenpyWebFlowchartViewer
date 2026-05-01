import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import { PARSER_VARIANTS, type ParserVariant, type ScreenActionRule } from '../config/parserRules';
import { STORAGE_KEYS } from '../config/storageKeys';

export type RulesByVariant = Record<ParserVariant, ScreenActionRule[]>;

export interface ParserRuleSettings {
  selectedVariant: ParserVariant;
  customRulesByVariant: RulesByVariant;
}

export interface ParserRuleSettingsActions {
  setSelectedVariant: (variant: ParserVariant) => void;
  addCustomRule: () => void;
  updateCustomRule: (idx: number, patch: Partial<{ actionName: string; actionKind: ScreenActionRule['actionKind'] }>) => void;
  removeCustomRule: (idx: number) => void;
  resetSettings: () => void;
}

export type ParserRuleSettingsStore = ParserRuleSettings & ParserRuleSettingsActions;

export const defaultParserRuleSettings: ParserRuleSettings = {
  selectedVariant: 'renpy',
  customRulesByVariant: {
    renpy: [],
    st: [],
  },
};

function isParserVariant(value: unknown): value is ParserVariant {
  return typeof value === 'string' && PARSER_VARIANTS.includes(value as ParserVariant);
}

function normalizeRule(value: unknown): ScreenActionRule | null {
  if (!value || typeof value !== 'object') return null;
  const actionName =
    'actionName' in value && typeof value.actionName === 'string' ? value.actionName.trim() : '';
  const actionKind =
    'actionKind' in value && (value.actionKind === 'jump' || value.actionKind === 'call')
      ? value.actionKind
      : null;
  if (!actionName || !actionKind) return null;
  return { actionName, actionKind };
}

function mergePersistedState(
  persisted: unknown,
  current: ParserRuleSettingsStore,
): ParserRuleSettingsStore {
  if (!persisted || typeof persisted !== 'object') return current;
  const p = persisted as Partial<ParserRuleSettings>;

  const selectedVariant = isParserVariant(p.selectedVariant)
    ? p.selectedVariant
    : defaultParserRuleSettings.selectedVariant;

  const renpyRules = (p.customRulesByVariant?.renpy ?? [])
    .map(normalizeRule)
    .filter((rule): rule is ScreenActionRule => rule !== null);

  const stRules = (p.customRulesByVariant?.st ?? [])
    .map(normalizeRule)
    .filter((rule): rule is ScreenActionRule => rule !== null);

  return {
    ...current,
    selectedVariant,
    customRulesByVariant: { renpy: renpyRules, st: stRules },
  };
}

export const useParserRuleSettingsStore = create<ParserRuleSettingsStore>()(
  persist(
    immer((set) => ({
      ...defaultParserRuleSettings,

      setSelectedVariant: (variant) =>
        set((draft) => {
          draft.selectedVariant = variant;
        }),

      addCustomRule: () =>
        set((draft) => {
          draft.customRulesByVariant[draft.selectedVariant].push({
            actionName: '',
            actionKind: 'jump',
          });
        }),

      updateCustomRule: (idx, patch) =>
        set((draft) => {
          const rule = draft.customRulesByVariant[draft.selectedVariant][idx];
          if (!rule) return;
          if (patch.actionName !== undefined) rule.actionName = patch.actionName;
          if (patch.actionKind !== undefined) rule.actionKind = patch.actionKind;
        }),

      removeCustomRule: (idx) =>
        set((draft) => {
          draft.customRulesByVariant[draft.selectedVariant].splice(idx, 1);
        }),

      resetSettings: () =>
        set(() => ({ ...defaultParserRuleSettings })),
    })),
    {
      name: STORAGE_KEYS.parserSettings,
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
            // ignore write failures (e.g. quota exceeded, restricted browsing mode)
          }
        },
        removeItem: (key: string) => {
          try {
            globalThis.localStorage.removeItem(key);
          } catch {
            // ignore
          }
        },
      })),
      merge: (persisted, current) => mergePersistedState(persisted, current),
      partialize: (state): ParserRuleSettings => ({
        selectedVariant: state.selectedVariant,
        customRulesByVariant: state.customRulesByVariant,
      }),
    },
  ),
);
