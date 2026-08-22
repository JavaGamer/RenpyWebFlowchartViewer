import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
  VariableMutation,
  VariableValue,
} from "../pipelineTypes.ts";
import { extractLiteralTarget } from "../handlers/jumpCallHandler.ts";
import {
  processDirectRenpyBlockCalls,
  processDirectScreenActionCalls,
} from "../handlers/screen/screenHandlerEntry.ts";
import type { ScreenActionKind } from "../../config/parserRules.ts";
import { parsePythonBlock } from "../../domain/index.ts";

export function parseAndRecordVariableMutation(
  state: ParseGraphState,
  scanState: ParseScanState,
  statement: string,
  lineNum: number,
): void {
  const targetNodeId = scanState.currentLabelId;
  if (!targetNodeId) return;

  const parsed = parsePythonBlock(statement);
  if (parsed.assignments.length > 0) {
    if (!state.nodeMutations) {
      state.nodeMutations = new Map();
    }
    let nodeMutList = state.nodeMutations.get(targetNodeId);
    if (!nodeMutList) {
      nodeMutList = [];
      state.nodeMutations.set(targetNodeId, nodeMutList);
    }

    const opMatch = /(?<![<>=!])(\+=|-=|=)(?![=])/.exec(statement);
    const op = (opMatch ? opMatch[1] : "=") as "=" | "+=" | "-=";

    for (const assign of parsed.assignments) {
      const varName = assign.variable;
      const isPersist = varName.startsWith("persistent.");
      const rawRhs = assign.valueExpression ?? "";
      let parsedValue: VariableValue = assign.valueLiteral ?? null;
      if (parsedValue === null && rawRhs) {
        const lower = rawRhs.toLowerCase();
        if (lower === "true") parsedValue = true;
        else if (lower === "false") parsedValue = false;
        else if (!isNaN(Number(rawRhs)) && rawRhs.trim() !== "") {
          parsedValue = Number(rawRhs);
        } else {
          parsedValue = rawRhs;
        }
      }

      const mutation: VariableMutation = {
        variableName: varName,
        operator: op,
        value: parsedValue,
        rawExpression: rawRhs,
        nodeId: targetNodeId,
        lineNum,
        isPersistent: isPersist,
      };
      nodeMutList.push(mutation);

      if (isPersist) {
        if (!scanState.persistentTargets) {
          scanState.persistentTargets = new Map();
        }
        if (parsedValue !== null) {
          scanState.persistentTargets.set(varName, String(parsedValue));
        }
      } else {
        if (parsedValue !== null) {
          scanState.labelVariableLiteralTargets.set(
            varName,
            String(parsedValue),
          );
        }
      }
    }
    return;
  }

  // Fallback regex for augmented assignments or single statement lines
  const assignMatch =
    /^([A-Za-z_][A-Za-z0-9_.]*)\s*(?<![<>=!])(\+=|-=|=)(?![=])\s*(.*)$/.exec(
      statement.trim(),
    );
  if (!assignMatch) return;

  const varName = assignMatch[1]!.trim();
  const op = assignMatch[2]! as "=" | "+=" | "-=";
  const rawRhs = assignMatch[3]!.trim();
  const isPersist = varName.startsWith("persistent.");

  const literalVal = extractLiteralTarget(rawRhs);
  let parsedValue: VariableValue = literalVal;
  if (literalVal === null) {
    const lower = rawRhs.toLowerCase();
    if (lower === "true") parsedValue = true;
    else if (lower === "false") parsedValue = false;
    else if (!isNaN(Number(rawRhs)) && rawRhs.trim() !== "") {
      parsedValue = Number(rawRhs);
    } else {
      parsedValue = rawRhs;
    }
  }

  const mutation: VariableMutation = {
    variableName: varName,
    operator: op,
    value: parsedValue,
    rawExpression: rawRhs,
    nodeId: targetNodeId,
    lineNum,
    isPersistent: isPersist,
  };

  if (!state.nodeMutations) {
    state.nodeMutations = new Map();
  }
  let nodeMutList = state.nodeMutations.get(targetNodeId);
  if (!nodeMutList) {
    nodeMutList = [];
    state.nodeMutations.set(targetNodeId, nodeMutList);
  }
  nodeMutList.push(mutation);

  if (isPersist) {
    if (!scanState.persistentTargets) scanState.persistentTargets = new Map();
    if (parsedValue !== null) {
      scanState.persistentTargets.set(varName, String(parsedValue));
    }
  } else {
    if (parsedValue !== null) {
      scanState.labelVariableLiteralTargets.set(varName, String(parsedValue));
    }
  }
}

export function handleDollarSignToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  lineText: string,
  lineNum: number,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  const rawText = lineText.trim();
  const cleanStmt = rawText.startsWith("$") ? rawText.slice(1).trim() : rawText;
  parseAndRecordVariableMutation(state, scanState, cleanStmt, lineNum);
  processDirectRenpyBlockCalls(
    state,
    scanState,
    meta,
    chapter,
    menuDepth,
    cleanStmt,
  );
}

export function handlePythonBlockToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  val: () => string,
  lineNum: number,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  const blockText = val();
  parseAndRecordVariableMutation(state, scanState, blockText, lineNum);
  for (const pyLine of blockText.split(/\r?\n/)) {
    const trimmed = pyLine.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("if ") ||
      trimmed.startsWith("elif ") ||
      trimmed.startsWith("while ") ||
      trimmed.startsWith("for ")
    ) {
      const cleanHeader = trimmed
        .replace(/:$/, "")
        .replace(/^(if|elif|while|for)\s+/, "");
      if (!state.allConditionalExpressions) {
        state.allConditionalExpressions = [];
      }
      state.allConditionalExpressions.push({
        expression: cleanHeader,
        branchKind: trimmed.split(/\s+/)[0]!,
        chapter,
        sourceId: scanState.currentLabelId ?? undefined,
      });
    }
  }
  processDirectRenpyBlockCalls(
    state,
    scanState,
    meta,
    chapter,
    menuDepth,
    blockText,
  );
}

export function handleScreenBlockToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  val: () => string,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
  screenActionRuleMap: Map<string, ScreenActionKind>,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  processDirectScreenActionCalls(
    state,
    scanState,
    meta,
    chapter,
    menuDepth,
    val(),
    screenActionRuleMap,
  );
}
