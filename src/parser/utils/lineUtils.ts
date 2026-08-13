/**
 * Shared string, line indentation, delimiter tracking, and pre-compiled regex utilities.
 */

export function computeLineIndent(lineText: string): number {
  let indent = 0;
  for (let i = 0; i < lineText.length; i++) {
    const char = lineText[i];
    if (char === " ") {
      indent += 1;
    } else if (char === "\t") {
      indent += 8 - (indent % 8);
    } else {
      break;
    }
  }
  return indent;
}

export interface DelimiterState {
  delimiterStack: Array<")" | "]" | "}">;
  activeQuote: '"' | "'" | null;
  tripleQuoted: boolean;
  inComment: boolean;
  explicitContinuation: boolean;
}

export function createDelimiterState(): DelimiterState {
  return {
    delimiterStack: [],
    activeQuote: null,
    tripleQuoted: false,
    inComment: false,
    explicitContinuation: false,
  };
}

export function processLineState(
  lineText: string,
  state: DelimiterState,
): { lastSignificantCharOutsideComment: string | null } {
  let lastSignificantCharOutsideComment: string | null = null;
  for (let i = 0; i < lineText.length; i += 1) {
    const char = lineText[i] ?? "";
    if (state.inComment) {
      continue;
    }

    if (state.activeQuote) {
      if (char === "\\") {
        if (i + 1 < lineText.length) {
          i += 1;
        }
        continue;
      }
      if (state.tripleQuoted) {
        if (
          i + 2 < lineText.length &&
          char === state.activeQuote &&
          lineText[i + 1] === state.activeQuote &&
          lineText[i + 2] === state.activeQuote
        ) {
          state.activeQuote = null;
          state.tripleQuoted = false;
          i += 2;
          continue;
        }
      } else if (char === state.activeQuote) {
        state.activeQuote = null;
      }
      continue;
    }

    if (char === "#") {
      state.inComment = true;
      continue;
    }

    if (
      i + 2 < lineText.length &&
      (char === '"' || char === "'") &&
      lineText[i + 1] === char &&
      lineText[i + 2] === char
    ) {
      state.activeQuote = char;
      state.tripleQuoted = true;
      i += 2;
      continue;
    }

    if (char === '"' || char === "'") {
      state.activeQuote = char;
      continue;
    }

    if (char === "(") {
      state.delimiterStack.push(")");
      lastSignificantCharOutsideComment = char;
    } else if (char === "[") {
      state.delimiterStack.push("]");
      lastSignificantCharOutsideComment = char;
    } else if (char === "{") {
      state.delimiterStack.push("}");
      lastSignificantCharOutsideComment = char;
    } else if (char === ")" || char === "]" || char === "}") {
      const top = state.delimiterStack[state.delimiterStack.length - 1];
      if (top === char) {
        state.delimiterStack.pop();
      }
      lastSignificantCharOutsideComment = char;
    } else if (!/\s/.test(char)) {
      lastSignificantCharOutsideComment = char;
    }
  }

  return { lastSignificantCharOutsideComment };
}

// Pre-compiled global regex constants for high-frequency token & dialogue parsing
export const PAUSE_TAG_REGEX = /\{[wp]=([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\}/g;
export const TEXT_TAG_STRIP_REGEX = /\{[^}]*\}/g;
export const TIMED_CHOICE_REGEX =
  /^timedchoice\s+([0-9]+(?:\.[0-9]*)?)\s+([A-Za-z0-9_]+)/i;
export const GAMEOVER_REGEX = /^gameover\b/i;
export const TITLE_REGEX = /^title\b/i;
export const BREAK_REGEX = /^(?:\$\s*)?break\b/i;
export const CONTINUE_REGEX = /^(?:\$\s*)?continue\b/i;
