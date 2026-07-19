import type { StateCreator } from "zustand";
import {
  DEFAULT_PARSER_VARIANT,
  type ParserVariant,
} from "../../config/parserRules.ts";
import type { ParserRuleSettingsStore } from "../parserRuleSettingsStore.ts";

export interface VariantState {
  selectedVariant: ParserVariant;
}

export interface VariantActions {
  setSelectedVariant: (variant: ParserVariant) => void;
}

export type VariantSlice = VariantState & VariantActions;

export const defaultVariantState: VariantState = {
  selectedVariant: DEFAULT_PARSER_VARIANT,
};

export const createVariantSlice: StateCreator<
  ParserRuleSettingsStore,
  [["zustand/immer", never]],
  [],
  VariantSlice
> = (set) => ({
  ...defaultVariantState,

  setSelectedVariant: (variant) =>
    set((draft) => {
      draft.selectedVariant = variant;
    }),
});
