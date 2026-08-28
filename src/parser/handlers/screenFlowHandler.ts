import type { SourceLocation } from "../../domain/index.ts";
import type { ParseGraphState, ParseScanState } from "../pipelineTypes.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "../graphMutations.ts";
import { resolveTargetLabelId } from "./jumpCallHandler.ts";

export interface ScreenFlowCallResult {
  screenCallNodeId: string;
}

export function handleCallScreenStatement(
  state: ParseGraphState,
  scanState: ParseScanState,
  screenName: string,
  chapter: string,
  lineNum: number,
  sourceLocation?: SourceLocation,
): ScreenFlowCallResult | null {
  const trimmedName = screenName.trim();
  if (!trimmedName || !scanState.currentLabelId) return null;

  const nodeCount = state.nodes.length;
  const screenCallNodeId =
    `screen_call_${trimmedName}_${chapter}_${lineNum}_${nodeCount}`;

  addNode(state, {
    id: screenCallNodeId,
    type: "SCREEN_CALL",
    role: "screen_call",
    label: `call screen ${trimmedName}`,
    dialogueCount: 0,
    chapter,
    sourceLocation,
  });

  // Link sequence edge from current label to the screen call node
  const seqEdgeId = `seq_${scanState.currentLabelId}__${screenCallNodeId}`;
  addEdge(state, {
    id: seqEdgeId,
    source: scanState.currentLabelId,
    target: screenCallNodeId,
    kind: "sequence",
    label: "call screen",
    sourceLocation,
  });
  addOutgoing(state, scanState.currentLabelId, "sequence");
  addIncoming(state, screenCallNodeId, "sequence");

  // Track global screens observed
  if (!state.globalScreens) {
    state.globalScreens = new Set();
  }
  state.globalScreens.add(trimmedName);

  // Resolve actions from screen definition if available
  const screenDef = state.screenDefinitions?.get(trimmedName);
  if (screenDef && !screenDef.isEngineChoiceScreen) {
    for (const action of screenDef.actions) {
      if (action.construct === "jump" && action.target) {
        const { resolvedTargetId } = resolveTargetLabelId(
          state,
          action.target,
          chapter,
        );
        const jumpEdgeId = `jump_${screenCallNodeId}__${resolvedTargetId}_${
          action.caption ?? ""
        }`;
        addEdge(state, {
          id: jumpEdgeId,
          source: screenCallNodeId,
          target: resolvedTargetId,
          kind: "jump",
          label: action.caption,
          timeout: action.timeout,
          sourceLocation,
        });
        addOutgoing(state, screenCallNodeId, "jump");
        addIncoming(state, resolvedTargetId, "jump");
      } else if (action.construct === "call" && action.target) {
        const { resolvedTargetId } = resolveTargetLabelId(
          state,
          action.target,
          chapter,
        );
        const callEdgeId = `call_${screenCallNodeId}__${resolvedTargetId}_${
          action.caption ?? ""
        }`;
        const callContextId = `ctx_${callEdgeId}`;
        addEdge(state, {
          id: callEdgeId,
          source: screenCallNodeId,
          target: resolvedTargetId,
          kind: "call",
          label: action.caption ? `call: ${action.caption}` : "call",
          timeout: action.timeout,
          sourceLocation,
          callContext: {
            callContextId,
            callEdgeId,
            callSiteId: screenCallNodeId,
            returnTargetId: screenCallNodeId,
          },
        });
        addOutgoing(state, screenCallNodeId, "call");
        addIncoming(state, resolvedTargetId, "call");
        state.calledLabels.add(resolvedTargetId);
        state.pendingCallReturns.push({
          returnTargetId: screenCallNodeId,
          callTargetId: resolvedTargetId,
          callEdgeId,
          callContextId,
        });
      } else if (action.construct === "show_menu" && action.target) {
        if (
          state.canonicalLabelIdByName?.has(action.target) ||
          state.allLabelIds?.has(action.target) ||
          state.nodeMap?.has(action.target)
        ) {
          const { resolvedTargetId } = resolveTargetLabelId(
            state,
            action.target,
            chapter,
          );
          addEdge(state, {
            id: `jump_${screenCallNodeId}__${resolvedTargetId}_menu`,
            source: screenCallNodeId,
            target: resolvedTargetId,
            kind: "jump",
            label: action.caption ?? "show menu",
            sourceLocation,
          });
          addOutgoing(state, screenCallNodeId, "jump");
          addIncoming(state, resolvedTargetId, "jump");
        }
      } else if (action.construct === "set_variable" && action.variableName) {
        if (!state.nodeMutations) state.nodeMutations = new Map();
        let muts = state.nodeMutations.get(screenCallNodeId);
        if (!muts) {
          muts = [];
          state.nodeMutations.set(screenCallNodeId, muts);
        }
        muts.push({
          variableName: action.variableName,
          operator: "=",
          value: action.variableValue ?? null,
          rawExpression: action.targetExpression,
          nodeId: screenCallNodeId,
          lineNum,
          isPersistent: action.variableName.startsWith("persistent."),
        });
      } else if (
        action.construct === "toggle_variable" && action.variableName
      ) {
        if (!state.nodeMutations) state.nodeMutations = new Map();
        let muts = state.nodeMutations.get(screenCallNodeId);
        if (!muts) {
          muts = [];
          state.nodeMutations.set(screenCallNodeId, muts);
        }
        muts.push({
          variableName: action.variableName,
          operator: "toggle",
          value: null,
          rawExpression: "toggle",
          nodeId: screenCallNodeId,
          lineNum,
          isPersistent: action.variableName.startsWith("persistent."),
        });
      } else if (action.construct === "return") {
        const returnEdgeId =
          `seq_${screenCallNodeId}__${scanState.currentLabelId}`;
        addEdge(state, {
          id: returnEdgeId,
          source: screenCallNodeId,
          target: scanState.currentLabelId,
          kind: "sequence",
          label: action.caption ?? "return",
          sourceLocation,
        });
        addOutgoing(state, screenCallNodeId, "sequence");
        addIncoming(state, scanState.currentLabelId, "sequence");
      }
    }

    if (
      !screenDef.hasReturnAction &&
      screenDef.actions.some((a) => a.construct === "jump") &&
      !screenDef.actions.some((a) => a.construct === "return")
    ) {
      scanState.labelHasExplicitExit = true;
    }
  }

  return { screenCallNodeId };
}
