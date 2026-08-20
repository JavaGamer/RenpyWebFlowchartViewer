import type { StateCreator } from "zustand";
import {
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

export type CustomRulesSlice = CustomRulesState & CustomRulesActions;

export function createEmptyRulesByVariant(): RulesByVariant {
  return Object.fromEntries(
    getParserVariants().map((variant) => [variant, []] as const),
  );
}

export const defaultCustomRulesState: CustomRulesState = {
  customRulesByVariant: createEmptyRulesByVariant(),
};

export const createCustomRulesSlice: StateCreator<
  ParserRuleSettingsStore,
  [["zustand/immer", never]],
  [],
  CustomRulesSlice
> = (set) => ({
  ...defaultCustomRulesState,

  addCustomRule: () =>
    set((draft) => {
      if (!draft.customRulesByVariant[draft.selectedVariant]) {
        draft.customRulesByVariant[draft.selectedVariant] = [];
      }
      draft.customRulesByVariant[draft.selectedVariant].push({
        actionName: "",
        actionKind: "jump",
      });
    }),

  updateCustomRule: (idx, patch) =>
    set((draft) => {
      const variantRules = draft.customRulesByVariant[draft.selectedVariant];
      if (!variantRules) return;
      const rule = variantRules[idx];
      if (!rule) return;
      if (patch.actionName !== undefined) {
        rule.actionName = patch.actionName;
      }
      if (patch.actionKind !== undefined) {
        rule.actionKind = patch.actionKind;
      }
    }),

  removeCustomRule: (idx) =>
    set((draft) => {
      const rules = draft.customRulesByVariant[draft.selectedVariant];
      if (!rules || idx < 0 || idx >= rules.length) return;
      rules.splice(idx, 1);
    }),

  resetSettings: () =>
    set((draft) => {
      draft.selectedVariant = DEFAULT_PARSER_VARIANT;
      draft.customRulesByVariant = createEmptyRulesByVariant();
    }),
});
