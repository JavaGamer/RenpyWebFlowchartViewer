import {
  CharacterTokenType,
  EntityTokenType,
  KeywordTokenType,
  LiteralTokenType,
  MetaTokenType,
} from '@renpy/ast/out/tokenizer/renpy-tokens';

export interface ParserTokenMap {
  kwLabel: number;
  kwJump: number;
  kwCall: number;
  kwReturn: number;
  kwConditional: number;
  kwMenuObserved: number;
  entityFunctionName: number;
  literalString: number;
  metaLabelStatement: number;
  metaMenuStatement: number;
  metaMenuBlock: number;
  metaMenuOption: number;
  metaMenuOptionBlock: number;
  metaJumpStatement: number;
  metaCallStatement: number;
  metaSayNarrator: number;
  metaSayCharacter: number;
  metaSayStatement: number;
  charWhitespace: number;
  charNewline: number;
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
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

function buildTokenMap(): ParserTokenMap {
  const map: ParserTokenMap = {
    kwLabel: assertEnumEntry('KeywordTokenType', 'Label', KeywordTokenType.Label),
    kwJump: assertEnumEntry('KeywordTokenType', 'Jump', KeywordTokenType.Jump),
    kwCall: assertEnumEntry('KeywordTokenType', 'Call', KeywordTokenType.Call),
    kwReturn: assertEnumEntry('KeywordTokenType', 'Return', KeywordTokenType.Return),
    kwConditional: assertEnumEntry(
      'MetaTokenType',
      'ControlFlowKeyword',
      MetaTokenType.ControlFlowKeyword,
    ),
    // Current tokenizer quirk: `menu` appears as KeywordTokenType.Def in menu statements.
    kwMenuObserved: assertEnumEntry('KeywordTokenType', 'Def', KeywordTokenType.Def),
    entityFunctionName: assertEnumEntry(
      'EntityTokenType',
      'FunctionName',
      EntityTokenType.FunctionName,
    ),
    literalString: assertEnumEntry('LiteralTokenType', 'String', LiteralTokenType.String),
    metaLabelStatement: assertEnumEntry(
      'MetaTokenType',
      'LabelStatement',
      MetaTokenType.LabelStatement,
    ),
    metaMenuStatement: assertEnumEntry(
      'MetaTokenType',
      'MenuStatement',
      MetaTokenType.MenuStatement,
    ),
    metaMenuBlock: assertEnumEntry('MetaTokenType', 'MenuBlock', MetaTokenType.MenuBlock),
    metaMenuOption: assertEnumEntry('MetaTokenType', 'MenuOption', MetaTokenType.MenuOption),
    metaMenuOptionBlock: assertEnumEntry(
      'MetaTokenType',
      'MenuOptionBlock',
      MetaTokenType.MenuOptionBlock,
    ),
    metaJumpStatement: assertEnumEntry(
      'MetaTokenType',
      'JumpStatement',
      MetaTokenType.JumpStatement,
    ),
    metaCallStatement: assertEnumEntry(
      'MetaTokenType',
      'CallStatement',
      MetaTokenType.CallStatement,
    ),
    metaSayNarrator: assertEnumEntry(
      'MetaTokenType',
      'SayNarrator',
      MetaTokenType.SayNarrator,
    ),
    metaSayCharacter: assertEnumEntry(
      'MetaTokenType',
      'SayCharacter',
      MetaTokenType.SayCharacter,
    ),
    metaSayStatement: assertEnumEntry(
      'MetaTokenType',
      'SayStatement',
      MetaTokenType.SayStatement,
    ),
    charWhitespace: assertEnumEntry(
      'CharacterTokenType',
      'Whitespace',
      CharacterTokenType.Whitespace,
    ),
    charNewline: assertEnumEntry('CharacterTokenType', 'NewLine', CharacterTokenType.NewLine),
  };

  if (map.kwMenuObserved !== map.kwLabel + 73) {
    throw new Error(
      '[parser] Unexpected @renpy/ast menu tokenization behavior; expected menu keyword quirk to map to KeywordTokenType.Def.',
    );
  }

  return map;
}

export const PARSER_TOKENS = buildTokenMap();
