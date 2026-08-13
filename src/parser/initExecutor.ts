import type {
  ParseGraphState,
  ResolveTargetScanState,
  VariableValue,
} from "./pipelineTypes.ts";
import {
  extractLiteralTarget,
  parseDictLiteral,
  parseListLiteral,
  resolveStaticTargetExpression,
} from "./handlers/jumpCallHandler.ts";
import { stripInlineComment } from "./handlers/screen/screenHandlerEntry.ts";
import type { InitItem } from "./initScanner.ts";
import {
  getLogicalBodyAndEndLine,
  getLogicalExpressionAndEndLine,
} from "./initScanner.ts";

export function processAssignment(
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
    const wasAdded = !state.globalCharacters.has(variableName);
    state.globalCharacters.add(variableName);
    return wasAdded;
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
        const existingDict = state.globalLabelVariableDictTargets.get(
          variableName,
        );
        const existingStr = existingDict
          ? JSON.stringify(Array.from(existingDict.entries()))
          : null;
        const newStr = JSON.stringify(Array.from(dictVal.entries()));
        if (existingStr !== newStr) {
          state.globalLabelVariableDictTargets.set(variableName, dictVal);
          valueChanged = true;
        }
      } else {
        const listVal = parseListLiteral(cleanExpr);
        if (listVal !== null) {
          const existingList = state.globalLabelVariableListTargets.get(
            variableName,
          );
          const existingStr = existingList
            ? JSON.stringify(existingList)
            : null;
          const newStr = JSON.stringify(listVal);
          if (existingStr !== newStr) {
            state.globalLabelVariableListTargets.set(variableName, listVal);
            valueChanged = true;
          }
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

import { parsePythonBlock } from "./handlers/python/pythonAstParser.ts";

export function processPythonBlockText(
  state: ParseGraphState,
  body: string,
  priority: number = 0,
  filePath: string = "",
  blockLineIndex: number = 0,
): boolean {
  let blockChanged = false;
  const parsed = parsePythonBlock(body);

  for (const assign of parsed.assignments) {
    if (!assign.variable || !assign.valueExpression) continue;
    const changed = processAssignment(
      state,
      assign.variable,
      stripInlineComment(assign.valueExpression),
      "python",
      assign.variable.startsWith("persistent."),
      priority,
      filePath,
      blockLineIndex,
    );
    if (changed) blockChanged = true;
  }
  return blockChanged;
}

export function processInitBlockText(
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
      /^(define|default)(?:\s+([+-]?\d+))?\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=(.*)$/i
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

    // Nested dollar assignment ($ var = val)
    const dollarMatch =
      /^[ \t]*\$\s*([A-Za-z_][A-Za-z0-9_.]*)(?:\s*:[^=]+)?\s*=\s*(.*)$/
        .exec(trimmed);
    if (dollarMatch) {
      const varName = dollarMatch[1].trim();
      const isPersist = varName.startsWith("persistent.");
      const { body: expression, endLineIndex } = getLogicalExpressionAndEndLine(
        lines,
        idx,
        dollarMatch[2],
      );
      const changed = processAssignment(
        state,
        varName,
        stripInlineComment(expression),
        isPersist ? "persistent" : "python",
        isPersist,
        priority,
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

export function executeInitItemsPass(
  state: ParseGraphState,
  items: InitItem[],
): boolean {
  let stateChanged = false;
  for (const item of items) {
    if (item.type === "screen" && item.variableName) {
      if (!state.globalScreens.has(item.variableName)) {
        state.globalScreens.add(item.variableName);
        stateChanged = true;
      }
    } else if (
      (item.type === "define_default" || item.type === "dollar_assignment") &&
      item.variableName &&
      item.expression
    ) {
      const cleanExpr = stripInlineComment(item.expression).trim();
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
      const changed = processPythonBlockText(
        state,
        item.body,
        item.priority,
        item.filePath,
        item.lineIndex,
      );
      if (changed) stateChanged = true;
    } else if (item.type === "init_block" && item.body) {
      const changed = processInitBlockText(
        state,
        item.body,
        item.priority,
        item.filePath,
        item.lineIndex,
      );
      if (changed) stateChanged = true;
    }
  }
  return stateChanged;
}
