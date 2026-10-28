export type ParserVariant = string;
export type ScreenActionKind =
  | "jump"
  | "call"
  | "show"
  | "hide"
  | "set_variable"
  | "toggle_variable"
  | "confirm"
  | "null_action"
  | "show_menu";

export interface ScreenActionRule {
  actionName: string;
  actionKind: ScreenActionKind;
}

export interface TerminalStatementRule {
  pattern: RegExp;
  isTerminalOutcome?: boolean;
  labelHasExplicitExit?: boolean;
}

export interface SerializableTerminalStatementRule {
  pattern: string;
  isTerminalOutcome?: boolean;
  labelHasExplicitExit?: boolean;
}

export interface BranchStatementRule {
  pattern: RegExp;
  branchKind: "jump" | "call";
  targetGroup?: number;
  suppressFallthrough?: boolean;
}

export interface SerializableBranchStatementRule {
  pattern: string;
  branchKind: "jump" | "call";
  targetGroup?: number;
  suppressFallthrough?: boolean;
}

export type EndingType =
  | "good"
  | "bad"
  | "true"
  | "normal"
  | "dead_end"
  | "custom";

export type VariableValue = string | boolean | number | null;

export type MutationOperator =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "//=";

export interface ChoiceDirectiveRule {
  pattern: RegExp;
  targetGroup: number;
  captionGroup?: number;
  durationGroup?: number;
  isTimeout?: boolean;
}

export interface SerializableChoiceDirectiveRule {
  pattern: string;
  targetGroup: number;
  captionGroup?: number;
  durationGroup?: number;
  isTimeout?: boolean;
}

export interface VariableMutationRule {
  pattern: RegExp;
  variableGroup?: number;
  valueGroup?: number;
  operator?: MutationOperator;
  constantValue?: VariableValue;
  variableName?: string;
}

export interface SerializableVariableMutationRule {
  pattern: string;
  variableGroup?: number;
  valueGroup?: number;
  operator?: MutationOperator;
  constantValue?: VariableValue;
  variableName?: string;
}

export interface EndingClassificationRule {
  pattern: RegExp;
  endingType: EndingType;
}

export interface SerializableEndingClassificationRule {
  pattern: string;
  endingType: EndingType;
}

export interface ParserVariantPlugin {
  id: string;
  label: string;
  description?: string;
  isCustom?: boolean;
  baseVariant?: string;
  defaultScreenActionRules: ScreenActionRule[];
  stagingKeywords?: readonly string[];
  stagingRegex?: RegExp;
  terminalStatements?: readonly TerminalStatementRule[];
  branchStatements?: readonly BranchStatementRule[];
  choiceDirectives?: readonly ChoiceDirectiveRule[];
  variableMutations?: readonly VariableMutationRule[];
  endingRules?: readonly EndingClassificationRule[];
  utilityLabelPatterns?: readonly RegExp[];
  detectionSignatures?: readonly RegExp[];
  detectionFilePatterns?: readonly RegExp[];
  normalizeCustomRule?: (rule: ScreenActionRule) => ScreenActionRule | null;
}

export interface SerializableParserVariantPlugin {
  id: string;
  label: string;
  description?: string;
  isCustom?: boolean;
  baseVariant?: string;
  defaultScreenActionRules: ScreenActionRule[];
  stagingKeywords?: string[];
  stagingRegex?: string;
  terminalStatements?: SerializableTerminalStatementRule[];
  branchStatements?: SerializableBranchStatementRule[];
  choiceDirectives?: SerializableChoiceDirectiveRule[];
  variableMutations?: SerializableVariableMutationRule[];
  endingRules?: SerializableEndingClassificationRule[];
  utilityLabelPatterns?: string[];
  detectionSignatures?: string[];
  detectionFilePatterns?: string[];
}

export interface CustomVariantDefinition {
  id: string;
  label: string;
  description?: string;
  baseVariant?: string;
  screenActionRules?: ScreenActionRule[];
  stagingKeywords?: string[];
  terminalPatterns?: string[];
  detectionPatterns?: string[];
  branchStatements?: SerializableBranchStatementRule[];
  choiceDirectives?: SerializableChoiceDirectiveRule[];
  variableMutations?: SerializableVariableMutationRule[];
  endingRules?: SerializableEndingClassificationRule[];
  utilityLabelPatterns?: string[];
  detectionFilePatterns?: string[];
}

export const RESERVED_VARIANT_IDS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "tostring",
  "valueof",
  "auto",
  "renpy",
  "renpy8",
  "st",
  "ddlc",
  "mas",
  "renpy7",
  "nvl",
]);
