import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import {
  RENPY_TL_PATH_REGEX,
  scanTranslations,
} from "../../src/parser/translationScanner.ts";

describe("Translation & Multi-Language Support", () => {
  it("matches Ren'Py translation file path patterns", () => {
    expect(RENPY_TL_PATH_REGEX.test("game/tl/spanish/script.rpy")).toBe(true);
    expect(RENPY_TL_PATH_REGEX.test("tl/japanese/screens.rpy")).toBe(true);
    expect(RENPY_TL_PATH_REGEX.test("game/script.rpy")).toBe(false);
  });

  it("extracts strings and dialogue block translations", () => {
    const spanishTl = `
translate spanish strings:
    old "Start Game"
    new "Iniciar Juego"
    old "Options"
    new "Opciones"

translate spanish start_a1b2c3d4:
    e "¡Bienvenido a nuestro juego!"
`;

    const projectTrans = scanTranslations([
      {
        name: "script.rpy",
        relativePath: "game/tl/spanish/script.rpy",
        content: spanishTl,
      },
    ]);

    expect(projectTrans.availableLanguages).toEqual(["spanish"]);
    const spanish = projectTrans.translationsByLanguage["spanish"];
    expect(spanish).toBeDefined();
    expect(spanish.strings["Start Game"]).toBe("Iniciar Juego");
    expect(spanish.strings["Options"]).toBe("Opciones");
    expect(spanish.dialogueByNodeId["start_a1b2c3d4"]).toEqual([
      "¡Bienvenido a nuestro juego!",
    ]);
    expect(spanish.dialogueByLabel?.["start"]).toEqual([
      "¡Bienvenido a nuestro juego!",
    ]);
  });

  it("partitions translation files away from story files in parseRenpyFiles", async () => {
    const mainScript = `
label start:
    "Welcome to the game!"
    menu:
        "Start Game":
            jump prologue
        "Options":
            jump options

label prologue:
    "Prologue begins."
    return

label options:
    "Settings."
    return
`;

    const spanishTl = `
translate spanish strings:
    old "Start Game"
    new "Iniciar Juego"

translate spanish start_12345678:
    "¡Bienvenido al juego!"
`;

    const result = await parseRenpyFiles([
      {
        name: "script.rpy",
        relativePath: "game/script.rpy",
        content: mainScript,
      },
      {
        name: "script.rpy",
        relativePath: "game/tl/spanish/script.rpy",
        content: spanishTl,
      },
    ]);

    // Story nodes should not include duplicates from translation files
    expect(result.nodes.filter((n) => n.id === "start").length).toBe(1);
    expect(result.translations).toBeDefined();
    expect(result.availableLanguages).toEqual(["spanish"]);
    expect(
      result.translations?.translationsByLanguage["spanish"]
        .strings["Start Game"],
    ).toBe("Iniciar Juego");
  });

  it("handles multi-line triple-quoted strings and filters non-dialogue statements", () => {
    const spanishTl = `
translate spanish strings:
    old """Multi-line
old string"""
    new """Cadena
antigua multilinea"""

translate spanish scene1_1a2b3c4d:
    voice "voice/es/01.ogg"
    play music "bgm/spanish.ogg"
    $ points += 1
    e """Esta es una línea
de diálogo multilinea."""
`;

    const projectTrans = scanTranslations([
      {
        name: "script.rpy",
        relativePath: "game/tl/spanish/script.rpy",
        content: spanishTl,
      },
    ]);

    const spanish = projectTrans.translationsByLanguage["spanish"];
    expect(spanish).toBeDefined();
    expect(spanish.strings["Multi-line\nold string"]).toBe(
      "Cadena\nantigua multilinea",
    );
    // Should contain the dialogue line and NOT the voice/play/$ statements
    expect(spanish.dialogueByNodeId["scene1_1a2b3c4d"]).toHaveLength(1);
    expect(spanish.dialogueByNodeId["scene1_1a2b3c4d"]![0]).toContain(
      "Esta es una línea\nde diálogo multilinea.",
    );
  });

  it("accurately parses single-quoted translation dialogue containing double quotes", () => {
    const spanishTl = `
translate spanish test_quotes_1234abcd:
    e 'She said "hello" to me.'
`;

    const projectTrans = scanTranslations([
      {
        name: "script.rpy",
        relativePath: "game/tl/spanish/script.rpy",
        content: spanishTl,
      },
    ]);

    const spanish = projectTrans.translationsByLanguage["spanish"];
    expect(spanish).toBeDefined();
    expect(spanish.dialogueByNodeId["test_quotes_1234abcd"]).toEqual([
      'She said "hello" to me.',
    ]);
  });

  describe("Branch and Edge Case Coverage for translationScanner", () => {
    it("handles escape sequences, unclosed quotes, triple single-quotes, and comments", () => {
      const complexTl = `
translate french strings:
    old '''Triple single
old string'''
    new '''Triple single
new string'''
    old "Escaped \\n \\t \\r \\" \\' \\\\ \\z string"
    new "Translated \\n \\t \\r \\" \\' \\\\ \\z string"
    old # no quote here
    new "Ignored new without old"

translate french start_12345678:
    # This is a comment
    
    stop music
    queue sound "sound.ogg"
    scene bg room
    show eileen
    hide eileen
    with dissolve
    window show
    nvl clear
    python:
        x = 1
    unquoted_non_dialogue_statement
    "Multi-line line with backslash \\
and quote" # with comment
    'Line with internal "quotes"'

translate french start_12345678:
    "Second dialogue block with same base label to test existing dialogueByLabel array"

translate french custom_raw_id_no_hash:
    "Dialogue for non-hashed block"

unindented_boundary:
    "Should break previous translation block"
`;

      const uint8Content = new TextEncoder().encode(complexTl);

      const projectTrans = scanTranslations([
        // Test Uint8Array content & name fallback when relativePath is omitted
        {
          name: "tl/french/dialogue.rpy",
          content: uint8Content,
        },
        // Non-translation file skipped
        {
          name: "game/script.rpy",
          content: "label start:\n    return\n",
        },
      ]);

      expect(projectTrans.availableLanguages).toContain("french");
      const french = projectTrans.translationsByLanguage["french"]!;
      expect(french.strings["Triple single\nold string"]).toBe(
        "Triple single\nnew string",
      );
      expect(french.strings["Escaped \n \t \r \" ' \\ z string"]).toBe(
        "Translated \n \t \r \" ' \\ z string",
      );
      expect(french.dialogueByLabel?.["start"]?.length).toBeGreaterThanOrEqual(
        2,
      );
      expect(french.dialogueByNodeId["custom_raw_id_no_hash"]).toEqual([
        "Dialogue for non-hashed block",
      ]);
    });
  });
});
