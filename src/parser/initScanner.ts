import type { ParseGraphState, ParseInputFile } from "./pipelineTypes.ts";
import { compareDeterministicStrings } from "../domain/index.ts";

export interface InitItem {
  type:
    | "python_block"
    | "init_block"
    | "define_default"
    | "screen"
    | "dollar_assignment";
  kind: "define" | "default" | "python" | "persistent";
  priority: number;
  filePath: string;
  lineIndex: number;
  variableName?: string; // For define/default/dollar_assignment
  expression?: string; // For define/default or python code
  body?: string; // For blocks
  isPersistent?: boolean;
}

export function getLineIndent(line: string): number {
  const match = line.match(/^([ \t]*)/);
  return match ? match[0].length : 0;
}

export interface DelimiterState {
  delimiterStack: Array<")" | "]" | "}">;
  activeQuote: '"' | "'" | null;
  tripleQuoted: boolean;
  inComment: boolean;
  explicitContinuation: boolean;
}

export function processLineState(lineText: string, state: DelimiterState) {
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
          i += 2;
          state.activeQuote = null;
          state.tripleQuoted = false;
        }
        continue;
      }
      if (char === state.activeQuote) {
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
      state.tripleQuoted = false;
      continue;
    }

    const openingDelimiter = {
      "(": ")",
      "[": "]",
      "{": "}",
    }[char];

    if (openingDelimiter) {
      state.delimiterStack.push(openingDelimiter as ")" | "]" | "}");
    } else if (char === ")" || char === "]" || char === "}") {
      if (char === state.delimiterStack[state.delimiterStack.length - 1]) {
        state.delimiterStack.pop();
      }
    }

    if (!/\s/.test(char)) {
      lastSignificantCharOutsideComment = char;
    }
  }
  state.explicitContinuation = lastSignificantCharOutsideComment === "\\";
  state.inComment = false;
}

export function getLogicalBodyAndEndLine(
  lines: string[],
  startLineIndex: number,
  initialBodyPart: string,
): { body: string; endLineIndex: number } {
  let body = initialBodyPart;
  let idx = startLineIndex + 1;

  const state: DelimiterState = {
    delimiterStack: [],
    activeQuote: null,
    tripleQuoted: false,
    inComment: false,
    explicitContinuation: false,
  };

  processLineState(initialBodyPart, state);

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      body += "\n" + line;
      idx += 1;
      continue;
    }

    const indent = getLineIndent(line);
    const isInsideGroup = state.explicitContinuation ||
      state.delimiterStack.length > 0 || state.activeQuote !== null;

    if (indent > 0 || isInsideGroup) {
      body += "\n" + line;
      processLineState(line, state);
      idx += 1;
    } else {
      break;
    }
  }
  return { body, endLineIndex: idx - 1 };
}

export function getLogicalExpressionAndEndLine(
  lines: string[],
  startLineIndex: number,
  initialRHS: string,
): { body: string; endLineIndex: number } {
  let body = initialRHS;
  let currentLine = startLineIndex;

  const state: DelimiterState = {
    delimiterStack: [],
    activeQuote: null,
    tripleQuoted: false,
    inComment: false,
    explicitContinuation: false,
  };

  processLineState(initialRHS, state);

  while (
    (state.explicitContinuation || state.delimiterStack.length > 0 ||
      state.activeQuote !== null) &&
    currentLine + 1 < lines.length
  ) {
    currentLine += 1;
    const nextLine = lines[currentLine];
    body += "\n" + nextLine;
    processLineState(nextLine, state);
  }

  return { body, endLineIndex: currentLine };
}

export function stripPythonComments(text: string): string {
  let result = "";
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (activeQuote) {
      if (char === "\\") {
        result += char;
        if (i + 1 < text.length) {
          result += text[i + 1];
          i += 2;
          continue;
        }
      }
      if (tripleQuoted) {
        if (
          i + 2 < text.length &&
          char === activeQuote &&
          text[i + 1] === activeQuote &&
          text[i + 2] === activeQuote
        ) {
          result += char + text[i + 1] + text[i + 2];
          i += 3;
          activeQuote = null;
          tripleQuoted = false;
          continue;
        }
      } else if (char === activeQuote) {
        activeQuote = null;
      }
      result += char;
      i += 1;
      continue;
    }

    if (
      i + 2 < text.length &&
      (char === '"' || char === "'") &&
      text[i + 1] === char &&
      text[i + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      result += char + text[i + 1] + text[i + 2];
      i += 3;
      continue;
    }

    if (char === '"' || char === "'") {
      activeQuote = char;
      result += char;
      i += 1;
      continue;
    }

    if (char === "#") {
      const eol = text.indexOf("\n", i);
      if (eol === -1) {
        break;
      }
      i = eol;
      continue;
    }

    result += char;
    i += 1;
  }
  return result;
}

export function scanInitItemsFromFiles(
  files: ParseInputFile[],
  state: ParseGraphState,
): InitItem[] {
  const items: InitItem[] = [];

  for (const file of files) {
    const rawPath = file.relativePath ?? file.name;
    const filePath = rawPath.replace(/\\/g, "/");
    const chapter = filePath.replace(/\.rpy$/i, "");
    const contentStr = typeof file.content === "string"
      ? file.content
      : new TextDecoder("utf-8").decode(file.content);
    const lines = contentStr.split(/\r?\n/);

    let chapterLabels = state.labelsByChapter.get(chapter);
    if (!chapterLabels) {
      chapterLabels = new Map();
      state.labelsByChapter.set(chapter, chapterLabels);
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const labelMatch =
        /^label\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:/i.exec(trimmed);
      if (labelMatch) {
        const declaredName = labelMatch[1].trim();
        if (!chapterLabels.has(declaredName)) {
          const count =
            (state.labelDefinitionCountByName.get(declaredName) ?? 0) + 1;
          state.labelDefinitionCountByName.set(declaredName, count);
          const canonical = state.canonicalLabelIdByName.get(declaredName) ??
            declaredName;
          state.canonicalLabelIdByName.set(declaredName, canonical);
          const labelId = count === 1
            ? canonical
            : `${canonical}__shadow_${count}`;
          chapterLabels.set(declaredName, labelId);
        }
      }
    }

    let currentOffset = 0;
    let idx = 0;

    while (idx < lines.length) {
      const line = lines[idx];
      const trimmed = line.trim();

      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        idx += 1;
        continue;
      }

      const indent = getLineIndent(line);
      if (indent !== 0) {
        idx += 1;
        continue;
      }

      // 1. Detect init offset
      const offsetMatch = /^init\s+offset\s*=\s*([+-]?\d+)/i.exec(trimmed);
      if (offsetMatch) {
        currentOffset = parseInt(offsetMatch[1], 10);
        idx += 1;
        continue;
      }

      // 2. Detect python early
      const pythonEarlyMatch = /^python\s+early\s*:(.*)$/i.exec(trimmed);
      if (pythonEarlyMatch) {
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          pythonEarlyMatch[1],
        );
        items.push({
          type: "python_block",
          kind: "python",
          priority: -10000,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      // 3. Detect init blocks
      const initPriorityPythonMatch =
        /^init\s+([+-]?\d+)\s+python\s*:(.*)$/i.exec(
          trimmed,
        ) ?? /^init\s+python\s+([+-]?\d+)\s*:(.*)$/i.exec(trimmed);
      if (initPriorityPythonMatch) {
        const priority = currentOffset +
          parseInt(initPriorityPythonMatch[1], 10);
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          initPriorityPythonMatch[2],
        );
        items.push({
          type: "python_block",
          kind: "python",
          priority,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      const initPriorityMatch = /^init\s+([+-]?\d+)\s*:(.*)$/i.exec(trimmed);
      if (initPriorityMatch) {
        const priority = currentOffset + parseInt(initPriorityMatch[1], 10);
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          initPriorityMatch[2],
        );
        items.push({
          type: "init_block",
          kind: "python",
          priority,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      const initPythonMatch = /^init(?:\s+([+-]?\d+))?\s+python\s*:(.*)$/i.exec(
        trimmed,
      );
      if (initPythonMatch) {
        const explicitOffset = initPythonMatch[1]
          ? parseInt(initPythonMatch[1], 10)
          : 0;
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          initPythonMatch[2],
        );
        items.push({
          type: "python_block",
          kind: "python",
          priority: currentOffset + explicitOffset,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      const initMatch = /^init(?:\s+([+-]?\d+))?\s*:(.*)$/i.exec(trimmed);
      if (initMatch) {
        const explicitOffset = initMatch[1] ? parseInt(initMatch[1], 10) : 0;
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          initMatch[2],
        );
        items.push({
          type: "init_block",
          kind: "python",
          priority: currentOffset + explicitOffset,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      // 4. Detect define or default
      const defineDefaultMatch =
        /^(define|default)(?:\s+([+-]?\d+))?\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=(.*)$/i
          .exec(trimmed);
      if (defineDefaultMatch) {
        const stmtKind = defineDefaultMatch[1].toLowerCase() as
          | "define"
          | "default";
        const variableName = defineDefaultMatch[3].trim();
        const initialRHS = defineDefaultMatch[4];
        const { body: expression, endLineIndex } =
          getLogicalExpressionAndEndLine(lines, idx, initialRHS);
        const explicitPriority = defineDefaultMatch[2]
          ? parseInt(defineDefaultMatch[2], 10)
          : 0;
        const isPersist = variableName.startsWith("persistent.");
        items.push({
          type: "define_default",
          kind: stmtKind,
          priority: currentOffset + explicitPriority,
          filePath,
          lineIndex: idx,
          variableName,
          expression,
          isPersistent: isPersist,
        });
        idx = endLineIndex + 1;
        continue;
      }

      // 5. Detect top-level dollar sign assignment ($ var = val)
      const dollarMatch =
        /^\$\s*([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=\s*(.*)$/.exec(
          trimmed,
        );
      if (dollarMatch) {
        const variableName = dollarMatch[1].trim();
        const isPersist = variableName.startsWith("persistent.");
        items.push({
          type: "dollar_assignment",
          kind: isPersist ? "persistent" : "python",
          priority: currentOffset,
          filePath,
          lineIndex: idx,
          variableName,
          expression: dollarMatch[2],
          isPersistent: isPersist,
        });
        idx += 1;
        continue;
      }

      // 6. Detect screen definitions
      const screenMatch = /^screen\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(trimmed);
      if (screenMatch) {
        const screenName = screenMatch[1].trim();
        items.push({
          type: "screen",
          kind: "define",
          priority: currentOffset,
          filePath,
          lineIndex: idx,
          variableName: screenName,
        });
      }

      // 7. Detect image definitions
      const imageMatch =
        /^image(?:\s+([+-]?\d+))?\s+([^=:]+)(?:=\s*(.+)|:.*)?$/i.exec(trimmed);
      if (
        imageMatch && !trimmed.startsWith("init") &&
        !trimmed.startsWith("define") && !trimmed.startsWith("default") &&
        !trimmed.startsWith("screen")
      ) {
        const imageName = imageMatch[2]!.trim();
        const rawTarget = imageMatch[3] ? imageMatch[3].trim() : "";
        if (!state.imageDefinitions) state.imageDefinitions = new Map();
        state.imageDefinitions.set(
          imageName,
          rawTarget.replace(/^["']|["']$/g, ""),
        );
      }

      idx += 1;
    }
  }

  items.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const subPriorityA = a.kind === "define"
      ? 0
      : a.kind === "python" || a.kind === "persistent"
      ? 1
      : 2;
    const subPriorityB = b.kind === "define"
      ? 0
      : b.kind === "python" || b.kind === "persistent"
      ? 1
      : 2;
    if (subPriorityA !== subPriorityB) {
      return subPriorityA - subPriorityB;
    }
    const fileComp = compareDeterministicStrings(a.filePath, b.filePath);
    if (fileComp !== 0) {
      return fileComp;
    }
    return a.lineIndex - b.lineIndex;
  });

  return items;
}
