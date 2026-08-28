import {
  BREAK_REGEX,
  CONTINUE_REGEX,
  TIMED_CHOICE_REGEX,
} from "../utils/lineUtils.ts";
import { handleCallScreenStatement } from "../handlers/screenFlowHandler.ts";
import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import { addEdge, addIncoming, addOutgoing } from "../graphMutations.ts";
import {
  emitJumpEdge,
  resolveCallContext,
} from "../handlers/jumpCallHandler.ts";
import {
  evaluatePythonAstExpression,
  type SourceLocation,
} from "../../domain/index.ts";

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
    scanState.currentLabelId !== null &&
    lineNum !== scanState.lastProcessedCustomLineNum
  ) {
    const trimmed = lineText.trim();
    const callScreenExprMatch = /^call\s+screen\s+expression\s+(.+)$/i.exec(
      trimmed,
    );
    const callScreenMatch = /^call\s+screen\s+([A-Za-z0-9_]+)/i.exec(trimmed);

    if (callScreenExprMatch) {
      scanState.lastProcessedCustomLineNum = lineNum;
      const rawExpr = callScreenExprMatch[1]!.trim();
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
        const context = resolveCallContext(scanState, meta, menuDepth);
        const timeout = {
          isTimeout: true as const,
          durationSeconds,
        };
        emitJumpEdge(state, scanState, target, context, false, timeout);
      } else if (
        /^(?:\$\s*)?(?:gameover|renpy\.(?:full_restart|quit|utter_restart|jump_out_of_context|pop_call))\b/i
          .test(trimmed)
      ) {
        scanState.lastProcessedCustomLineNum = lineNum;
        scanState.labelHasExplicitExit = true;
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
