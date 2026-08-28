import {
  type LanguageTranslationData,
  type ProjectTranslations,
  unquoteString,
} from "../domain/index.ts";
import type { ParseInputFile } from "./pipelineTypes.ts";

/**
 * Regex matching Ren'Py translation file paths.
 * Captures language name in group 1, and the relative subpath in group 2.
 * Examples:
 *   game/tl/spanish/script.rpy -> ["spanish", "script.rpy"]
 *   tl/japanese/screens.rpy   -> ["japanese", "screens.rpy"]
 */
export const RENPY_TL_PATH_REGEX =
  /(?:^|[/\\])(?:game[/\\])?tl[/\\]([^/\\]+)[/\\](.*\.rpy)$/i;

/**
 * Extracts a quoted Ren'Py string (single, double, or triple-quoted) starting at startIndex.
 */
function extractQuotedString(
  text: string,
  startIndex: number,
): { value: string; endIndex: number } | null {
  const i = startIndex;
  if (i >= text.length) return null;

  if (text.startsWith('"""', i)) {
    const end = text.indexOf('"""', i + 3);
    if (end === -1) return null;
    return {
      value: unquoteString(text.slice(i, end + 3)),
      endIndex: end + 3,
    };
  }
  if (text.startsWith("'''", i)) {
    const end = text.indexOf("'''", i + 3);
    if (end === -1) return null;
    return {
      value: unquoteString(text.slice(i, end + 3)),
      endIndex: end + 3,
    };
  }

  const quote = text[i];
  if (quote !== '"' && quote !== "'") return null;

  let str = "";
  let cursor = i + 1;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === "\\") {
      cursor++;
      if (cursor < text.length) {
        const next = text[cursor];
        if (next === "n") str += "\n";
        else if (next === "t") str += "\t";
        else if (next === "r") str += "\r";
        else if (next === '"') str += '"';
        else if (next === "'") str += "'";
        else if (next === "\\") str += "\\";
        else str += next;
        cursor++;
      }
    } else if (ch === quote) {
      cursor++;
      return { value: str, endIndex: cursor };
    } else {
      str += ch;
      cursor++;
    }
  }

  return null;
}

/**
 * Parses an individual translation file content and merges the findings into LanguageTranslationData.
 */
export function parseTranslationFileContent(
  content: string,
  language: string,
  data: LanguageTranslationData,
): void {
  const lines = content.split(/\r?\n/);
  let currentBlockType: "none" | "strings" | "dialogue" = "none";
  let currentDialogueId: string | null = null;
  let currentDialogueLines: string[] = [];
  let pendingOldString: string | null = null;

  function flushDialogueBlock() {
    if (currentDialogueId && currentDialogueLines.length > 0) {
      data.dialogueByNodeId[currentDialogueId] = [...currentDialogueLines];

      // Strip 8-hex hash suffix (e.g. "start_a1b2c3d4" -> "start") to also map to canonical label
      const baseLabelMatch = /^([A-Za-z0-9_]+)_[0-9a-fA-F]{8}$/.exec(
        currentDialogueId,
      );
      if (baseLabelMatch) {
        const baseLabel = baseLabelMatch[1]!;
        if (!data.dialogueByLabel) data.dialogueByLabel = {};
        if (!data.dialogueByLabel[baseLabel]) {
          data.dialogueByLabel[baseLabel] = [];
        }
        data.dialogueByLabel[baseLabel].push(...currentDialogueLines);
      }
    }
    currentDialogueId = null;
    currentDialogueLines = [];
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const trimmed = rawLine.trim();

    // Check for translation header: translate <language> strings:
    const stringsHeaderMatch = new RegExp(
      `^translate\\s+${language}\\s+strings\\s*:`,
      "i",
    ).exec(trimmed);
    if (stringsHeaderMatch) {
      flushDialogueBlock();
      currentBlockType = "strings";
      continue;
    }

    // Check for dialogue block: translate <language> <id_or_label>:
    const dialogueHeaderMatch = new RegExp(
      `^translate\\s+${language}\\s+([A-Za-z0-9_]+)\\s*:`,
      "i",
    ).exec(trimmed);
    if (dialogueHeaderMatch) {
      flushDialogueBlock();
      currentBlockType = "dialogue";
      currentDialogueId = dialogueHeaderMatch[1]!;
      continue;
    }

    // Unindented new statement breaks translation block
    if (
      trimmed.length > 0 && !rawLine.startsWith(" ") &&
      !rawLine.startsWith("\t") && !trimmed.startsWith("#")
    ) {
      flushDialogueBlock();
      currentBlockType = "none";
      continue;
    }

    const gatherMultiLine = (initial: string): string => {
      let result = initial;
      if (
        result.includes('"""') &&
        (result.match(/"""/g) || []).length % 2 !== 0
      ) {
        while (idx + 1 < lines.length) {
          idx++;
          result += "\n" + lines[idx];
          if (lines[idx]!.includes('"""')) break;
        }
      } else if (
        result.includes("'''") &&
        (result.match(/'''/g) || []).length % 2 !== 0
      ) {
        while (idx + 1 < lines.length) {
          idx++;
          result += "\n" + lines[idx];
          if (lines[idx]!.includes("'''")) break;
        }
      }
      return result;
    };

    const findEarliestQuote = (text: string, startIndex = 0): number => {
      const sub = text.slice(startIndex);
      const candidates = [
        sub.indexOf('"""'),
        sub.indexOf("'''"),
        sub.indexOf('"'),
        sub.indexOf("'"),
      ].filter((idx) => idx !== -1);
      return candidates.length > 0 ? startIndex + Math.min(...candidates) : -1;
    };

    if (currentBlockType === "strings") {
      // old "string"
      const oldMatch = /^old\s+/.exec(trimmed);
      if (oldMatch) {
        const fullText = gatherMultiLine(trimmed);
        const quoteStart = findEarliestQuote(fullText, oldMatch[0].length);
        if (quoteStart !== -1) {
          const parsed = extractQuotedString(fullText, quoteStart);
          if (parsed) {
            pendingOldString = parsed.value;
          }
        }
        continue;
      }

      // new "string"
      const newMatch = /^new\s+/.exec(trimmed);
      if (newMatch && pendingOldString !== null) {
        const fullText = gatherMultiLine(trimmed);
        const quoteStart = findEarliestQuote(fullText, newMatch[0].length);
        if (quoteStart !== -1) {
          const parsed = extractQuotedString(fullText, quoteStart);
          if (parsed) {
            data.strings[pendingOldString] = parsed.value;
          }
        }
        pendingOldString = null;
        continue;
      }
    } else if (currentBlockType === "dialogue") {
      // Ignore comments (which Ren'Py generates to show the untranslated line)
      if (trimmed.startsWith("#")) continue;
      if (!trimmed) continue;

      // Filter out non-dialogue Ren'Py statements
      if (
        /^(?:voice|play|stop|queue|scene|show|hide|with|window|nvl|\$|python)\b/
          .test(trimmed)
      ) {
        continue;
      }

      // Extract translated say dialogue string
      // Format: [speaker] "dialogue" or just "dialogue"
      const fullText = gatherMultiLine(trimmed);
      const quoteIndex = findEarliestQuote(fullText);

      if (quoteIndex !== -1) {
        const parsed = extractQuotedString(fullText, quoteIndex);
        if (parsed) {
          currentDialogueLines.push(parsed.value);
        }
      }
    }
  }

  flushDialogueBlock();
}

/**
 * Scans all input files for translation files and constructs ProjectTranslations.
 */
export function scanTranslations(
  translationFiles: ParseInputFile[],
): ProjectTranslations {
  const translationsByLanguage: Record<string, LanguageTranslationData> = {};
  const languagesSet = new Set<string>();

  for (const file of translationFiles) {
    const rawPath = file.relativePath ?? file.name;
    const match = RENPY_TL_PATH_REGEX.exec(rawPath);
    if (!match) continue;

    const language = match[1]!.toLowerCase();
    languagesSet.add(language);

    if (!translationsByLanguage[language]) {
      translationsByLanguage[language] = {
        language,
        strings: {},
        dialogueByNodeId: {},
        dialogueByLabel: {},
      };
    }

    const contentStr = typeof file.content === "string"
      ? file.content
      : new TextDecoder("utf-8").decode(file.content);

    parseTranslationFileContent(
      contentStr,
      language,
      translationsByLanguage[language],
    );
  }

  const availableLanguages = Array.from(languagesSet).sort();
  return {
    availableLanguages,
    translationsByLanguage,
  };
}
