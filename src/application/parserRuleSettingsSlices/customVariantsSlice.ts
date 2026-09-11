import type { StateCreator } from "zustand";
import {
  compileCustomVariant,
  type CustomVariantDefinition,
  registerParserVariantPlugin,
  RESERVED_VARIANT_IDS,
  unregisterParserVariantPlugin,
} from "../../config/parserRules.ts";
import { customVariantDefinitionSchema } from "../parserRuleSettingsSchemas.ts";
import type { ParserRuleSettingsStore } from "../parserRuleSettingsStore.ts";

function validateVariantId(id: string): void {
  const normalized = (id ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("Variant ID must not be empty.");
  }
  if (!/^[a-z0-9_-]{1,64}$/.test(normalized)) {
    throw new Error(
      `Variant ID "${id}" is invalid. Must contain only lowercase letters, numbers, hyphens, and underscores (1-64 characters).`,
    );
  }
  if (RESERVED_VARIANT_IDS.has(normalized)) {
    throw new Error(
      `Variant ID "${id}" is reserved or already used by a built-in preset.`,
    );
  }
}

export interface CustomVariantsState {
  customVariants: CustomVariantDefinition[];
}

export interface CustomVariantsActions {
  addCustomVariant: (def: CustomVariantDefinition) => void;
  updateCustomVariant: (
    id: string,
    patch: Partial<CustomVariantDefinition>,
  ) => void;
  removeCustomVariant: (id: string) => void;
  exportCustomVariant: (id: string) => string;
  importCustomVariant: (
    jsonStr: string,
  ) => { success: boolean; id?: string; error?: string };
}

export type CustomVariantsSlice = CustomVariantsState & CustomVariantsActions;

export const defaultCustomVariantsState: CustomVariantsState = {
  customVariants: [],
};

export const createCustomVariantsSlice: StateCreator<
  ParserRuleSettingsStore,
  [["zustand/immer", never]],
  [],
  CustomVariantsSlice
> = (set, get) => ({
  ...defaultCustomVariantsState,

  addCustomVariant: (def) => {
    validateVariantId(def.id);
    try {
      const plugin = compileCustomVariant(def);
      registerParserVariantPlugin(plugin);
      set((draft) => {
        const existingIdx = draft.customVariants.findIndex((v) =>
          v.id === def.id
        );
        if (existingIdx >= 0) {
          draft.customVariants[existingIdx] = def;
        } else {
          draft.customVariants.push(def);
        }
      });
    } catch (err) {
      console.error("Failed to register custom variant:", err);
      throw err;
    }
  },

  updateCustomVariant: (id, patch) => {
    const state = get();
    const current = state.customVariants.find((v) => v.id === id);
    if (!current) return;
    const updated: CustomVariantDefinition = { ...current, ...patch, id };
    try {
      const plugin = compileCustomVariant(updated);
      registerParserVariantPlugin(plugin);
      set((draft) => {
        const idx = draft.customVariants.findIndex((v) => v.id === id);
        if (idx >= 0) {
          draft.customVariants[idx] = updated;
        }
      });
    } catch (err) {
      console.error("Failed to update custom variant:", err);
      throw err;
    }
  },

  removeCustomVariant: (id) => {
    unregisterParserVariantPlugin(id);
    set((draft) => {
      draft.customVariants = draft.customVariants.filter((v) => v.id !== id);
      if (draft.selectedVariant === id) {
        draft.selectedVariant = "auto";
      }
    });
  },

  exportCustomVariant: (id) => {
    const current = get().customVariants.find((v) => v.id === id);
    if (!current) {
      throw new Error(`Variant "${id}" not found.`);
    }
    return JSON.stringify(current, null, 2);
  },

  importCustomVariant: (jsonStr) => {
    if (!jsonStr || jsonStr.length > 262144) {
      return {
        success: false,
        error: "Invalid file: payload must be non-empty and under 256KB.",
      };
    }
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { success: false, error: "Invalid JSON object." };
      }
      const validation = customVariantDefinitionSchema.safeParse(parsed);
      if (!validation.success) {
        const firstIssue = validation.error.issues[0];
        const path = firstIssue?.path.join(".") || "definition";
        return {
          success: false,
          error: `Validation error at ${path}: ${
            firstIssue?.message ?? "invalid structure"
          }`,
        };
      }
      const validDef = validation.data as CustomVariantDefinition;
      validateVariantId(validDef.id);
      const plugin = compileCustomVariant(validDef);
      registerParserVariantPlugin(plugin);
      set((draft) => {
        const idx = draft.customVariants.findIndex((v) => v.id === validDef.id);
        if (idx >= 0) {
          draft.customVariants[idx] = validDef;
        } else {
          draft.customVariants.push(validDef);
        }
      });
      return { success: true, id: validDef.id };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
});
