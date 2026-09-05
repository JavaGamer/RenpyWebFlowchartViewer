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
import {
  areAllPathsCoveredByPendingMenus,
  edgeIdWithOption,
  menuAtDepth,
} from "../scanTransitions.ts";
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

export function updateCallReturnTarget(
  state: ParseGraphState,
  callContextId: string,
  newReturnTargetId: string,
): void {
  for (const pcr of state.pendingCallReturns) {
    if (pcr.callContextId === callContextId) {
      pcr.returnTargetId = newReturnTargetId;
    }
  }
  for (const edge of state.edges) {
    if (edge.callContext && edge.callContext.callContextId === callContextId) {
      edge.callContext.returnTargetId = newReturnTargetId;
    }
  }
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

  if (!isInOption && scanState.pendingMenuFallthrough.length > 0) {
    const allCoveredByMenus = areAllPathsCoveredByPendingMenus(
      state,
      scanState,
    );
    const currentChapter = scanState.currentLabelId
      ? state.nodeMap.get(scanState.currentLabelId)?.chapter
      : undefined;
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

    const curDec = scanState.conditionalDecisionStack.length > 0
      ? scanState.conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ]
      : undefined;
    const curBranchIndex = curDec
      ? (curDec.branches ? curDec.branches.length : 0)
      : undefined;

    const matchingEntries = curDec
      ? scanState.pendingMenuFallthrough.filter(
        (e) =>
          e.branchDecisionId === curDec.decisionNodeId &&
          e.branchIndex === curBranchIndex,
      )
      : scanState.pendingMenuFallthrough.filter((e) => !e.branchDecisionId);

    const remainingEntries = curDec
      ? scanState.pendingMenuFallthrough.filter(
        (e) =>
          !(e.branchDecisionId === curDec.decisionNodeId &&
            e.branchIndex === curBranchIndex),
      )
      : scanState.pendingMenuFallthrough.filter((e) =>
        Boolean(e.branchDecisionId)
      );

    if (matchingEntries.length > 0) {
      const connectedKeys = new Set<string>();
      for (const entry of matchingEntries) {
        if (entry.calledTargetId && entry.callContextId) {
          updateCallReturnTarget(state, entry.callContextId, resolvedTargetId);
          continue;
        }
        const key = `${entry.menuId}__${entry.optionText ?? ""}`;
        if (connectedKeys.has(key)) continue;
        connectedKeys.add(key);

        const edgeId = edgeIdWithOption(
          `jump_${entry.menuId}__${resolvedTargetId}${timeoutSuffix}`,
          entry.optionText ?? null,
        );
        addEdge(state, {
          id: edgeId,
          source: entry.menuId,
          target: resolvedTargetId,
          kind: "jump",
          label: entry.optionText ??
            (timeout?.isTimeout
              ? (timeout.durationSeconds !== undefined
                ? `Timeout (${timeout.durationSeconds}s)`
                : "Timeout")
              : undefined),
          condition: entry.menuId.startsWith("decision_")
            ? {
              branchKind: "else",
              decisionNodeId: entry.menuId,
            }
            : context.condition,
          timeout,
          sourceLocation: context.sourceLocation ?? entry.sourceLocation,
        });
        addOutgoing(state, entry.menuId, "jump");
        addIncoming(state, resolvedTargetId, "jump");
      }
      scanState.pendingMenuFallthrough = remainingEntries;
      if (
        suppressFallthrough &&
        scanState.conditionalIndentStack.length === 0
      ) {
        scanState.labelHasExplicitExit = true;
      }
      if (allCoveredByMenus) {
        return;
      }
    }
  }

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
      label: isInOption ? (optionText ?? undefined) : (optionText ??
        (timeout?.isTimeout
          ? (timeout.durationSeconds !== undefined
            ? `Timeout (${timeout.durationSeconds}s)`
            : "Timeout")
          : undefined)),
      condition: context.condition,
      timeout,
      sourceLocation: context.sourceLocation,
    });
    addOutgoing(state, source, "jump");
    addIncoming(state, resolvedTargetId, "jump");

    if (isInOption) {
      const menu = menuAtDepth(
        scanState.menuStack,
        scanState.menuStack.length,
      );
      const decisionContext = scanState.conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ];
      const isInnerConditional = Boolean(
        context.condition &&
          menu?.indent !== undefined &&
          decisionContext !== undefined &&
          decisionContext.indent > menu.indent,
      );
      if (!isInnerConditional) {
        if (menu && menu.options) {
          const lastOpt = menu.options[menu.options.length - 1];
          if (lastOpt) {
            lastOpt.hasExit = true;
            const currentChapter = sourceNode?.chapter ??
              (scanState.currentLabelId
                ? state.nodeMap.get(scanState.currentLabelId)?.chapter
                : undefined);
            const { resolvedTargetId } = resolveTargetLabelId(
              state,
              target,
              currentChapter,
            );
            if (
              lastOpt.calledSubroutines && lastOpt.calledSubroutines.length > 0
            ) {
              const lastCall = lastOpt.calledSubroutines[
                lastOpt.calledSubroutines.length - 1
              ]!;
              updateCallReturnTarget(
                state,
                lastCall.callContextId,
                resolvedTargetId,
              );
            } else if (lastOpt.callContextId) {
              updateCallReturnTarget(
                state,
                lastOpt.callContextId,
                resolvedTargetId,
              );
            }
          }
        }
      }
    }
  }
  if (suppressFallthrough && !isInOption) {
    if (scanState.conditionalIndentStack.length === 0) {
      scanState.labelHasExplicitExit = true;
    } else if (scanState.conditionalDecisionStack.length > 0) {
      const decCtx = scanState.conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ]!;
      decCtx.currentBranchHasExit = true;
      const { resolvedTargetId } = resolveTargetLabelId(
        state,
        target,
        scanState.currentLabelId
          ? state.nodeMap.get(scanState.currentLabelId)?.chapter
          : undefined,
      );
      if (decCtx.calledSubroutines && decCtx.calledSubroutines.length > 0) {
        const lastCall = decCtx.calledSubroutines[
          decCtx.calledSubroutines.length - 1
        ]!;
        updateCallReturnTarget(state, lastCall.callContextId, resolvedTargetId);
      } else if (decCtx.callContextId) {
        updateCallReturnTarget(state, decCtx.callContextId, resolvedTargetId);
      }
    }
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

  if (!isInOption && scanState.pendingMenuFallthrough.length > 0) {
    const allCoveredByMenus = areAllPathsCoveredByPendingMenus(
      state,
      scanState,
    );
    const currentChapter = scanState.currentLabelId
      ? state.nodeMap.get(scanState.currentLabelId)?.chapter
      : undefined;
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
    const curDec = scanState.conditionalDecisionStack.length > 0
      ? scanState.conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ]
      : undefined;
    const curBranchIndex = curDec
      ? (curDec.branches ? curDec.branches.length : 0)
      : undefined;

    const matchingEntries = curDec
      ? scanState.pendingMenuFallthrough.filter(
        (e) =>
          e.branchDecisionId === curDec.decisionNodeId &&
          e.branchIndex === curBranchIndex,
      )
      : scanState.pendingMenuFallthrough.filter((e) => !e.branchDecisionId);

    const remainingEntries = curDec
      ? scanState.pendingMenuFallthrough.filter(
        (e) =>
          !(e.branchDecisionId === curDec.decisionNodeId &&
            e.branchIndex === curBranchIndex),
      )
      : scanState.pendingMenuFallthrough.filter((e) =>
        Boolean(e.branchDecisionId)
      );

    if (matchingEntries.length > 0) {
      const connectedKeys = new Set<string>();
      for (const entry of matchingEntries) {
        if (entry.calledTargetId && entry.callContextId) {
          updateCallReturnTarget(state, entry.callContextId, resolvedTargetId);
          continue;
        }
        const key = `${entry.menuId}__${entry.optionText ?? ""}`;
        if (connectedKeys.has(key)) continue;
        connectedKeys.add(key);

        const baseEdgeId = `call_${entry.menuId}__${resolvedTargetId}_${
          entry.optionText ?? ""
        }${lineSuffix}${timeoutSuffix}`;
        const edgeId = edgeIdWithOption(baseEdgeId, entry.optionText ?? null);
        const callContextId = `ctx_${edgeId}`;
        const callContext = {
          callContextId,
          callEdgeId: edgeId,
          callSiteId: entry.menuId,
          returnTargetId: scanState.currentLabelId ?? entry.menuId,
          arguments: callArgs,
        };
        addEdge(state, {
          id: edgeId,
          source: entry.menuId,
          target: resolvedTargetId,
          kind: "call",
          label: entry.optionText ? `call: ${entry.optionText}` : "call",
          condition: entry.menuId.startsWith("decision_")
            ? {
              branchKind: "else",
              decisionNodeId: entry.menuId,
            }
            : context.condition,
          timeout,
          sourceLocation: context.sourceLocation ?? entry.sourceLocation,
          arguments: callArgs,
          callContext,
        });
        state.calledLabels.add(resolvedTargetId);
        addOutgoing(state, entry.menuId, "call");
        addIncoming(state, resolvedTargetId, "call");
        state.pendingCallReturns.push({
          returnTargetId: scanState.currentLabelId ?? entry.menuId,
          callTargetId: resolvedTargetId,
          callEdgeId: edgeId,
          callContextId,
          arguments: callArgs,
        });
      }
      scanState.pendingMenuFallthrough = remainingEntries;
      if (allCoveredByMenus) {
        return;
      }
    }
  }

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
    const menu = menuAtDepth(scanState.menuStack, scanState.menuStack.length);
    const decisionContext = scanState.conditionalDecisionStack[
      scanState.conditionalDecisionStack.length - 1
    ];
    const isInnerConditional = Boolean(
      context.condition &&
        menu?.indent !== undefined &&
        decisionContext !== undefined &&
        decisionContext.indent > menu.indent,
    );
    if (!isInnerConditional) {
      if (menu && menu.options) {
        const lastOpt = menu.options[menu.options.length - 1];
        if (lastOpt) {
          if (!lastOpt.calledSubroutines) {
            lastOpt.calledSubroutines = [];
          }
          if (lastOpt.calledSubroutines.length > 0) {
            const prevCall = lastOpt.calledSubroutines[
              lastOpt.calledSubroutines.length - 1
            ]!;
            updateCallReturnTarget(
              state,
              prevCall.callContextId,
              resolvedTargetId,
            );
          }
          lastOpt.calledSubroutines.push({
            targetId: resolvedTargetId,
            callContextId,
          });
          lastOpt.calledTargetId = resolvedTargetId;
          lastOpt.callContextId = callContextId;
        }
      }
    }
  } else if (scanState.conditionalDecisionStack.length > 0) {
    const decCtx = scanState.conditionalDecisionStack[
      scanState.conditionalDecisionStack.length - 1
    ]!;
    if (!decCtx.calledSubroutines) {
      decCtx.calledSubroutines = [];
    }
    if (decCtx.calledSubroutines.length > 0) {
      const prevCall = decCtx.calledSubroutines[
        decCtx.calledSubroutines.length - 1
      ]!;
      updateCallReturnTarget(state, prevCall.callContextId, resolvedTargetId);
    }
    decCtx.calledSubroutines.push({
      targetId: resolvedTargetId,
      callContextId,
    });
    decCtx.calledTargetId = resolvedTargetId;
    decCtx.callContextId = callContextId;
  }
}
