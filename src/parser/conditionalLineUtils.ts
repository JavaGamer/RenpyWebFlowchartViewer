import type { TextDocument } from "vscode-languageserver-textdocument";
import { getLineText } from "./tokenLocationUtils.ts";

export function getConditionalLogicalLine(
  document: TextDocument,
  lineNumber: number,
  lineTextCache: Map<number, string>,
  logicalLineCache: Map<number, string>,
  docLines?: readonly string[],
): string {
  const cached = logicalLineCache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }

  let logicalText = getLineText(document, lineNumber, lineTextCache, docLines);
  let currentLine = lineNumber;
  let maxLine = lineNumber;
  const delimiterStack: Array<")" | "]" | "}"> = [];
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;
  let explicitContinuation = false;

  const processLine = (lineText: string) => {
    let lastSignificantCharOutsideComment: string | null = null;
    for (let i = 0; i < lineText.length; i += 1) {
      const char = lineText[i] ?? "";
      if (inComment) {
        continue;
      }

      if (activeQuote) {
        if (char === "\\") {
          if (i + 1 < lineText.length) {
            i += 1;
          }
          continue;
        }
        if (tripleQuoted) {
          if (
            char === activeQuote && lineText[i + 1] === activeQuote &&
            lineText[i + 2] === activeQuote
          ) {
            i += 2;
            activeQuote = null;
            tripleQuoted = false;
          }
          continue;
        }
        if (char === activeQuote) {
          activeQuote = null;
        }
        continue;
      }

      if (char === "#") {
        inComment = true;
        continue;
      }

      if (
        i + 2 < lineText.length &&
        (char === '"' || char === "'") &&
        lineText[i + 1] === char &&
        lineText[i + 2] === char
      ) {
        activeQuote = char;
        tripleQuoted = true;
        i += 2;
        continue;
      }
      if (char === '"' || char === "'") {
        activeQuote = char;
        tripleQuoted = false;
        continue;
      }

      const openingDelimiter = {
        "(": ")",
        "[": "]",
        "{": "}",
      }[char];

      if (openingDelimiter) {
        delimiterStack.push(openingDelimiter as ")" | "]" | "}");
      } else if (char === ")" || char === "]" || char === "}") {
        if (char === delimiterStack[delimiterStack.length - 1]) {
          delimiterStack.pop();
        }
      }

      if (
        !(char === " " || char === "\t" || char === "\n" || char === "\r" ||
          char === "\f" || char === "\v")
      ) {
        lastSignificantCharOutsideComment = char;
      }
    }

    explicitContinuation = lastSignificantCharOutsideComment === "\\";
    inComment = false;
  };

  processLine(logicalText);

  const totalLines = docLines ? docLines.length : document.lineCount;
  const MAX_CONTINUATION_LINES = 50;
  let scannedCount = 0;

  while (
    (explicitContinuation || delimiterStack.length > 0 ||
      activeQuote !== null) &&
    currentLine + 1 < totalLines &&
    scannedCount < MAX_CONTINUATION_LINES
  ) {
    scannedCount += 1;
    currentLine += 1;
    const nextLineText = getLineText(
      document,
      currentLine,
      lineTextCache,
      docLines,
    );
    logicalText += `\n${nextLineText}`;
    processLine(nextLineText);
    maxLine = currentLine;
  }

  for (let l = lineNumber; l <= maxLine; l += 1) {
    logicalLineCache.set(l, logicalText);
  }

  return logicalText;
}
