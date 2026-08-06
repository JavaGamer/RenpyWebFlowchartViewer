import type {
  ParseGraphState,
  ParseInputFile,
  ResolveTargetScanState,
  VariableValue,
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
          kind: "python",
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
          kind: "python",
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
          kind: "python",
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
          kind: "python",
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
      const dollarMatch = /^\$\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(
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

      idx += 1;
    }
  }

  // Sort by priority, then statement kind (define < default < python), then file name, then line index
  items.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const subPriorityA = a.kind === "define"
      ? 0
      : a.kind === "python" || a.kind === "persistent"
      ? 0.5
      : 1;
    const subPriorityB = b.kind === "define"
      ? 0
      : b.kind === "python" || b.kind === "persistent"
      ? 0.5
      : 1;
    if (subPriorityA !== subPriorityB) {
      return subPriorityA - subPriorityB;
    }
    const fileComp = compareDeterministicStrings(a.filePath, b.filePath);
    if (fileComp !== 0) {
      return fileComp;
    }
    return a.lineIndex - b.lineIndex;
  });

  if (!state.globalPersistentVariables) {
    state.globalPersistentVariables = new Map();
  }
  if (!state.initVariables) {
    state.initVariables = new Map();
  }

  // Execute initialization items using a multi-pass fixed-point loop (up to 5 passes)
  const maxPasses = 5;
  let stateChanged = true;
  let pass = 0;

  while (stateChanged && pass < maxPasses) {
    stateChanged = false;
    pass += 1;

    for (const item of items) {
      if (item.type === "screen" && item.variableName) {
        state.globalScreens.add(item.variableName);
      } else if (
        (item.type === "define_default" || item.type === "dollar_assignment") &&
        item.variableName &&
        item.expression
      ) {
        const cleanExpr = stripPythonComments(item.expression).trim();
        const changed = processAssignment(
          state,
          item.variableName,
          cleanExpr,
          item.kind,
          item.isPersistent ?? item.variableName.startsWith("persistent."),
          item.priority,
          item.filePath,
          item.lineIndex,
        );
        if (changed) stateChanged = true;
      } else if (item.type === "python_block" && item.body) {
        processPythonBlockText(state, item.body);
      } else if (item.type === "init_block" && item.body) {
        processInitBlockText(state, item.body);
      }
    }
  }
}

function processAssignment(
  state: ParseGraphState,
  variableName: string,
  rhsExpression: string,
  kind: "define" | "default" | "python" | "persistent" = "python",
  isPersistent: boolean = false,
  priority: number = 0,
  filePath: string = "",
  lineIndex: number = 0,
): boolean {
  if (!state.globalPersistentVariables) {
    state.globalPersistentVariables = new Map();
  }
  if (!state.initVariables) {
    state.initVariables = new Map();
  }

  // Respect 'default' semantics: do not overwrite if already defined at same or higher priority
  const existingDesc = state.initVariables.get(variableName);
  if (kind === "default" && existingDesc) {
    if (existingDesc.priority >= priority) {
      return false;
    }
  }

  const cleanExpr = rhsExpression.trim();
  if (/Character\s*\(/i.test(cleanExpr)) {
    state.globalCharacters.add(variableName);
    return true;
  }

  const literalVal = extractLiteralTarget(cleanExpr);
  let parsedVal: VariableValue = literalVal;
  if (literalVal === null) {
    const lower = cleanExpr.toLowerCase();
    if (lower === "true") parsedVal = true;
    else if (lower === "false") parsedVal = false;
    else if (!isNaN(Number(cleanExpr)) && cleanExpr.trim() !== "") {
      parsedVal = Number(cleanExpr);
    } else {
      parsedVal = cleanExpr;
    }
  }

  const isPersist = isPersistent || variableName.startsWith("persistent.");
  if (!state.globalPersistentVariables) {
    state.globalPersistentVariables = new Map();
  }
  const targetMap = isPersist
    ? state.globalPersistentVariables
    : state.globalLabelVariableLiteralTargets;

  const prevVal = targetMap.get(variableName);
  let valueChanged = false;

  if (literalVal !== null) {
    if (prevVal !== literalVal) {
      targetMap.set(variableName, literalVal);
      valueChanged = true;
    }
  } else {
    const mockScanState: ResolveTargetScanState = {
      labelVariableLiteralTargets: state.globalLabelVariableLiteralTargets,
      labelVariableDictTargets: state.globalLabelVariableDictTargets,
      labelVariableListTargets: state.globalLabelVariableListTargets,
      persistentTargets: new Map(
        Array.from(state.globalPersistentVariables.entries()).map(([k, v]) => [
          k,
          String(v),
        ]),
      ),
    };

    const staticResolved = resolveStaticTargetExpression(
      cleanExpr,
      mockScanState,
      state,
    );
    if (staticResolved !== null) {
      if (prevVal !== staticResolved) {
        targetMap.set(variableName, staticResolved);
        valueChanged = true;
      }
    } else {
      const dictVal = parseDictLiteral(cleanExpr);
      if (dictVal !== null) {
        state.globalLabelVariableDictTargets.set(variableName, dictVal);
        valueChanged = true;
      } else {
        const listVal = parseListLiteral(cleanExpr);
        if (listVal !== null) {
          state.globalLabelVariableListTargets.set(variableName, listVal);
          valueChanged = true;
        } else if (prevVal !== parsedVal) {
          targetMap.set(variableName, parsedVal);
          valueChanged = true;
        }
      }
    }
  }

  // Record variable descriptor
  const rawVal = targetMap.get(variableName) ?? parsedVal;
  state.initVariables.set(variableName, {
    name: variableName,
    rawExpression: cleanExpr,
    value: rawVal,
    kind,
    priority,
    filePath,
    lineIndex,
    isPersistent: isPersist,
  });

  return valueChanged;
}

function processPythonBlockText(
  state: ParseGraphState,
  body: string,
  priority: number = 0,
  filePath: string = "",
  blockLineIndex: number = 0,
): boolean {
  const lines = body.split(/\r?\n/);
  let idx = 0;
  let blockChanged = false;
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
      const changed = processAssignment(
        state,
        varName,
        stripInlineComment(expression),
        "python",
        varName.startsWith("persistent."),
        priority,
        filePath,
        blockLineIndex + idx,
      );
      if (changed) blockChanged = true;
      idx = endLineIndex + 1;
      continue;
    }
    idx += 1;
  }
  return blockChanged;
}

function processInitBlockText(
  state: ParseGraphState,
  body: string,
  priority: number = 0,
  filePath: string = "",
  blockLineIndex: number = 0,
): boolean {
  const lines = body.split(/\r?\n/);
  let idx = 0;
  let blockChanged = false;
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
      const kind = defineMatch[1].toLowerCase() as "define" | "default";
      const itemPriority = defineMatch[2]
        ? priority + parseInt(defineMatch[2], 10)
        : priority;
      const varName = defineMatch[3].trim();
      const { body: expression, endLineIndex } = getLogicalExpressionAndEndLine(
        lines,
        idx,
        defineMatch[4],
      );
      const changed = processAssignment(
        state,
        varName,
        stripInlineComment(expression),
        kind,
        varName.startsWith("persistent."),
        itemPriority,
        filePath,
        blockLineIndex + idx,
      );
      if (changed) blockChanged = true;
      idx = endLineIndex + 1;
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
      const changed = processPythonBlockText(
        state,
        pyBody,
        priority,
        filePath,
        blockLineIndex + idx,
      );
      if (changed) blockChanged = true;
      idx = endLineIndex + 1;
      continue;
    }

    idx += 1;
  }
  return blockChanged;
}
