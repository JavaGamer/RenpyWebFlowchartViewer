import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";
import {
  DEFAULT_PARSER_VARIANT,
  isParserVariant,
  normalizeScreenActionRule,
  type ParserVariant,
  type ScreenActionRule,
} from "../config/parserRules.ts";
import { STORAGE_KEYS } from "../config/storageKeys.ts";
import {
  createCustomRulesSlice,
  createEmptyRulesByVariant,
  createVariantSlice,

  type RulesByVariant,
} from "./parserRuleSettingsSlices/index.ts";

export type { RulesByVariant };

export interface ParserRuleSettings {
  selectedVariant: ParserVariant;
  customRulesByVariant: RulesByVariant;
}

export interface ParserRuleSettingsActions {
  setSelectedVariant: (variant: ParserVariant) => void;
  addCustomRule: () => void;
  updateCustomRule: (
    idx: number,
    patch: Partial<
      { actionName: string; actionKind: ScreenActionRule["actionKind"] }
    >,
  ) => void;
  removeCustomRule: (idx: number) => void;
  resetSettings: () => void;
}

export type ParserRuleSettingsStore =
  & ParserRuleSettings
  & ParserRuleSettingsActions;

export const defaultParserRuleSettings: ParserRuleSettings = {
  selectedVariant: DEFAULT_PARSER_VARIANT,
  customRulesByVariant: createEmptyRulesByVariant(),
};

const screenActionRuleSchema = z.object({
  actionName: z.string().transform((s) => s.trim()).pipe(z.string().min(1)),
  actionKind: z.enum(["jump", "call"]),
});

const rulesArraySchema = z
  .array(z.unknown())
  .transform((arr) =>
    arr.flatMap((item) => {
      const result = screenActionRuleSchema.safeParse(item);
      return result.success ? [result.data as ScreenActionRule] : [];
    })
  )
  .catch([]);

const parserRuleSettingsSchema = z.object({
  selectedVariant: z
    .string()
    .refine(isParserVariant)
    .catch(defaultParserRuleSettings.selectedVariant),
  customRulesByVariant: z
    .record(z.string(), rulesArraySchema)
    .catch({}),
});

function mergePersistedState(
  persisted: unknown,
  current: ParserRuleSettingsStore,
): ParserRuleSettingsStore {
  const parsed = parserRuleSettingsSchema.parse(
    persisted && typeof persisted === "object" ? persisted : {},
  );
  const normalizedRules = createEmptyRulesByVariant();
  for (const [variant, rules] of Object.entries(parsed.customRulesByVariant)) {
    if (!isParserVariant(variant)) continue;
    normalizedRules[variant] = (rules ?? [])
      .map(normalizeScreenActionRule)
      .filter((rule): rule is ScreenActionRule => rule !== null);
  }
  const selectedVariant = isParserVariant(parsed.selectedVariant)
    ? parsed.selectedVariant
    : defaultParserRuleSettings.selectedVariant;
  return {
    ...current,
    selectedVariant,
    customRulesByVariant: normalizedRules,
  };
}

export const useParserRuleSettingsStore = create<ParserRuleSettingsStore>()(
  persist(
    immer((set, get, api) => ({
      ...createVariantSlice(set, get, api),
      ...createCustomRulesSlice(set, get, api),
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
