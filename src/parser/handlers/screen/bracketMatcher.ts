type OpeningDelimiter = "(" | "[" | "{";
type ClosingDelimiter = ")" | "]" | "}";

export const CLOSING_DELIMITER_BY_OPENING: Record<
  OpeningDelimiter,
  ClosingDelimiter
> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

export const CLOSING_DELIMITERS = new Set<ClosingDelimiter>([")", "]", "}"]);

export function isIdentifierStart(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

export function isIdentifierPart(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 46 // .
  );
}

export function isWhitespaceChar(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" ||
    char === "\f";
}

export function isIdentifierBoundary(char: string | undefined): boolean {
  if (!char) return true;
  const code = char.charCodeAt(0);
  return !(
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 // _
  );
}

export function skipWhitespace(text: string, startIndex: number): number {
  let index = startIndex;
  while (index < text.length && isWhitespaceChar(text[index])) {
    index += 1;
  }
  return index;
}

export function isTopLevelPythonStatementMatch(
  text: string,
  matchIndex: number,
): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let index = 0;

  while (index < matchIndex) {
    const char = text[index];
    if (activeQuote) {
      if (char === "\\") {
        const escapeSequenceLength = (index + 1 < text.length) ? 2 : 1;
        index += escapeSequenceLength;
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[index + 1] === activeQuote &&
          text[index + 2] === activeQuote
        ) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      index += 1;
      continue;
    }

    if (char === "#") {
      while (index < matchIndex && text[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (
      (char === '"' || char === "'") && text[index + 1] === char &&
      text[index + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      tripleQuoted = false;
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    index += 1;
  }

  return parenDepth === 0 && bracketDepth === 0 && braceDepth === 0;
}

export function readParenthesizedArgument(
  text: string,
  argumentStartIndex: number,
): { argument: string; endIndex: number } | null {
  const delimiterStack: Array<")" | "]" | "}"> = [")"];
  let endIndex = -1;
  forEachCodeCharacterOutsideStringsAndComments(
    text,
    argumentStartIndex,
    (index, char) => {
      const openingDelimiter =
        CLOSING_DELIMITER_BY_OPENING[char as OpeningDelimiter];
      if (openingDelimiter) {
        delimiterStack.push(openingDelimiter);
        return;
      }
      if (!CLOSING_DELIMITERS.has(char as ClosingDelimiter)) {
        return;
      }
      if (char !== delimiterStack[delimiterStack.length - 1]) {
        return;
      }
      delimiterStack.pop();
      if (delimiterStack.length === 0) {
        endIndex = index + 1;
        return false;
      }
    },
  );
  if (endIndex >= 0) {
    return {
      argument: text.slice(argumentStartIndex, endIndex - 1),
      endIndex,
    };
  }
  return null;
}

export function readBalancedSegment(
  text: string,
  startIndex: number,
): { expression: string; endIndex: number } | null {
  const opener = text[startIndex];
  const closingByOpening: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };
  const expectedCloser = closingByOpening[opener ?? ""];
  if (!expectedCloser) return null;

  const stack = [expectedCloser];
  let index = startIndex + 1;
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;

  while (index < text.length) {
    const char = text[index];
    if (inComment) {
      if (char === "\n") inComment = false;
      index += 1;
      continue;
    }

    if (activeQuote) {
      if (char === "\\") {
        const escapeSequenceLength = (index + 1 < text.length) ? 2 : 1;
        index += escapeSequenceLength;
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[index + 1] === activeQuote &&
          text[index + 2] === activeQuote
        ) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      index += 1;
      continue;
    }

    if (char === "#") {
      inComment = true;
      index += 1;
      continue;
    }

    if (
      (char === '"' || char === "'") && text[index + 1] === char &&
      text[index + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      index += 1;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      stack.push(closingByOpening[char]!);
      index += 1;
      continue;
    }
    if (char === stack[stack.length - 1]) {
      stack.pop();
      index += 1;
      if (stack.length === 0) {
        return {
          expression: text.slice(startIndex, index),
          endIndex: index,
        };
      }
      continue;
    }
    index += 1;
  }

  return null;
}

export function readIdentifier(
  text: string,
  startIndex: number,
): { identifier: string; endIndex: number } | null {
  if (!isIdentifierStart(text[startIndex])) return null;
  let endIndex = startIndex + 1;
  while (endIndex < text.length && isIdentifierPart(text[endIndex])) {
    endIndex += 1;
  }
  return {
    identifier: text.slice(startIndex, endIndex),
    endIndex,
  };
}

export function forEachCodeCharacterOutsideStringsAndComments(
  text: string,
  startIndex: number,
  visitor: (index: number, char: string) => false | void,
): void {
  let index = startIndex;
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;

  while (index < text.length) {
    const char = text[index] ?? "";
    if (inComment) {
      if (char === "\n") {
        inComment = false;
      }
      index += 1;
      continue;
    }

    if (activeQuote) {
      if (char === "\\") {
        index += (index + 1 < text.length) ? 2 : 1;
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[index + 1] === activeQuote &&
          text[index + 2] === activeQuote
        ) {
          index += 3;
          activeQuote = null;
          tripleQuoted = false;
        } else {
          index += 1;
        }
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      index += 1;
      continue;
    }

    if (char === "#") {
      inComment = true;
      index += 1;
      continue;
    }
    if (
      (char === '"' || char === "'") && text[index + 1] === char &&
      text[index + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      index += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      index += 1;
      continue;
    }

    if (visitor(index, char) === false) {
      return;
    }
    index += 1;
  }
}

export function splitTopLevelArguments(argumentList: string): string[] {
  const args: string[] = [];
  const delimiterStack: ClosingDelimiter[] = [];
  let start = 0;

  forEachCodeCharacterOutsideStringsAndComments(
    argumentList,
    0,
    (index, char) => {
      const openingDelimiter =
        CLOSING_DELIMITER_BY_OPENING[char as OpeningDelimiter];
      if (openingDelimiter) {
        delimiterStack.push(openingDelimiter);
        return;
      }
      if (CLOSING_DELIMITERS.has(char as ClosingDelimiter)) {
        if (char === delimiterStack[delimiterStack.length - 1]) {
          delimiterStack.pop();
        }
        return;
      }
      if (delimiterStack.length === 0 && char === ",") {
        const segment = argumentList.slice(start, index).trim();
        if (segment) args.push(segment);
        start = index + 1;
      }
    },
  );

  const last = argumentList.slice(start).trim();
  if (last) args.push(last);
  return args;
}

export function findTopLevelDelimiterIndex(
  text: string,
  delimiter: "," | "=" | ":",
): number {
  const delimiterStack: ClosingDelimiter[] = [];
  let foundIndex = -1;
  forEachCodeCharacterOutsideStringsAndComments(text, 0, (index, char) => {
    const openingDelimiter =
      CLOSING_DELIMITER_BY_OPENING[char as OpeningDelimiter];
    if (openingDelimiter) {
      delimiterStack.push(openingDelimiter);
      return;
    }
    if (CLOSING_DELIMITERS.has(char as ClosingDelimiter)) {
      if (char === delimiterStack[delimiterStack.length - 1]) {
        delimiterStack.pop();
      }
      return;
    }
    if (delimiterStack.length === 0 && char === delimiter) {
      foundIndex = index;
      return false;
    }
  });
  if (foundIndex >= 0) return foundIndex;
  return -1;
}

export function buildIgnoredPositionMask(text: string): boolean[] {
  const ignored = new Array<boolean>(text.length).fill(false);
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inComment) {
      ignored[i] = true;
      if (char === "\n") inComment = false;
      continue;
    }

    if (activeQuote) {
      ignored[i] = true;
      if (char === "\\") {
        if (i + 1 < text.length) {
          ignored[i + 1] = true;
          i += 1;
        }
        continue;
      }
      if (tripleQuoted) {
        if (
          char === activeQuote && text[i + 1] === activeQuote &&
          text[i + 2] === activeQuote
        ) {
          ignored[i + 1] = true;
          ignored[i + 2] = true;
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === activeQuote) activeQuote = null;
      continue;
    }

    if (char === "#") {
      ignored[i] = true;
      inComment = true;
      continue;
    }

    if (
      (char === '"' || char === "'") && text[i + 1] === char &&
      text[i + 2] === char
    ) {
      ignored[i] = true;
      if (i + 1 < text.length) ignored[i + 1] = true;
      if (i + 2 < text.length) ignored[i + 2] = true;
      i += 2;
      activeQuote = char;
      tripleQuoted = true;
      continue;
    }

    if (char === '"' || char === "'") {
      ignored[i] = true;
      activeQuote = char;
      tripleQuoted = false;
    }
  }

  return ignored;
}
