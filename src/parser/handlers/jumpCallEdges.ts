import type {
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import {
  type CallArgument,
  type ConditionMetadata,
  type FlowEdge,
  type SourceLocation,
} from "../../domain/index.ts";
import { menuAtDepth } from "../scanTransitions.ts";
import { addEdge, addIncoming, addOutgoing } from "../graphMutations.ts";
import { addParseDiagnostic } from "../diagnostics.ts";
import { resolveTargetLabelId } from "./targetResolution.ts";

export function addDynamicTargetDiagnostic(
  state: ParseGraphState,
  chapter: string,
  construct: string,
  targetExpression: string,
  sourceId?: string,
) {
  const diagnosticId = [
    "dynamic_target",
    chapter,
    construct,
    targetExpression.trim(),
    sourceId ?? "",
  ].join("|");
  addParseDiagnostic(
    state,
    {
      code: "dynamic_target",
      severity: "warning",
      location: {
        chapter,
        construct,
        targetExpression: targetExpression.trim(),
        sourceId,
      },
      message:
        `Dynamic ${construct} target cannot be resolved statically: ${targetExpression.trim()}`,
      recoveryAction:
        "Use a static string target or configure explicit parser rules.",
    },
    diagnosticId,
  );
}

export function resolveCallContext(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
): {
  isInOption: boolean;
  source: string | null;
  optionText: string | null;
  condition?: ConditionMetadata;
} {
  const isInOption = meta.hasMenuOptionBlock;
  const menu = menuAtDepth(scanState.menuStack, menuDepth);
  const decisionContext = scanState
    .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  const source = isInOption
    ? (menu ? menu.id : null)
    : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
  const condition: ConditionMetadata | undefined = decisionContext
    ? {
      branchKind: decisionContext.branchKind,
      expression: decisionContext.expression ?? undefined,
      references: decisionContext.references,
      decisionNodeId: decisionContext.decisionNodeId,
    }
    : (isInOption && menu?.activeOptionCondition
      ? menu.activeOptionCondition
      : undefined);
  return {
    isInOption,
    source,
    optionText: menu?.optionText ?? null,
    condition,
  };
}

export function emitJumpEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: {
    isInOption: boolean;
    source: string | null;
    optionText: string | null;
    condition?: ConditionMetadata;
    sourceLocation?: SourceLocation;
  },
  suppressFallthrough: boolean,
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (source) {
    const sourceNode = state.nodeMap.get(source);
    const currentChapter = sourceNode?.chapter ??
      (scanState.currentLabelId
        ? state.nodeMap.get(scanState.currentLabelId)?.chapter
        : undefined);
    const { resolvedTargetId } = resolveTargetLabelId(
      state,
      target,
      currentChapter,
    );
    const timeoutSuffix = timeout?.isTimeout === true
      ? `_timeout_${
        timeout.durationSeconds === undefined
          ? "unknown"
          : String(timeout.durationSeconds)
      }`
      : "";
    const edgeId = `jump_${source}__${resolvedTargetId}_${
      optionText ?? ""
    }${timeoutSuffix}`;
    addEdge(state, {
      id: edgeId,
      source,
      target: resolvedTargetId,
      kind: "jump",
      label: isInOption ? (optionText ?? undefined) : undefined,
      condition: context.condition,
      timeout,
      sourceLocation: context.sourceLocation,
    });
    addOutgoing(state, source, "jump");
    addIncoming(state, resolvedTargetId, "jump");

    if (isInOption) {
      if (!context.condition) {
        const menu = menuAtDepth(
          scanState.menuStack,
          scanState.menuStack.length,
        );
        if (menu && menu.options) {
          const lastOpt = menu.options[menu.options.length - 1];
          if (lastOpt) {
            lastOpt.hasExit = true;
          }
        }
      }
    }
  }
  if (
    suppressFallthrough && !isInOption &&
    scanState.conditionalIndentStack.length === 0
  ) {
    scanState.labelHasExplicitExit = true;
  }
}

export function emitCallEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: {
    isInOption: boolean;
    source: string | null;
    optionText: string | null;
    condition?: ConditionMetadata;
    sourceLocation?: SourceLocation;
  },
  callArgs?: CallArgument[],
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (!source) return;
  const sourceNode = state.nodeMap.get(source);
  const currentChapter = sourceNode?.chapter ??
    (scanState.currentLabelId
      ? state.nodeMap.get(scanState.currentLabelId)?.chapter
      : undefined);
  const { resolvedTargetId } = resolveTargetLabelId(
    state,
    target,
    currentChapter,
  );
  const timeoutSuffix = timeout?.isTimeout === true
    ? `_timeout_${
      timeout.durationSeconds === undefined
        ? "unknown"
        : String(timeout.durationSeconds)
    }`
    : "";
  const lineSuffix = context.sourceLocation?.start.line !== undefined
    ? `_L${context.sourceLocation.start.line}`
    : "";
  const edgeId = `call_${source}__${resolvedTargetId}_${
    optionText ?? ""
  }${lineSuffix}${timeoutSuffix}`;
  const callContextId = `ctx_${edgeId}`;
  const callContext = {
    callContextId,
    callEdgeId: edgeId,
    callSiteId: source,
    returnTargetId: source,
    arguments: callArgs,
  };
  addEdge(state, {
    id: edgeId,
    source,
    target: resolvedTargetId,
    kind: "call",
    label: isInOption ? (optionText ? `call: ${optionText}` : "call") : "call",
    condition: context.condition,
    timeout,
    sourceLocation: context.sourceLocation,
    arguments: callArgs,
    callContext,
  });
  state.calledLabels.add(resolvedTargetId);
  addOutgoing(state, source, "call");
  addIncoming(state, resolvedTargetId, "call");
  state.pendingCallReturns.push({
    returnTargetId: source,
    callTargetId: resolvedTargetId,
    callEdgeId: edgeId,
    callContextId,
    arguments: callArgs,
  });
  if (isInOption) {
    state.calledFromMenuOptionTargets.add(resolvedTargetId);
    if (!context.condition) {
      const menu = menuAtDepth(scanState.menuStack, scanState.menuStack.length);
      if (menu && menu.options) {
        const lastOpt = menu.options[menu.options.length - 1];
        if (lastOpt) {
          lastOpt.hasExit = true;
        }
      }
    }
  }
}
