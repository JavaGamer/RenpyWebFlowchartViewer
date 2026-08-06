import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
  VariableValue,
} from "../../pipelineTypes.ts";
import type { ScreenActionKind } from "../../../config/parserRules.ts";
import { isMenuKeywordTokenType, PARSER_TOKENS } from "../../parserTokens.ts";
import {
  addDynamicTargetDiagnostic,
  emitCallEdge,
  emitJumpEdge,
  parseDictLiteral,
  parseListLiteral,
  resolveCallContext,
  resolveStaticTargetExpression,
} from "../jumpCallHandler.ts";
import type { FlowEdge } from "../../../domain/index.ts";
import {
  extractNestedExpressionValue,
  extractScreenActionExpressions,
  extractStaticTargetsFromArgumentList,
  walkScreenActionExpression,
} from "./screenActionExtractor.ts";
import { extractLiteralTarget } from "../../tokenHandling.ts";
import { splitTopLevelArguments } from "./bracketMatcher.ts";

import { parsePythonBlock } from "../python/pythonAstParser.ts";

export function stripInlineComment(value: string): string {
  let result = "";
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let i = 0;
  while (i < value.length) {
    const char = value[i];
    if (activeQuote) {
      if (char === "\\") {
        result += char;
        if (i + 1 < value.length) {
          result += value[i + 1];
          i += 2;
          continue;
        }
      }
      if (tripleQuoted) {
        if (
          i + 2 < value.length &&
          char === activeQuote &&
          value[i + 1] === activeQuote &&
          value[i + 2] === activeQuote
        ) {
          result += char + value[i + 1] + value[i + 2];
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
      i + 2 < value.length &&
      (char === '"' || char === "'") &&
      value[i + 1] === char &&
      value[i + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      result += char + value[i + 1] + value[i + 2];
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
      const eol = value.indexOf("\n", i);
      if (eol === -1) {
        break;
      }
      i = eol;
      continue;
    }

    result += char;
    i += 1;
  }
  return result.trim();
}

/**
 * Analyzes direct Python code blocks or inline statements (e.g., `$ renpy.jump("lbl")`)
 * to resolve variable assignments and register control flow jumps/calls.
 */
export function processDirectRenpyBlockCalls(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  chapter: string,
  menuDepth: number,
  blockText: string,
) {
  interface PythonAssignmentEvent {
    kind: "assignment";
    index: number;
    variableName: string;
    assignedTarget: string | null;
    assignedDict?: Map<string, string> | null;
    assignedList?: string[] | null;
  }

  interface PythonRenpyCallEvent {
    kind: "call";
    index: number;
    callType: "jump" | "call";
    construct: "renpy.jump" | "renpy.call";
    targetExpression: string;
  }

  const events: Array<PythonAssignmentEvent | PythonRenpyCallEvent> = [];
  const parsedBlock = parsePythonBlock(blockText);

  for (const call of parsedBlock.directCalls) {
    events.push({
      kind: "call",
      index: call.startIndex,
      callType: call.functionName,
      construct: call.functionName === "jump" ? "renpy.jump" : "renpy.call",
      targetExpression: call.targetExpression,
    });
  }

  for (const assign of parsedBlock.assignments) {
    const expr = assign.valueExpression ?? "";
    const assignedTarget = assign.valueLiteral ??
      (expr ? resolveStaticTargetExpression(expr, scanState, state) : null);
    const assignedDict = assign.valueDict ??
      (expr ? parseDictLiteral(expr) : null);
    const assignedList = assign.valueList ??
      (expr ? parseListLiteral(expr) : null);
    events.push({
      kind: "assignment",
      index: assign.startIndex,
      variableName: assign.variable,
      assignedTarget,
      assignedDict,
      assignedList,
    });
  }

  events.sort((a, b) => a.index - b.index);

  for (const event of events) {
    if (event.kind === "assignment") {
      if (event.assignedTarget) {
        scanState.labelVariableLiteralTargets.set(
          event.variableName,
          event.assignedTarget,
        );
        scanState.labelVariableDictTargets.delete(event.variableName);
        scanState.labelVariableListTargets.delete(event.variableName);
      } else if (event.assignedDict) {
        scanState.labelVariableDictTargets.set(
          event.variableName,
          event.assignedDict,
        );
        scanState.labelVariableLiteralTargets.delete(event.variableName);
        scanState.labelVariableListTargets.delete(event.variableName);
      } else if (event.assignedList) {
        scanState.labelVariableListTargets.set(
          event.variableName,
          event.assignedList,
        );
        scanState.labelVariableLiteralTargets.delete(event.variableName);
        scanState.labelVariableDictTargets.delete(event.variableName);
      } else {
        scanState.labelVariableLiteralTargets.delete(event.variableName);
        scanState.labelVariableDictTargets.delete(event.variableName);
        scanState.labelVariableListTargets.delete(event.variableName);
      }
      continue;
    }

    const context = resolveCallContext(scanState, meta, menuDepth);
    const targets = extractStaticTargetsFromArgumentList(
      state,
      event.targetExpression,
      scanState,
    );
    if (targets.length === 0) {
      addDynamicTargetDiagnostic(
        state,
        chapter,
        event.construct,
        event.targetExpression,
        context.source ?? undefined,
      );
      continue;
    }

    for (const target of targets) {
      if (event.callType === "jump") {
        emitJumpEdge(state, scanState, target, context, false);
      } else {
        emitCallEdge(state, scanState, target, context);
      }
    }
  }
}

/**
 * Extracts action methods from Ren'Py screen blocks and generates corresponding flowchart edges.
 */
export function processDirectScreenActionCalls(
  state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  chapter: string,
  menuDepth: number,
  blockText: string,
  screenActionRuleMap: Map<string, ScreenActionKind>,
) {
  const seenCalls = new Set<string>();
  const screenHeaderMatch = /^screen\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(
    blockText.trimStart(),
  );
  const screenName = screenHeaderMatch ? screenHeaderMatch[1] : null;
  if (screenName) {
    state.globalScreens.add(screenName);
  }

  const emitActionCall = (
    construct: string,
    targetExpression: string,
    timeout?: FlowEdge["timeout"],
  ) => {
    const lower = construct.toLowerCase();

    if (lower === "nullaction") return;

    const activeNodeId = scanState.currentLabelId;

    if (lower === "setvariable") {
      const args = splitTopLevelArguments(targetExpression);
      if (args.length >= 2) {
        const rawVarArg = extractNestedExpressionValue(args[0]);
        const rawVar = extractLiteralTarget(rawVarArg) ??
          rawVarArg.trim().replace(/^['"]|['"]$/g, "");
        const valExpr = extractNestedExpressionValue(args[1]);

        let isPersistent = false;
        let varName = rawVar;
        if (varName.startsWith("persistent.")) {
          isPersistent = true;
          varName = varName.substring("persistent.".length);
        }

        const resolvedVal = resolveStaticTargetExpression(
          valExpr,
          scanState,
          state,
        );
        const literalVal = extractLiteralTarget(valExpr) ?? resolvedVal;

        if (isPersistent) {
          if (!scanState.persistentTargets) {
            scanState.persistentTargets = new Map();
          }
          if (!state.globalPersistentVariables) {
            state.globalPersistentVariables = new Map();
          }
          if (literalVal !== null) {
            scanState.persistentTargets.set(varName, literalVal);
            state.globalPersistentVariables.set(varName, literalVal);
          } else {
            scanState.persistentTargets.delete(varName);
            state.globalPersistentVariables.delete(varName);
          }
        } else {
          if (literalVal !== null) {
            scanState.labelVariableLiteralTargets.set(varName, literalVal);
          } else {
            scanState.labelVariableLiteralTargets.delete(varName);
          }
        }

        let mutationVal: VariableValue = literalVal;
        if (mutationVal === null || typeof mutationVal === "string") {
          const str = String(mutationVal ?? valExpr);
          if (str === "True" || str === "true") mutationVal = true;
          else if (str === "False" || str === "false") mutationVal = false;
          else if (str === "None" || str === "none") mutationVal = null;
          else if (/^-?\d+(\.\d+)?$/.test(str)) mutationVal = Number(str);
          else mutationVal = str;
        }

        if (activeNodeId) {
          if (!state.nodeMutations) state.nodeMutations = new Map();
          let muts = state.nodeMutations.get(activeNodeId);
          if (!muts) {
            muts = [];
            state.nodeMutations.set(activeNodeId, muts);
          }
          muts.push({
            variableName: varName,
            operator: "=",
            value: mutationVal,
            rawExpression: valExpr,
            nodeId: activeNodeId,
            lineNum: 0,
            isPersistent,
          });
        }
      }
      return;
    }

    if (lower === "togglevariable") {
      const args = splitTopLevelArguments(targetExpression);
      if (args.length >= 1) {
        const rawVarArg = extractNestedExpressionValue(args[0]);
        const rawVar = extractLiteralTarget(rawVarArg) ??
          rawVarArg.trim().replace(/^['"]|['"]$/g, "");
        const trueValExpr = args[1]
          ? extractNestedExpressionValue(args[1])
          : "True";
        const falseValExpr = args[2]
          ? extractNestedExpressionValue(args[2])
          : "False";

        let isPersistent = false;
        let varName = rawVar;
        if (varName.startsWith("persistent.")) {
          isPersistent = true;
          varName = varName.substring("persistent.".length);
        }

        const targetMap = isPersistent
          ? scanState.persistentTargets
          : scanState.labelVariableLiteralTargets;
        const currentVal = targetMap?.get(varName);
        const trueValStr = extractLiteralTarget(trueValExpr) ?? trueValExpr;
        const falseValStr = extractLiteralTarget(falseValExpr) ?? falseValExpr;

        const toggledValStr =
          (currentVal === trueValStr || currentVal === "true" ||
              currentVal === "True")
            ? falseValStr
            : trueValStr;

        if (isPersistent) {
          if (!scanState.persistentTargets) {
            scanState.persistentTargets = new Map();
          }
          if (!state.globalPersistentVariables) {
            state.globalPersistentVariables = new Map();
          }
          scanState.persistentTargets.set(varName, toggledValStr);
          state.globalPersistentVariables.set(varName, toggledValStr);
        } else {
          scanState.labelVariableLiteralTargets.set(varName, toggledValStr);
        }

        if (activeNodeId) {
          if (!state.nodeMutations) state.nodeMutations = new Map();
          let muts = state.nodeMutations.get(activeNodeId);
          if (!muts) {
            muts = [];
            state.nodeMutations.set(activeNodeId, muts);
          }
          muts.push({
            variableName: varName,
            operator: "toggle",
            value: toggledValStr,
            rawExpression: targetExpression,
            nodeId: activeNodeId,
            lineNum: 0,
            isPersistent,
          });
        }
      }
      return;
    }

    if (lower === "show" || lower === "hide") {
      const targets = extractStaticTargetsFromArgumentList(
        state,
        targetExpression,
        scanState,
      );
      for (const target of targets) {
        state.globalScreens.add(target);
      }
      return;
    }

    if (lower === "showmenu") {
      const targets = extractStaticTargetsFromArgumentList(
        state,
        targetExpression,
        scanState,
      );
      const context = resolveCallContext(scanState, meta, menuDepth);
      for (const target of targets) {
        if (state.canonicalLabelIdByName.has(target)) {
          emitJumpEdge(state, scanState, target, context, false, timeout);
        } else {
          state.globalScreens.add(target);
        }
      }
      return;
    }

    if (
      lower === "confirm" || lower === "if" ||
      lower === "selectedif" || lower === "sensitiveif" || lower === "showif"
    ) {
      return;
    }

    const callType = screenActionRuleMap.get(lower);
    if (!callType) return;

    const context = resolveCallContext(scanState, meta, menuDepth);
    const targets = extractStaticTargetsFromArgumentList(
      state,
      targetExpression,
      scanState,
    );

    if (targets.length === 0) {
      addDynamicTargetDiagnostic(
        state,
        chapter,
        construct,
        targetExpression,
        context.source ?? undefined,
      );
      return;
    }

    for (const target of targets) {
      const dedupeKey = [
        lower,
        target,
        context.source ?? "",
        timeout?.isTimeout
          ? `timeout:${
            timeout.durationSeconds === undefined
              ? "unknown"
              : timeout.durationSeconds
          }`
          : "normal",
      ].join("|");
      if (seenCalls.has(dedupeKey)) continue;
      seenCalls.add(dedupeKey);

      if (callType === "jump") {
        emitJumpEdge(state, scanState, target, context, false, timeout);
      } else {
        emitCallEdge(state, scanState, target, context, undefined, timeout);
      }
    }
  };

  for (const extracted of extractScreenActionExpressions(blockText)) {
    walkScreenActionExpression(
      extracted.expression,
      (construct, targetExpression) =>
        emitActionCall(construct, targetExpression, extracted.timeout),
    );
  }
}

/**
 * Resets wait flags to prevent dangling parsing rules on malformed script streams.
 */
export function resetStaleWaitFlags(
  scanState: ParseScanState,
  type: number,
): void {
  if (
    type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline
  ) return;
  if (type === PARSER_TOKENS.kwLabel || isMenuKeywordTokenType(type)) {
    scanState.waitForJumpTarget = false;
    scanState.waitForJumpExpressionTarget = false;
    scanState.waitForCallTarget = false;
    scanState.waitForCallExpressionTarget = false;
    scanState.waitForMenuNameForId = null;
    return;
  }
  const isJumpTargetTokenCheck = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier) ||
    Boolean(scanState.waitForJumpExpressionTarget);

  if (scanState.waitForJumpTarget && !isJumpTargetTokenCheck) {
    if (
      PARSER_TOKENS.kwExpression !== undefined &&
      type === PARSER_TOKENS.kwExpression
    ) {
      scanState.waitForJumpExpressionTarget = true;
    } else if (
      (PARSER_TOKENS.metaItemAccess !== undefined &&
        type === PARSER_TOKENS.metaItemAccess) ||
      (PARSER_TOKENS.metaFunctionCall !== undefined &&
        type === PARSER_TOKENS.metaFunctionCall)
    ) {
      // Keep waiting for target
    } else {
      scanState.waitForJumpTarget = false;
      scanState.waitForJumpExpressionTarget = false;
    }
  }
  const isCallTargetTokenCheck = type === PARSER_TOKENS.entityFunctionName ||
    (PARSER_TOKENS.entityIdentifier !== undefined &&
      type === PARSER_TOKENS.entityIdentifier) ||
    (PARSER_TOKENS.kwExpression !== undefined &&
      type === PARSER_TOKENS.kwExpression) ||
    ((PARSER_TOKENS as unknown as Record<string, number | undefined>)
          .kwPass !== undefined &&
      type ===
        (PARSER_TOKENS as unknown as Record<string, number | undefined>)
          .kwPass) ||
    (PARSER_TOKENS.metaItemAccess !== undefined &&
      type === PARSER_TOKENS.metaItemAccess) ||
    (PARSER_TOKENS.metaFunctionCall !== undefined &&
      type === PARSER_TOKENS.metaFunctionCall);

  if (scanState.waitForCallTarget && !isCallTargetTokenCheck) {
    scanState.waitForCallTarget = false;
    scanState.waitForCallExpressionTarget = false;
  }
  if (
    scanState.waitForMenuNameForId && type !== PARSER_TOKENS.entityFunctionName
  ) {
    scanState.waitForMenuNameForId = null;
  }
}
