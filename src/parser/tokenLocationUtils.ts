import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SourceLocation } from "../domain/index.ts";

export interface FlatTokenLike {
  type: number;
  metaTokens: Iterable<number>;
  startPos: { line: number; character: number };
  startOffset?: number;
  endPos?: { line: number; character: number };
  endOffset?: number;
  getValue: (document: TextDocument) => string;
}

const lineOffsetCache = new WeakMap<TextDocument, number[]>();

export function getLineOffsets(document: TextDocument): number[] {
  let offsets = lineOffsetCache.get(document);
  if (!offsets) {
    offsets = [0];
    const text = document.getText();
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        offsets.push(i + 1);
      }
    }
    lineOffsetCache.set(document, offsets);
  }
  return offsets;
}

export function fastOffsetAt(
  document: TextDocument,
  pos: { line: number; character: number },
): number {
  const offsets = getLineOffsets(document);
  const lineStart = offsets[pos.line] ?? 0;
  return lineStart + pos.character;
}

export function fastPositionAt(
  document: TextDocument,
  offset: number,
): { line: number; character: number } {
  const offsets = getLineOffsets(document);
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] === offset) return { line: mid, character: 0 };
    if (offsets[mid] < offset) low = mid + 1;
    else high = mid - 1;
  }
  const line = Math.max(0, low - 1);
  return { line, character: offset - (offsets[line] ?? 0) };
}

export function getTokenSourceLocation(
  token: FlatTokenLike,
  document: TextDocument,
  file: string,
): SourceLocation {
  const startOffset = token.startOffset ??
    fastOffsetAt(document, token.startPos);
  const rawText = token.getValue(document);
  const endOffset = token.endOffset ?? (startOffset + rawText.length);
  const endPos = token.endPos ?? fastPositionAt(document, endOffset);
  return {
    file,
    start: {
      line: token.startPos.line,
      character: token.startPos.character,
      offset: startOffset,
    },
    end: {
      line: endPos.line,
      character: endPos.character,
      offset: endOffset,
    },
  };
}

export function computeLineIndent(line: string, tabStop = 8): number {
  let indent = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line.charCodeAt(i);
    if (char === 32) {
      indent += 1;
    } else if (char === 9) {
      indent += tabStop - (indent % tabStop);
    } else {
      break;
    }
  }
  return indent;
}

export function getLineIndent(
  document: TextDocument,
  lineNumber: number,
  cache: Map<number, number>,
  docLines?: readonly string[],
): number {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = docLines ? (docLines[lineNumber] ?? "") : document.getText({
    start: { line: lineNumber, character: 0 },
    end: { line: lineNumber, character: Number.MAX_SAFE_INTEGER },
  });
  const indent = computeLineIndent(line);
  cache.set(lineNumber, indent);
  return indent;
}

export function getLineText(
  document: TextDocument,
  lineNumber: number,
  cache: Map<number, string>,
  docLines?: readonly string[],
): string {
  const cached = cache.get(lineNumber);
  if (cached !== undefined) {
    return cached;
  }
  const line = docLines ? (docLines[lineNumber] ?? "") : document.getText({
    start: { line: lineNumber, character: 0 },
    end: { line: lineNumber, character: Number.MAX_SAFE_INTEGER },
  });
  cache.set(lineNumber, line);
  return line;
}
