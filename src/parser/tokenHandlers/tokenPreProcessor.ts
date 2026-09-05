import {
  BREAK_REGEX,
  CONTINUE_REGEX,
  PLACEHOLDER_REGEX,
  TIMED_CHOICE_REGEX,
} from "../utils/lineUtils.ts";
import { handleCallScreenStatement } from "../handlers/screenFlowHandler.ts";
import type {
  ParseGraphState,
  ParserVariant,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import { addEdge, addIncoming, addOutgoing } from "../graphMutations.ts";
import { emitJumpEdge } from "../handlers/jumpCallHandler.ts";
import { menuAtDepth } from "../scanTransitions.ts";
import {
  evaluatePythonAstExpression,
  type SourceLocation,
} from "../../domain/index.ts";

function extractCallScreenExpression(lineText: string): string | null {
  const match = /^call\s+screen\s+expression\s+/i.exec(lineText.trim());
  if (!match) return null;
  const startIdx = match.index + match[0].length;
  const clean = lineText.trim();
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = startIdx; i < clean.length; i++) {
    const ch = clean[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < clean.length) i++;
      else if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      const rest = clean.slice(i);
      if (/^\s+(?:with|pass|as)\b/i.test(rest)) {
        return clean.slice(startIdx, i).trim();
      }
    }
  }
  return clean.slice(startIdx).trim();
}

export function flushPendingTimedChoice(
  state: ParseGraphState,
  scanState: ParseScanState,
): void {
  if (scanState.pendingTimedChoice) {
    const pending = scanState.pendingTimedChoice;
    scanState.pendingTimedChoice = null;
    if (scanState.currentLabelId) {
      emitJumpEdge(
        state,
        scanState,
        pending.target,
        {
          isInOption: false,
          source: scanState.currentLabelId,
          optionText: pending.title ?? null,
          sourceLocation: pending.sourceLocation,
        },
        false,
        {
          isTimeout: true,
          durationSeconds: pending.durationSeconds,
        },
      );
    }
  }
}

export function isNonBranchingStagingStatement(
  lineText: string,
  variant?: ParserVariant,
): boolean {
  const trimmed = lineText.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return true;
  }
  if (
    /^(?:play|queue|stop|voice|show|hide|with|window|scene|pause|camera|nvl|outfit|accessory|pass)\b/i
      .test(trimmed)
  ) {
    return true;
  }
  if (
    variant === "st" &&
    /^(?:swap|morph|clone|body|exspirit|possess|scry)\b/i.test(trimmed)
  ) {
    return true;
  }
  if (trimmed.startsWith("$")) {
    const pyCode = trimmed.slice(1).trim();
    const isBranchingPy =
      /^(?:renpy\.(?:jump|call|full_restart|quit|utter_restart|jump_out_of_context|pop_call)|gameover|break|continue|return)\b/i
        .test(pyCode);
    return !isBranchingPy;
  }
  return false;
}

export function handlePreTokenLineStatements(
  state: ParseGraphState,
  scanState: ParseScanState,
  lineText: string,
  lineNum: number,
  chapter: string,
  meta: TokenMetaFlags,
  menuDepth: number,
  sourceLocation?: SourceLocation,
): void {
  if (scanState.currentLabelId && sourceLocation) {
    const activeNode = state.nodeMap.get(scanState.currentLabelId);
    if (activeNode) {
      if (!activeNode.sourceLocation) {
        activeNode.sourceLocation = sourceLocation;
      } else {
        activeNode.sourceLocation = {
          ...activeNode.sourceLocation,
          end: sourceLocation.end,
        };
      }
    }
  }

  if (
    scanState.pendingTimedChoice &&
    lineNum !== scanState.pendingTimedChoice.lineNum
  ) {
    const isMenu = /^\s*menu\b/i.test(lineText);
    if (
      !isMenu &&
      !isNonBranchingStagingStatement(lineText, scanState.parserVariant)
    ) {
      flushPendingTimedChoice(state, scanState);
    }
  }

  if (
    scanState.currentLabelId !== null &&
    lineNum !== scanState.lastProcessedCustomLineNum
  ) {
    const trimmed = lineText.trim();
    const callScreenExprStr = extractCallScreenExpression(trimmed);
    const callScreenMatch = /^call\s+screen\s+([A-Za-z0-9_]+)/i.exec(trimmed);

    if (callScreenExprStr) {
      scanState.lastProcessedCustomLineNum = lineNum;
      const rawExpr = callScreenExprStr;
      const env: Record<string, unknown> = {};
      if (state.initVariables) {
        for (const [k, desc] of state.initVariables.entries()) {
          env[k] = desc.value;
        }
      }
      if (state.globalLabelVariableLiteralTargets) {
        for (
          const [k, v] of state.globalLabelVariableLiteralTargets.entries()
        ) {
          env[k] = v;
        }
      }
      if (scanState.labelVariableLiteralTargets) {
        for (const [k, v] of scanState.labelVariableLiteralTargets.entries()) {
          env[k] = v;
        }
      }
      const evalRes = evaluatePythonAstExpression(rawExpr, env);
      const candidates = evalRes.stringCandidates.length > 0
        ? evalRes.stringCandidates
        : (evalRes.value ? [String(evalRes.value)] : []);
      if (candidates.length > 0) {
        for (const cand of candidates) {
          handleCallScreenStatement(
            state,
            scanState,
            cand,
            chapter,
            lineNum,
            sourceLocation,
          );
        }
      } else {
        handleCallScreenStatement(
          state,
          scanState,
          rawExpr,
          chapter,
          lineNum,
          sourceLocation,
        );
      }
    } else if (callScreenMatch) {
      scanState.lastProcessedCustomLineNum = lineNum;
      handleCallScreenStatement(
        state,
        scanState,
        callScreenMatch[1]!,
        chapter,
        lineNum,
        sourceLocation,
      );
    } else {
      TIMED_CHOICE_REGEX.lastIndex = 0;
      const timedChoiceMatch = TIMED_CHOICE_REGEX.exec(trimmed);
      if (timedChoiceMatch) {
        scanState.lastProcessedCustomLineNum = lineNum;
        const durationSeconds = parseFloat(timedChoiceMatch[1]!);
        const target = timedChoiceMatch[2]!;
        const rawTitle = timedChoiceMatch[3] ?? timedChoiceMatch[4] ??
          timedChoiceMatch[5];
        const title = rawTitle
          ? rawTitle.replace(/\\(["'\\])/g, "$1").trim() || undefined
          : undefined;
        scanState.pendingTimedChoice = {
          durationSeconds,
          target,
          title,
          lineNum,
          sourceLocation,
        };
      } else if (
        /^(?:\$\s*)?(?:gameover|renpy\.(?:full_restart|quit|utter_restart|jump_out_of_context|pop_call))\b/i
          .test(trimmed) ||
        (scanState.parserVariant === "st" && PLACEHOLDER_REGEX.test(trimmed))
      ) {
        scanState.lastProcessedCustomLineNum = lineNum;
        scanState.labelHasExplicitExit = true;
        if (
          scanState.parserVariant === "st" && PLACEHOLDER_REGEX.test(trimmed)
        ) {
          const activeNode = scanState.currentLabelId
            ? state.nodeMap.get(scanState.currentLabelId)
            : undefined;
          if (activeNode) {
            activeNode.isTerminalOutcome = true;
          }
        }
        if (meta.hasMenuOptionBlock) {
          const menu = menuAtDepth(scanState.menuStack, menuDepth);
          if (menu && menu.options && menu.options.length > 0) {
            const lastOpt = menu.options[menu.options.length - 1];
            if (lastOpt) {
              lastOpt.hasExit = true;
            }
          }
        } else if (scanState.pendingMenuFallthrough.length > 0) {
          scanState.pendingMenuFallthrough = [];
        }
      } else if (BREAK_REGEX.test(trimmed)) {
        scanState.lastProcessedCustomLineNum = lineNum;
      } else if (CONTINUE_REGEX.test(trimmed)) {
        scanState.lastProcessedCustomLineNum = lineNum;
        const loopContext = [...scanState.conditionalDecisionStack]
          .reverse()
          .find((c) => c.branchKind === "while" || c.branchKind === "for");
        if (loopContext && scanState.currentLabelId) {
          addEdge(state, {
            id:
              `seq_${scanState.currentLabelId}__${loopContext.decisionNodeId}_continue`,
            source: scanState.currentLabelId,
            target: loopContext.decisionNodeId,
            kind: "sequence",
            label: "continue",
            sourceLocation,
          });
          addOutgoing(state, scanState.currentLabelId, "sequence");
          addIncoming(state, loopContext.decisionNodeId, "sequence");
        }
      }
    }
  }
}
