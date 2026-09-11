import type { StateCreator } from "zustand";
import {
  AUTO_PARSER_VARIANT,
  DEFAULT_PARSER_VARIANT,
  getParserVariants,
  type ScreenActionRule,
} from "../../config/parserRules.ts";
import type { ParserRuleSettingsStore } from "../parserRuleSettingsStore.ts";

export type RulesByVariant = Record<string, ScreenActionRule[]>;

export interface CustomRulesState {
  customRulesByVariant: RulesByVariant;
}

export interface CustomRulesActions {
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

export type CustomRulesSlice = CustomRulesState & CustomRulesActions;

export function createEmptyRulesByVariant(): RulesByVariant {
  return Object.fromEntries(
    [AUTO_PARSER_VARIANT, ...getParserVariants()].map((variant) =>
      [variant, []] as const
    ),
  );
}

export const defaultCustomRulesState: CustomRulesState = {
  customRulesByVariant: createEmptyRulesByVariant(),
};

const DANGEROUS_OBJECT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function isUnsafeObjectKey(key: string): boolean {
  return DANGEROUS_OBJECT_KEYS.has(key);
}

export const createCustomRulesSlice: StateCreator<
  ParserRuleSettingsStore,
  [["zustand/immer", never]],
  [],
  CustomRulesSlice
> = (set) => ({
  ...defaultCustomRulesState,

  addCustomRule: (variantKey) =>
    set((draft) => {
      const target = typeof variantKey === "string"
        ? variantKey
        : (draft.selectedVariant === AUTO_PARSER_VARIANT
          ? DEFAULT_PARSER_VARIANT
          : draft.selectedVariant);
      if (isUnsafeObjectKey(target)) return;
      if (
        !Object.hasOwn(draft.customRulesByVariant, target) ||
        !Array.isArray(draft.customRulesByVariant[target])
      ) {
        draft.customRulesByVariant[target] = [];
      }
      draft.customRulesByVariant[target].push({
        actionName: "",
        actionKind: "jump",
      });
    }),

  updateCustomRule: (idx, patch, variantKey) =>
    set((draft) => {
      const target = typeof variantKey === "string"
        ? variantKey
        : (draft.selectedVariant === AUTO_PARSER_VARIANT
          ? DEFAULT_PARSER_VARIANT
          : draft.selectedVariant);
      if (isUnsafeObjectKey(target)) return;
      if (
        !Object.hasOwn(draft.customRulesByVariant, target) ||
        !Array.isArray(draft.customRulesByVariant[target])
      ) return;
      const variantRules = draft.customRulesByVariant[target];
      const rule = variantRules[idx];
      if (!rule) return;
      if (patch.actionName !== undefined) {
        rule.actionName = patch.actionName;
      }
      if (patch.actionKind !== undefined) {
        rule.actionKind = patch.actionKind;
      }
    }),

  removeCustomRule: (idx, variantKey) =>
    set((draft) => {
      const target = typeof variantKey === "string"
        ? variantKey
        : (draft.selectedVariant === AUTO_PARSER_VARIANT
          ? DEFAULT_PARSER_VARIANT
          : draft.selectedVariant);
      if (isUnsafeObjectKey(target)) return;
      if (
        !Object.hasOwn(draft.customRulesByVariant, target) ||
        !Array.isArray(draft.customRulesByVariant[target])
      ) return;
      const rules = draft.customRulesByVariant[target];
      if (idx < 0 || idx >= rules.length) return;
      rules.splice(idx, 1);
    }),

  resetSettings: () =>
    set((draft) => {
      draft.selectedVariant = DEFAULT_PARSER_VARIANT;
      draft.customRulesByVariant = createEmptyRulesByVariant();
    }),
});
