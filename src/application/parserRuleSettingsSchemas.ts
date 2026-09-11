import { z } from "zod";
import {
  type CustomVariantDefinition,
  DEFAULT_PARSER_VARIANT,
  RESERVED_VARIANT_IDS,
  type ScreenActionRule,
} from "../config/parserRules.ts";

export const screenActionRuleSchema = z.object({
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

export const rulesArraySchema = z
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

export const choiceDirectiveSchema = z.object({
  pattern: z.string().min(1).max(300),
  targetGroup: z.number().int().min(1).max(9),
  captionGroup: z.number().int().min(1).max(9).optional(),
  durationGroup: z.number().int().min(1).max(9).optional(),
  isTimeout: z.boolean().optional(),
});

export const variableMutationSchema = z.object({
  pattern: z.string().min(1).max(300),
  variableGroup: z.number().int().min(0).max(9).optional(),
  valueGroup: z.number().int().min(1).max(9).optional(),
  operator: z.enum(["=", "+=", "-=", "*=", "/=", "%=", "//="]).optional(),
  constantValue: z.union([z.string(), z.boolean(), z.number(), z.null()])
    .optional(),
  variableName: z.string().max(64).optional(),
});

export const endingRuleSchema = z.object({
  pattern: z.string().min(1).max(300),
  endingType: z.enum(["good", "bad", "true", "normal", "dead_end", "custom"]),
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
  choiceDirectives: z.array(choiceDirectiveSchema).optional(),
  variableMutations: z.array(variableMutationSchema).optional(),
  endingRules: z.array(endingRuleSchema).optional(),
  utilityLabelPatterns: z.array(z.string().max(300)).optional(),
  detectionFilePatterns: z.array(z.string().max(300)).optional(),
});

export const customVariantsArraySchema = z
  .array(z.unknown())
  .transform((arr) =>
    arr.flatMap((item) => {
      const result = customVariantDefinitionSchema.safeParse(item);
      return result.success ? [result.data as CustomVariantDefinition] : [];
    })
  )
  .catch([]);

export const parserRuleSettingsSchema = z.object({
  selectedVariant: z
    .string()
    .catch(DEFAULT_PARSER_VARIANT),
  customRulesByVariant: z
    .record(z.string(), rulesArraySchema)
    .catch({}),
  customVariants: customVariantsArraySchema,
});
