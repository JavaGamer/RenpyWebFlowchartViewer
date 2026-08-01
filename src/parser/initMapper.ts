import type {
  ParseGraphState,
  ParseInputFile,
  ResolveTargetScanState,
} from "./pipelineTypes.ts";
import {
  extractLiteralTarget,
  parseDictLiteral,
  parseListLiteral,
  resolveStaticTargetExpression,
  stripInlineComment,
} from "./tokenHandling.ts";
import { compareDeterministicStrings } from "../domain/index.ts";

interface InitItem {
  type: "python_block" | "init_block" | "define_default" | "screen";
  priority: number;
  filePath: string;
  lineIndex: number;
  variableName?: string; // For define/default
  expression?: string; // For define/default or python code
  body?: string; // For blocks
}

function getLineIndent(line: string): number {
  const match = line.match(/^([ \t]*)/);
  return match ? match[0].length : 0;
}

interface DelimiterState {
  delimiterStack: Array<")" | "]" | "}">;
  activeQuote: '"' | "'" | null;
  tripleQuoted: boolean;
  inComment: boolean;
  explicitContinuation: boolean;
}

function processLineState(lineText: string, state: DelimiterState) {
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

function getLogicalBodyAndEndLine(
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

// Strip inline comments from python code block or assignment RHS
export function stripPythonComments(text: string): string {
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (activeQuote) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (tripleQuoted) {
        if (
          i + 2 < text.length &&
          char === activeQuote &&
          text[i + 1] === activeQuote &&
          text[i + 2] === activeQuote
        ) {
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === activeQuote) activeQuote = null;
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
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      continue;
    }
    if (char === "#") {
      return text.slice(0, i);
    }
  }
  return text;
}

export function preParseInitialization(
  files: ParseInputFile[],
  state: ParseGraphState,
): void {
  if (!state.labelsByChapter) {
    state.labelsByChapter = new Map();
  }
  if (!state.labelDefinitionCountByName) {
    state.labelDefinitionCountByName = new Map();
  }
  if (!state.canonicalLabelIdByName) {
    state.canonicalLabelIdByName = new Map();
  }
  const items: InitItem[] = [];

  for (const file of files) {
    const filePath = file.relativePath ?? file.name;
    const chapter = filePath.replace(/\\/g, "/").replace(/\.rpy$/i, "");
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
      const offsetMatch = /^init\s+offset\s*=\s*(-?\d+)/i.exec(trimmed);
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
          priority: -10000,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      // 3. Detect init blocks
      const initPriorityPythonMatch = /^init\s+(-?\d+)\s+python\s*:(.*)$/i.exec(
        trimmed,
      );
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
          priority,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      const initPriorityMatch = /^init\s+(-?\d+)\s*:(.*)$/i.exec(trimmed);
      if (initPriorityMatch) {
        const priority = currentOffset + parseInt(initPriorityMatch[1], 10);
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          initPriorityMatch[2],
        );
        items.push({
          type: "init_block",
          priority,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      const initPythonMatch = /^init\s+python\s*:(.*)$/i.exec(trimmed);
      if (initPythonMatch) {
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          initPythonMatch[1],
        );
        items.push({
          type: "python_block",
          priority: currentOffset,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      const initMatch = /^init\s*:(.*)$/i.exec(trimmed);
      if (initMatch) {
        const { body, endLineIndex } = getLogicalBodyAndEndLine(
          lines,
          idx,
          initMatch[1],
        );
        items.push({
          type: "init_block",
          priority: currentOffset,
          filePath,
          lineIndex: idx,
          body,
        });
        idx = endLineIndex + 1;
        continue;
      }

      // 4. Detect define or default
      const defineDefaultMatch =
        /^(define|default)(?:\s+(-?\d+))?\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=(.*)$/i
          .exec(trimmed);
      if (defineDefaultMatch) {
        const variableName = defineDefaultMatch[3].trim();
        const initialRHS = defineDefaultMatch[4];
        const { body: expression, endLineIndex } =
          getLogicalExpressionAndEndLine(lines, idx, initialRHS);
        const explicitPriority = defineDefaultMatch[2]
          ? parseInt(defineDefaultMatch[2], 10)
          : 0;
        items.push({
          type: "define_default",
          priority: currentOffset + explicitPriority,
          filePath,
          lineIndex: idx,
          variableName,
          expression,
        });
        idx = endLineIndex + 1;
        continue;
      }

      // 5. Detect screen definitions
      const screenMatch = /^screen\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(trimmed);
      if (screenMatch) {
        const screenName = screenMatch[1].trim();
        items.push({
          type: "screen",
          priority: currentOffset,
          filePath,
          lineIndex: idx,
          variableName: screenName,
        });
      }

      idx += 1;
    }
  }

  // Sort by priority, then file name alphabetically, then line index
  items.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const fileComp = compareDeterministicStrings(a.filePath, b.filePath);
    if (fileComp !== 0) {
      return fileComp;
    }
    return a.lineIndex - b.lineIndex;
  });

  // Execute initialization items in priority order
  for (const item of items) {
    if (item.type === "screen" && item.variableName) {
      state.globalScreens.add(item.variableName);
    } else if (
      item.type === "define_default" && item.variableName && item.expression
    ) {
      const cleanExpr = stripPythonComments(item.expression).trim();
      processAssignment(state, item.variableName, cleanExpr);
    } else if (item.type === "python_block" && item.body) {
      processPythonBlockText(state, item.body);
    } else if (item.type === "init_block" && item.body) {
      processInitBlockText(state, item.body);
    }
  }
}

function processAssignment(
  state: ParseGraphState,
  variableName: string,
  rhsExpression: string,
) {
  const cleanExpr = rhsExpression.trim();
  if (/Character\s*\(/i.test(cleanExpr)) {
    state.globalCharacters.add(variableName);
  } else {
    const literalVal = extractLiteralTarget(cleanExpr);
    if (literalVal !== null) {
      state.globalLabelVariableLiteralTargets.set(variableName, literalVal);
      state.globalLabelVariableDictTargets.delete(variableName);
      state.globalLabelVariableListTargets.delete(variableName);
    } else {
      // Mock ParseScanState for resolving global maps (since we only look up in global maps during pre-parse)
      const mockScanState: ResolveTargetScanState = {
        labelVariableLiteralTargets: state.globalLabelVariableLiteralTargets,
        labelVariableDictTargets: state.globalLabelVariableDictTargets,
        labelVariableListTargets: state.globalLabelVariableListTargets,
      };

      const staticResolved = resolveStaticTargetExpression(
        cleanExpr,
        mockScanState,
        state,
      );
      if (staticResolved !== null) {
        state.globalLabelVariableLiteralTargets.set(
          variableName,
          staticResolved,
        );
        state.globalLabelVariableDictTargets.delete(variableName);
        state.globalLabelVariableListTargets.delete(variableName);
      } else {
        const dictVal = parseDictLiteral(cleanExpr);
        if (dictVal !== null) {
          state.globalLabelVariableDictTargets.set(variableName, dictVal);
          state.globalLabelVariableLiteralTargets.delete(variableName);
          state.globalLabelVariableListTargets.delete(variableName);
        } else {
          const listVal = parseListLiteral(cleanExpr);
          if (listVal !== null) {
            state.globalLabelVariableListTargets.set(variableName, listVal);
            state.globalLabelVariableLiteralTargets.delete(variableName);
            state.globalLabelVariableDictTargets.delete(variableName);
          } else {
            // If we can't resolve it, remove any stale definition
            state.globalLabelVariableLiteralTargets.delete(variableName);
            state.globalLabelVariableDictTargets.delete(variableName);
            state.globalLabelVariableListTargets.delete(variableName);
          }
        }
      }
    }
  }
}

function processPythonBlockText(state: ParseGraphState, body: string) {
  const lines = body.split(/\r?\n/);
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      idx += 1;
      continue;
    }

    // Try to match an assignment: var = val
    const match = /^[ \t]*([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=(?!=)(.*)$/
      .exec(line);
    if (match) {
      const varName = match[1].trim();
      const initialRHS = match[2];
      const { body: expression, endLineIndex } = getLogicalExpressionAndEndLine(
        lines,
        idx,
        initialRHS,
      );
      processAssignment(state, varName, stripInlineComment(expression));
      idx = endLineIndex + 1;
      continue;
    }
    idx += 1;
  }
}

function processInitBlockText(state: ParseGraphState, body: string) {
  // Non-python init block. Extract nested defines, defaults, and python statements/blocks.
  const lines = body.split(/\r?\n/);
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      idx += 1;
      continue;
    }

    // Nested define/default
    const defineMatch =
      /^(define|default)(?:\s+(-?\d+))?\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=(.*)$/i
        .exec(trimmed);
    if (defineMatch) {
      const varName = defineMatch[3].trim();
      const { body: expression, endLineIndex } = getLogicalExpressionAndEndLine(
        lines,
        idx,
        defineMatch[4],
      );
      processAssignment(state, varName, stripInlineComment(expression));
      idx = endLineIndex + 1;
      continue;
    }

    // Nested one-line python statement
    if (trimmed.startsWith("$")) {
      const pyLine = trimmed.substring(1).trim();
      const assignmentMatch =
        /^([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=(?!=)(.*)$/.exec(pyLine);
      if (assignmentMatch) {
        processAssignment(
          state,
          assignmentMatch[1].trim(),
          stripInlineComment(assignmentMatch[2]),
        );
      }
      idx += 1;
      continue;
    }

    // Nested python block
    const pythonBlockMatch = /^python\s*:(.*)$/i.exec(trimmed);
    if (pythonBlockMatch) {
      const { body: pyBody, endLineIndex } = getLogicalBodyAndEndLine(
        lines,
        idx,
        pythonBlockMatch[1],
      );
      processPythonBlockText(state, pyBody);
      idx = endLineIndex + 1;
      continue;
    }

    idx += 1;
  }
}
