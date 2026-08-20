import {
  CharacterTokenType,
  EntityTokenType,
  KeywordTokenType,
  LiteralTokenType,
  MetaTokenType,
} from "@renpy/ast/out/tokenizer/renpy-tokens.js";

export interface ParserTokenMap {
  kwLabel: number;
  kwScene?: number;
  kwJump: number;
  kwExpression?: number;
  kwCall: number;
  kwReturn: number;
  kwConditional: number;
  kwMenuObserved: number;
  kwMenuFallback?: number;
  menuKeywordTypes: number[];
  entityFunctionName: number;
  entityIdentifier?: number;
  literalString: number;
  metaLabelStatement: number;
  metaMenuStatement: number;
  metaMenuBlock: number;
  metaMenuOption: number;
  metaMenuOptionBlock: number;
  metaJumpStatement: number;
  metaCallStatement: number;
  metaPythonBlock?: number;
  metaScreenBlock?: number;
  metaSayNarrator: number;
  metaSayCharacter: number;
  metaSayStatement: number;
  charWhitespace: number;
  charNewline: number;
  kwPlay?: number;
  kwVoice?: number;
  kwStop?: number;
  kwQueue?: number;
  kwOther?: number;
  kwDollarSign?: number;
  kwScreen?: number;
  kwShow?: number;
  kwHide?: number;
  metaItemAccess?: number;
  metaFunctionCall?: number;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function assertEnumEntry(
  enumName: string,
  valueName: string,
  value: unknown,
): number {
  if (!isNumber(value)) {
    throw new Error(
      `[parser] Unsupported @renpy/ast tokenizer shape: ${enumName}.${valueName} is missing or non-numeric.`,
    );
  }
  return value;
}

function readOptionalEnumEntry(value: unknown): number | undefined {
  return isNumber(value) ? value : undefined;
}

function assertEnumReverseLookup(
  enumName: string,
  numericValue: number,
  expectedName: string,
): void {
  if (KeywordTokenType[numericValue] !== expectedName) {
    throw new Error(
      `[parser] Unsupported @renpy/ast tokenizer shape: expected ${enumName}.${expectedName} reverse lookup for token ${numericValue}.`,
    );
  }
}

function readMenuKeywordTypes(): {
  kwMenuObserved: number;
  kwMenuFallback?: number;
  menuKeywordTypes: number[];
} {
  const defValue = readOptionalEnumEntry(KeywordTokenType.Def);
  const menuValue = readOptionalEnumEntry(KeywordTokenType.Menu);

  if (defValue !== undefined) {
    assertEnumReverseLookup("KeywordTokenType", defValue, "Def");
  }
  if (menuValue !== undefined) {
    assertEnumReverseLookup("KeywordTokenType", menuValue, "Menu");
  }
  if (defValue === undefined && menuValue === undefined) {
    throw new Error(
      "[parser] Unsupported @renpy/ast tokenizer shape: expected KeywordTokenType.Def or KeywordTokenType.Menu to be numeric.",
    );
  }

  const primary = defValue ?? menuValue!;
  const fallback =
    defValue !== undefined && menuValue !== undefined && menuValue !== primary
      ? menuValue
      : undefined;
  const menuKeywordTypes = Array.from(
    new Set([primary, fallback].filter(isNumber)),
  );

  return {
    kwMenuObserved: primary,
    kwMenuFallback: fallback,
    menuKeywordTypes,
  };
}

function buildTokenMap(): ParserTokenMap {
  const menuKeywords = readMenuKeywordTypes();
  return {
    kwLabel: assertEnumEntry(
      "KeywordTokenType",
      "Label",
      KeywordTokenType.Label,
    ),
    kwScene: readOptionalEnumEntry(KeywordTokenType.Scene),
    kwJump: assertEnumEntry("KeywordTokenType", "Jump", KeywordTokenType.Jump),
    kwExpression: readOptionalEnumEntry(KeywordTokenType.Expression),
    kwCall: assertEnumEntry("KeywordTokenType", "Call", KeywordTokenType.Call),
    kwReturn: assertEnumEntry(
      "KeywordTokenType",
      "Return",
      KeywordTokenType.Return,
    ),
    kwConditional: assertEnumEntry(
      "MetaTokenType",
      "ControlFlowKeyword",
      MetaTokenType.ControlFlowKeyword,
    ),
    ...menuKeywords,
    entityFunctionName: assertEnumEntry(
      "EntityTokenType",
      "FunctionName",
      EntityTokenType.FunctionName,
    ),
    entityIdentifier: readOptionalEnumEntry(EntityTokenType.Identifier),
    literalString: assertEnumEntry(
      "LiteralTokenType",
      "String",
      LiteralTokenType.String,
    ),
    metaLabelStatement: assertEnumEntry(
      "MetaTokenType",
      "LabelStatement",
      MetaTokenType.LabelStatement,
    ),
    metaMenuStatement: assertEnumEntry(
      "MetaTokenType",
      "MenuStatement",
      MetaTokenType.MenuStatement,
    ),
    metaMenuBlock: assertEnumEntry(
      "MetaTokenType",
      "MenuBlock",
      MetaTokenType.MenuBlock,
    ),
    metaMenuOption: assertEnumEntry(
      "MetaTokenType",
      "MenuOption",
      MetaTokenType.MenuOption,
    ),
    metaMenuOptionBlock: assertEnumEntry(
      "MetaTokenType",
      "MenuOptionBlock",
      MetaTokenType.MenuOptionBlock,
    ),
    metaJumpStatement: assertEnumEntry(
      "MetaTokenType",
      "JumpStatement",
      MetaTokenType.JumpStatement,
    ),
    metaCallStatement: assertEnumEntry(
      "MetaTokenType",
      "CallStatement",
      MetaTokenType.CallStatement,
    ),
    metaPythonBlock: readOptionalEnumEntry(MetaTokenType.PythonBlock),
    metaScreenBlock: readOptionalEnumEntry(MetaTokenType.ScreenBlock),
    metaSayNarrator: assertEnumEntry(
      "MetaTokenType",
      "SayNarrator",
      MetaTokenType.SayNarrator,
    ),
    metaSayCharacter: assertEnumEntry(
      "MetaTokenType",
      "SayCharacter",
      MetaTokenType.SayCharacter,
    ),
    metaSayStatement: assertEnumEntry(
      "MetaTokenType",
      "SayStatement",
      MetaTokenType.SayStatement,
    ),
    charWhitespace: assertEnumEntry(
      "CharacterTokenType",
      "Whitespace",
      CharacterTokenType.Whitespace,
    ),
    charNewline: assertEnumEntry(
      "CharacterTokenType",
      "NewLine",
      CharacterTokenType.NewLine,
    ),
    kwPlay: readOptionalEnumEntry(KeywordTokenType.Play),
    kwVoice: readOptionalEnumEntry(KeywordTokenType.Voice),
    kwStop: readOptionalEnumEntry(KeywordTokenType.Stop),
    kwQueue: readOptionalEnumEntry(KeywordTokenType.Queue),
    kwOther: readOptionalEnumEntry(KeywordTokenType.Other),
    kwDollarSign: readOptionalEnumEntry(KeywordTokenType.DollarSign),
    kwScreen: readOptionalEnumEntry(KeywordTokenType.Screen),
    kwShow: readOptionalEnumEntry(KeywordTokenType.Show),
    kwHide: readOptionalEnumEntry(KeywordTokenType.Hide),
    metaItemAccess: readOptionalEnumEntry(MetaTokenType.ItemAccess),
    metaFunctionCall: readOptionalEnumEntry(MetaTokenType.FunctionCall),
  };
}

export const PARSER_TOKENS = buildTokenMap();

const menuKeywordTypesSet = new Set(PARSER_TOKENS.menuKeywordTypes);

export function isMenuKeywordTokenType(type: number): boolean {
  return menuKeywordTypesSet.has(type);
}
