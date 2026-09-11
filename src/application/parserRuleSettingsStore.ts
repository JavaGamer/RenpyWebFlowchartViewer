import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";
import {
  compileCustomVariant,
  type CustomVariantDefinition,
  DEFAULT_PARSER_VARIANT,
  isParserVariant,
  normalizeScreenActionRule,
  type ParserVariant,
  registerParserVariantPlugin,
  RESERVED_VARIANT_IDS,
  type ScreenActionRule,
} from "../config/parserRules.ts";
import { STORAGE_KEYS } from "../config/storageKeys.ts";
import {
  createCustomRulesSlice,
  createCustomVariantsSlice,
  createEmptyRulesByVariant,
  createVariantSlice,
  type CustomVariantsSlice,
  type RulesByVariant,
} from "./parserRuleSettingsSlices/index.ts";

export type { RulesByVariant };

export interface ParserRuleSettings {
  selectedVariant: ParserVariant;
  customRulesByVariant: RulesByVariant;
  customVariants: CustomVariantDefinition[];
}

export interface ParserRuleSettingsActions {
  setSelectedVariant: (variant: ParserVariant) => void;
  addCustomRule: (variantKey?: string) => void;
  updateCustomRule: (
    idx: number,
    patch: Partial<
      { actionName: string; actionKind: ScreenActionRule["actionKind"] }
    >,
    variantKey?: string,
  ) => void;
  removeCustomRule: (idx: number, variantKey?: string) => void;
  resetSettings: () => void;
}

export type ParserRuleSettingsStore =
  & ParserRuleSettings
  & ParserRuleSettingsActions
  & CustomVariantsSlice;

export const defaultParserRuleSettings: ParserRuleSettings = {
  selectedVariant: DEFAULT_PARSER_VARIANT,
  customRulesByVariant: createEmptyRulesByVariant(),
  customVariants: [],
};

const screenActionRuleSchema = z.object({
  actionName: z.string().transform((s) => s.trim()).pipe(z.string().min(1)),
  actionKind: z.enum([
    "jump",
    "call",
    "show",
    "hide",
    "set_variable",
    "toggle_variable",
    "confirm",
    "null_action",
    "show_menu",
  ]),
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

export const branchStatementSchema = z.object({
  pattern: z.string().min(1).max(300),
  branchKind: z.enum(["jump", "call"]),
  targetGroup: z.number().int().nonnegative().max(9).optional(),
  suppressFallthrough: z.boolean().optional(),
});

export const customVariantDefinitionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9_-]+$/,
      "ID can only contain lowercase letters, numbers, hyphens, and underscores.",
    )
    .refine((val) => !RESERVED_VARIANT_IDS.has(val.toLowerCase()), {
      message: "Variant ID is reserved or already in use by a built-in preset.",
    }),
  label: z.string().min(1).max(64),
  description: z.string().max(500).optional(),
  baseVariant: z.string().max(64).optional(),
  screenActionRules: rulesArraySchema.optional(),
  stagingKeywords: z.array(z.string().max(64)).optional(),
  terminalPatterns: z.array(z.string().max(300)).optional(),
  detectionPatterns: z.array(z.string().max(300)).optional(),
  branchStatements: z.array(branchStatementSchema).optional(),
});

const customVariantsArraySchema = z
  .array(z.unknown())
  .transform((arr) =>
    arr.flatMap((item) => {
      const result = customVariantDefinitionSchema.safeParse(item);
      return result.success ? [result.data as CustomVariantDefinition] : [];
    })
  )
  .catch([]);

const parserRuleSettingsSchema = z.object({
  selectedVariant: z
    .string()
    .catch(defaultParserRuleSettings.selectedVariant),
  customRulesByVariant: z
    .record(z.string(), rulesArraySchema)
    .catch({}),
  customVariants: customVariantsArraySchema,
});

function mergePersistedState(
  persisted: unknown,
  current: ParserRuleSettingsStore,
): ParserRuleSettingsStore {
  const parsed = parserRuleSettingsSchema.parse(
    persisted && typeof persisted === "object" ? persisted : {},
  );

  const registeredCustomVariants: CustomVariantDefinition[] = [];
  for (const def of parsed.customVariants) {
    try {
      const plugin = compileCustomVariant(def);
      registerParserVariantPlugin(plugin);
      registeredCustomVariants.push(def);
    } catch (err) {
      console.warn(
        `Failed to re-register persisted custom variant "${def.id}":`,
        err,
      );
    }
  }

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
    customVariants: registeredCustomVariants,
  };
}

export const useParserRuleSettingsStore = create<ParserRuleSettingsStore>()(
  persist(
    immer((set, get, api) => ({
      ...createVariantSlice(set, get, api),
      ...createCustomRulesSlice(set, get, api),
      ...createCustomVariantsSlice(set, get, api),
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
        customVariants: state.customVariants,
      }),
    },
  ),
);
