import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type EnumShape = Record<string, number> & Record<number, string>;

function makeEnum(entries: Array<[string, number]>): EnumShape {
  const out: Record<string | number, string | number> = {};
  for (const [name, value] of entries) {
    out[name] = value;
    out[value] = name;
  }
  return out as EnumShape;
}

const keywordEnum = makeEnum([
  ["Label", 1],
  ["Jump", 2],
  ["Call", 3],
  ["Return", 4],
  ["Def", 5],
  ["Menu", 6],
]);
const entityEnum = makeEnum([["FunctionName", 11]]);
const literalEnum = makeEnum([["String", 12]]);
const metaEnum = makeEnum([
  ["ControlFlowKeyword", 21],
  ["LabelStatement", 22],
  ["MenuStatement", 23],
  ["MenuBlock", 24],
  ["MenuOption", 25],
  ["MenuOptionBlock", 26],
  ["JumpStatement", 27],
  ["CallStatement", 28],
  ["SayNarrator", 29],
  ["SayCharacter", 30],
  ["SayStatement", 31],
]);
const characterEnum = makeEnum([
  ["Whitespace", 41],
  ["NewLine", 42],
]);

const modulePath = "../../src/parser/parserTokens";

describe("parserTokens runtime guards", () => {
  beforeEach(() => {
    vi.resetModules();
    keywordEnum.Label = 1;
    keywordEnum[1] = "Label";
    keywordEnum.Jump = 2;
    keywordEnum[2] = "Jump";
    keywordEnum.Call = 3;
    keywordEnum[3] = "Call";
    keywordEnum.Return = 4;
    keywordEnum[4] = "Return";
    keywordEnum.Menu = 6;
    keywordEnum[6] = "Menu";
    keywordEnum.Def = 5;
    keywordEnum[5] = "Def";

    vi.doMock("@renpy/ast/out/tokenizer/renpy-tokens", () => ({
      CharacterTokenType: characterEnum,
      EntityTokenType: entityEnum,
      KeywordTokenType: keywordEnum,
      LiteralTokenType: literalEnum,
      MetaTokenType: metaEnum,
    }));

    vi.doMock("@renpy/ast/out/tokenizer/renpy-tokens.js", () => ({
      CharacterTokenType: characterEnum,
      EntityTokenType: entityEnum,
      KeywordTokenType: keywordEnum,
      LiteralTokenType: literalEnum,
      MetaTokenType: metaEnum,
    }));
  });

  afterAll(() => {
    vi.doUnmock("@renpy/ast/out/tokenizer/renpy-tokens");
    vi.doUnmock("@renpy/ast/out/tokenizer/renpy-tokens.js");
    vi.resetModules();
  });

  it("builds parser token map with expected values", async () => {
    const { PARSER_TOKENS } = await import(modulePath);

    expect(PARSER_TOKENS.kwLabel).toBe(1);
    expect(PARSER_TOKENS.kwMenuObserved).toBe(5);
    expect(PARSER_TOKENS.kwMenuFallback).toBe(6);
    expect(PARSER_TOKENS.menuKeywordTypes).toEqual([5, 6]);
    expect(PARSER_TOKENS.metaMenuStatement).toBe(23);
    expect(PARSER_TOKENS.charNewline).toBe(42);
  });

  it("throws when a required enum entry is missing or non-numeric", async () => {
    keywordEnum.Label = undefined as unknown as number;

    await expect(import(modulePath)).rejects.toThrow(
      "KeywordTokenType.Label is missing or non-numeric",
    );
  });

  it("accepts tokenizer builds that surface menu as KeywordTokenType.Menu when Def is unavailable", async () => {
    delete keywordEnum.Def;
    delete keywordEnum[5];

    const { PARSER_TOKENS } = await import(modulePath);

    expect(PARSER_TOKENS.kwMenuObserved).toBe(6);
    expect(PARSER_TOKENS.kwMenuFallback).toBeUndefined();
    expect(PARSER_TOKENS.menuKeywordTypes).toEqual([6]);
  });

  it("throws when a menu keyword reverse lookup is unsupported", async () => {
    keywordEnum[6] = "NotMenu";

    await expect(import(modulePath)).rejects.toThrow(
      "expected KeywordTokenType.Menu reverse lookup",
    );
  });

  it("throws when Def reverse lookup is unsupported", async () => {
    keywordEnum[5] = "NotDef";

    await expect(import(modulePath)).rejects.toThrow(
      "expected KeywordTokenType.Def reverse lookup",
    );
  });

  it("throws when no supported menu keyword token is available", async () => {
    delete keywordEnum.Def;
    delete keywordEnum[5];
    delete keywordEnum.Menu;
    delete keywordEnum[6];

    await expect(import(modulePath)).rejects.toThrow(
      "expected KeywordTokenType.Def or KeywordTokenType.Menu to be numeric",
    );
  });
});
