import type { SourceLocation } from "../../domain/index.ts";
import type { ParseGraphState, ParseScanState } from "../pipelineTypes.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "../graphMutations.ts";

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

  return { screenCallNodeId };
}
