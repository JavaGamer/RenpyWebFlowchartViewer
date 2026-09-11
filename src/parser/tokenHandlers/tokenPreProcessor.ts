import {
  BREAK_REGEX,
  CONTINUE_REGEX,
  TIMED_CHOICE_REGEX,
} from "../utils/lineUtils.ts";
import { handleCallScreenStatement } from "../handlers/screenFlowHandler.ts";
import type {
  MutationOperator,
  ParseGraphState,
  ParserVariant,
  ParseScanState,
  TokenMetaFlags,
  VariableValue,
} from "../pipelineTypes.ts";
import { addEdge, addIncoming, addOutgoing } from "../graphMutations.ts";
import {
  emitCallEdge,
  emitJumpEdge,
  resolveCallContext,
} from "../handlers/jumpCallHandler.ts";
import { menuAtDepth } from "../scanTransitions.ts";
import {
  evaluatePythonAstExpression,
  type SourceLocation,
} from "../../domain/index.ts";
import {
  type BranchStatementRule,
  getParserVariantPlugin,
  type TerminalStatementRule,
} from "../../config/parserRules.ts";

function findMatchingTerminalRule(
  trimmed: string,
  variant?: ParserVariant,
): { matched: boolean; rule?: TerminalStatementRule } | null {
  if (
    /^(?:\$\s*)?(?:gameover|renpy\.(?:full_restart|quit|utter_restart|jump_out_of_context|pop_call))\b/i
      .test(trimmed)
  ) {
    return { matched: true };
  }
  const plugin = getParserVariantPlugin(variant);
  const rule = plugin.terminalStatements?.find((r) => {
    r.pattern.lastIndex = 0;
    return r.pattern.test(trimmed);
  });
  if (rule) {
    return { matched: true, rule };
  }
  return null;
}

function findMatchingBranchRule(
  trimmed: string,
  variant?: ParserVariant,
): { rule: BranchStatementRule; target: string } | null {
  const plugin = getParserVariantPlugin(variant);
  if (!plugin.branchStatements) return null;
  // Cap length to prevent ReDoS on massive lines
  const bounded = trimmed.slice(0, 512);
  for (const rule of plugin.branchStatements) {
    const pattern = typeof rule.pattern === "string"
      ? ((rule as unknown as { pattern: RegExp }).pattern = new RegExp(
        rule.pattern,
      ))
      : rule.pattern;
    pattern.lastIndex = 0;
    const match = pattern.exec(bounded);
    if (match && match.index === 0) {
      const groupIdx = rule.targetGroup ?? 1;
      const raw = match[groupIdx]?.trim();
      const rawTarget = raw?.replace(/^["']|["']$/g, "").trim();
      if (rawTarget && /^(\.)?[A-Za-z_][A-Za-z0-9_.]*$/.test(rawTarget)) {
        return { rule, target: rawTarget };
      }
    }
  }
  return null;
}

function findMatchingChoiceDirective(
  trimmed: string,
  variant?: ParserVariant,
): { target: string; durationSeconds?: number; title?: string } | null {
  const plugin = getParserVariantPlugin(variant);
  if (plugin.choiceDirectives && plugin.choiceDirectives.length > 0) {
    for (const rule of plugin.choiceDirectives) {
      const pattern = typeof rule.pattern === "string"
        ? ((rule as unknown as { pattern: RegExp }).pattern = new RegExp(
          rule.pattern,
          "i",
        ))
        : rule.pattern;
      pattern.lastIndex = 0;
      const match = pattern.exec(trimmed);
      if (match) {
        const target = match[rule.targetGroup]?.trim();
        if (target) {
          const cleanTarget = target.replace(/^["']|["']$/g, "").trim();
          const duration = rule.durationGroup && match[rule.durationGroup]
            ? parseFloat(match[rule.durationGroup]!)
            : undefined;
          const rawTitle = rule.captionGroup
            ? match[rule.captionGroup]
            : undefined;
          const title = rawTitle
            ? rawTitle
              .replace(/\s*#.*$/, "")
              .trim()
              .replace(/^["']|["']$/g, "")
              .replace(/\\(["'\\])/g, "$1")
              .trim() || undefined
            : undefined;
          return {
            target: cleanTarget,
            durationSeconds: Number.isFinite(duration) ? duration : undefined,
            title,
          };
        }
      }
    }
  }
  TIMED_CHOICE_REGEX.lastIndex = 0;
  const timedChoiceMatch = TIMED_CHOICE_REGEX.exec(trimmed);
  if (timedChoiceMatch) {
    const durationSeconds = parseFloat(timedChoiceMatch[1]!);
    const target = timedChoiceMatch[2]!;
    const rawTitle = timedChoiceMatch[3] ?? timedChoiceMatch[4] ??
      timedChoiceMatch[5];
    const title = rawTitle
      ? rawTitle.replace(/\\(["'\\])/g, "$1").trim() || undefined
      : undefined;
    return { durationSeconds, target, title };
  }
  return null;
}

function findMatchingVariableMutation(
  trimmed: string,
  variant?: ParserVariant,
):
  | { variableName: string; operator: MutationOperator; value: VariableValue }
  | null {
  const plugin = getParserVariantPlugin(variant);
  if (!plugin.variableMutations || plugin.variableMutations.length === 0) {
    return null;
  }
  for (const rule of plugin.variableMutations) {
    const pattern = typeof rule.pattern === "string"
      ? ((rule as unknown as { pattern: RegExp }).pattern = new RegExp(
        rule.pattern,
        "i",
      ))
      : rule.pattern;
    pattern.lastIndex = 0;
    const match = pattern.exec(trimmed);
    if (match) {
      const varName = rule.variableName ??
        (rule as unknown as { targetVariable?: string }).targetVariable ??
        (rule.variableGroup !== undefined
          ? match[rule.variableGroup]?.trim()
          : undefined);
      if (varName) {
        let val: VariableValue = rule.constantValue ?? true;
        if (
          rule.valueGroup !== undefined && match[rule.valueGroup] !== undefined
        ) {
          const rawVal = match[rule.valueGroup]!.trim();
          if (rawVal.toLowerCase() === "true") val = true;
          else if (rawVal.toLowerCase() === "false") val = false;
          else if (!isNaN(Number(rawVal)) && rawVal !== "") {
            val = Number(rawVal);
          } else val = rawVal.replace(/^["']|["']$/g, "");
        }
        const legacyType =
          (rule as unknown as { mutationType?: string }).mutationType;
        let op: MutationOperator = rule.operator ?? "=";
        if (legacyType === "add") op = "+=";
        else if (legacyType === "subtract") op = "-=";
        return {
          variableName: varName,
          operator: op,
          value: val,
        };
      }
    }
  }
  return null;
}

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
  const plugin = getParserVariantPlugin(variant);
  if (plugin.branchStatements) {
    for (const rule of plugin.branchStatements) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(trimmed)) {
        return false;
      }
    }
  }
  if (
    /^(?:play|queue|stop|voice|show|hide|with|window|scene|pause|camera|nvl|outfit|accessory|pass)\b/i
      .test(trimmed)
  ) {
    return true;
  }
  if (plugin.stagingRegex?.test(trimmed)) {
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
  if (meta.hasLabelStatement || /^\s*label\b/i.test(lineText)) {
    return;
  }

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
      const choiceMatch = findMatchingChoiceDirective(
        trimmed,
        scanState.parserVariant,
      );
      if (choiceMatch) {
        scanState.lastProcessedCustomLineNum = lineNum;
        scanState.pendingTimedChoice = {
          durationSeconds: choiceMatch.durationSeconds ?? 0,
          target: choiceMatch.target,
          title: choiceMatch.title,
          lineNum,
          sourceLocation,
        };
      } else {
        const isExcludedFromTerminal = trimmed.startsWith("#") ||
          meta.hasSayStatement ||
          meta.hasSayCharacter ||
          meta.hasSayNarrator ||
          meta.hasPythonBlock ||
          meta.hasMenuOption;

        const terminalMatch = !isExcludedFromTerminal
          ? findMatchingTerminalRule(trimmed, scanState.parserVariant)
          : null;

        if (terminalMatch) {
          const matchedTerminal = terminalMatch.rule;
          scanState.lastProcessedCustomLineNum = lineNum;
          if (matchedTerminal?.labelHasExplicitExit !== false) {
            scanState.labelHasExplicitExit = true;
          }
          if (matchedTerminal?.isTerminalOutcome) {
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
        } else {
          const isExcludedFromBranch = trimmed.startsWith("#") ||
            trimmed.startsWith("$") ||
            trimmed.startsWith('"') ||
            trimmed.startsWith("'") ||
            meta.hasPythonBlock ||
            meta.hasSayNarrator ||
            meta.hasMenuOption;

          const branchMatch = !isExcludedFromBranch
            ? findMatchingBranchRule(trimmed, scanState.parserVariant)
            : null;

          if (branchMatch) {
            const { rule, target } = branchMatch;
            scanState.lastProcessedCustomLineNum = lineNum;
            const context = resolveCallContext(scanState, meta, menuDepth);
            const suppress = rule.suppressFallthrough ??
              (rule.branchKind === "jump");
            if (rule.branchKind === "call") {
              emitCallEdge(state, scanState, target, context);
            } else {
              emitJumpEdge(state, scanState, target, context, suppress);
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
          } else {
            const varMut = findMatchingVariableMutation(
              trimmed,
              scanState.parserVariant,
            );
            if (varMut && scanState.currentLabelId) {
              scanState.lastProcessedCustomLineNum = lineNum;
              if (!state.nodeMutations) {
                state.nodeMutations = new Map();
              }
              let muts = state.nodeMutations.get(scanState.currentLabelId);
              if (!muts) {
                muts = [];
                state.nodeMutations.set(scanState.currentLabelId, muts);
              }
              muts.push({
                variableName: varMut.variableName,
                operator: varMut.operator,
                value: varMut.value,
                rawExpression: trimmed,
                nodeId: scanState.currentLabelId,
                lineNum,
                isPersistent: varMut.variableName.startsWith("persistent."),
              });
            }
          }
        }
      }
    }
  }
}
