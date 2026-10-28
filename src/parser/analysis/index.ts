import type { ParseGraphState } from "../pipelineTypes.ts";
import type { FlowEdge } from "../../domain/index.ts";
import { verifyAssetIntegrity } from "../assetIntegrity.ts";
import { analyzeReachability } from "./reachabilityAnalysis.ts";
import { analyzeCallCycles, analyzeTightCycles } from "./cycleAnalysis.ts";
import {
  analyzeCallReturnMismatches,
  analyzeCallStackDepth,
} from "./callStackAnalysis.ts";
import { analyzeDeadStateAndUnusedFlags } from "./variableStateAnalysis.ts";
import { propagateVariableMutationsAndEvaluateConditions } from "./dataflowAnalysis.ts";

export * from "./cfaHelpers.ts";
export * from "./reachabilityAnalysis.ts";
export * from "./cycleAnalysis.ts";
export * from "./callStackAnalysis.ts";
export * from "./variableStateAnalysis.ts";
export * from "./dataflowAnalysis.ts";

/**
 * Runs control-flow analysis on the finalized graph state.
 * Detects:
 * 1. Unreachable labels (orphans).
 * 2. Dialogue-less tight infinite cycles.
 * 3. Call-return mismatches and dangling stack subroutine fallthroughs.
 * 4. Recursive call stack deadlocks.
 * 5. Path-aware variable state propagation and static condition evaluation (dead branches).
 * 6. Asset integrity verification against project media files.
 */
export function runControlFlowAnalysis(
  state: ParseGraphState,
  projectMediaFiles?: ParseGraphState["projectMediaFiles"],
): void {
  const outgoingMap = new Map<string, FlowEdge[]>();
  for (const edge of state.edges) {
    let list = outgoingMap.get(edge.source);
    if (!list) {
      list = [];
      outgoingMap.set(edge.source, list);
    }
    list.push(edge);
  }

  analyzeReachability(state, outgoingMap);
  analyzeTightCycles(state, outgoingMap);
  analyzeCallCycles(state, outgoingMap);
  analyzeCallStackDepth(state, outgoingMap);
  analyzeCallReturnMismatches(state, outgoingMap);
  analyzeDeadStateAndUnusedFlags(state);
  propagateVariableMutationsAndEvaluateConditions(state, outgoingMap);
  verifyAssetIntegrity(state, projectMediaFiles);
}
