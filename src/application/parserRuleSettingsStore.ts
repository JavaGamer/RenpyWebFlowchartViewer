import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
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

const screenActionRuleSchema = z.object({
  actionName: z.string().transform((s) => s.trim()).pipe(z.string().min(1)),
  actionKind: z.enum(['jump', 'call']),
});

const rulesArraySchema = z
  .array(z.unknown())
  .transform((arr) =>
    arr.flatMap((item) => {
      const result = screenActionRuleSchema.safeParse(item);
      return result.success ? [result.data as ScreenActionRule] : [];
    }),
  )
  .catch([]);

const parserRuleSettingsSchema = z.object({
  selectedVariant: z
    .string()
    .refine(isParserVariant)
    .catch(defaultParserRuleSettings.selectedVariant),
  customRulesByVariant: z
    .object({ renpy: rulesArraySchema, st: rulesArraySchema })
    .catch(defaultParserRuleSettings.customRulesByVariant),
});

function mergePersistedState(
  persisted: unknown,
  current: ParserRuleSettingsStore,
): ParserRuleSettingsStore {
  const parsed = parserRuleSettingsSchema.parse(
    persisted && typeof persisted === 'object' ? persisted : {},
  );
  return { ...current, ...parsed };
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
