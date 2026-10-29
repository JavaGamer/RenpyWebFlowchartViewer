import { describe, expect, it } from "vitest";
import { tokenizeRenpy } from "../../../src/parser/ast/lexer.ts";

describe("RenpyLexer", () => {
  it("emits INDENT, DEDENT, and NEWLINE tokens for standard indented blocks", () => {
    const script = [
      "label start:",
      '    "Hello world"',
      "    if flag:",
      '        "Flag is true"',
      "    return",
    ].join("\n");

    const tokens = tokenizeRenpy(script);
    const types = tokens.map((t) => t.type);

    expect(types).toEqual([
      "LABEL",
      "IDENTIFIER",
      "COLON",
      "NEWLINE",
      "INDENT",
      "STRING",
      "NEWLINE",
      "IF",
      "IDENTIFIER",
      "COLON",
      "NEWLINE",
      "INDENT",
      "STRING",
      "NEWLINE",
      "DEDENT",
      "RETURN",
      "NEWLINE",
      "DEDENT",
      "EOF",
    ]);
  });

  it("handles blank lines and comments as pure trivia without disrupting indentation", () => {
    const script = [
      "# Header comment",
      "label start:",
      "",
      "    # Comment inside block",
      '    "First line"',
      "",
      '    "Second line" # trailing comment',
      "",
      "label end:",
      "    return",
    ].join("\n");

    const tokens = tokenizeRenpy(script);
    const labels = tokens.filter((t) => t.type === "LABEL");
    expect(labels).toHaveLength(2);

    const strings = tokens.filter((t) => t.type === "STRING");
    expect(strings.map((t) => t.value)).toEqual(["First line", "Second line"]);
  });

  it("suppresses newlines within parentheses and brackets", () => {
    const script = [
      "init python:",
      "    items = [",
      '        "apple",',
      '        "banana",',
      "    ]",
      "    x = 1",
    ].join("\n");

    const tokens = tokenizeRenpy(script);
    // Inside the bracket, items should not trigger INDENT or NEWLINE on each item
    const bracketOpens = tokens.filter((t) => t.type === "LBRACKET");
    const bracketCloses = tokens.filter((t) => t.type === "RBRACKET");
    expect(bracketOpens).toHaveLength(1);
    expect(bracketCloses).toHaveLength(1);

    const strings = tokens.filter((t) => t.type === "STRING");
    expect(strings.map((t) => t.value)).toEqual(["apple", "banana"]);
  });

  it("captures one-line python statements starting with $", () => {
    const script = [
      "label start:",
      '    $ renpy.jump("target_scene")',
      "    $ score += 10",
      "    return",
    ].join("\n");

    const tokens = tokenizeRenpy(script);
    const dollars = tokens.filter((t) => t.type === "DOLLAR");
    expect(dollars).toHaveLength(2);

    const rawPython = tokens.filter((t) => t.type === "RAW_TEXT");
    expect(rawPython.map((t) => t.value)).toEqual([
      'renpy.jump("target_scene")',
      "score += 10",
    ]);
  });

  it("tokenizes local labels starting with .", () => {
    const script = [
      "label start:",
      "    jump .local_choice",
      "",
      "label .local_choice:",
      '    "In local choice"',
      "    return",
    ].join("\n");

    const tokens = tokenizeRenpy(script);
    const identifiers = tokens.filter((t) => t.type === "IDENTIFIER");
    expect(identifiers.map((t) => t.value)).toContain(".local_choice");
  });

  it("handles triple-quoted multiline strings", () => {
    const script = [
      "label start:",
      '    """This is a',
      "    multiline dialogue",
      '    block."""',
      "    return",
    ].join("\n");

    const tokens = tokenizeRenpy(script);
    const strToken = tokens.find((t) => t.type === "STRING");
    expect(strToken).toBeDefined();
    expect(strToken!.value).toContain("multiline dialogue");
  });
});
