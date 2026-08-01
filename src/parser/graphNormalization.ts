import type { FlowEdge, FlowNode } from "../domain/index.ts";
import type { EdgeKind, ParseGraphState } from "./pipelineTypes.ts";
import { addParseDiagnostic } from "./diagnostics.ts";
import { MultiDirectedGraph } from "graphology";

/** Supported categories of directed edges within the flowchart graph */
const VALID_EDGE_KINDS = new Set<EdgeKind>([
  "sequence",
  "jump",
  "call",
  "call_return",
]);

/**
 * Standardizes identifier strings by trimming excess whitespaces.
 * Fallbacks to empty string if input is null or undefined.
 */
function normalizeIdentifier(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/**
 * Derives and normalizes the edge kind semantic classification based on edge structure.
 * Checks prefix fallback rules if the explicit `kind` field is absent or invalid.
 *
 * @param edge The flowchart edge being normalized.
 * @returns A validated EdgeKind string.
 */
function normalizeEdgeKind(edge: FlowEdge): EdgeKind {
  if (edge.kind && VALID_EDGE_KINDS.has(edge.kind)) return edge.kind;
  if (edge.id.startsWith("jump_")) return "jump";
  if (edge.id.startsWith("call_")) return "call";
  if (edge.id.startsWith("ret_")) return "call_return";
  return "sequence";
}

/**
 * Generates a stable key string representing the semantic attributes of an edge.
 * Used to detect and deduplicate parallel edges that have identical structure.
 */
function stableSemanticEdgeId(edge: FlowEdge, kind: EdgeKind): string {
  const timeoutKey = edge.timeout?.isTimeout
    ? `timeout:${
      edge.timeout.durationSeconds === undefined
        ? "unknown"
        : edge.timeout.durationSeconds
    }`
    : "normal";
  return `${kind}|${edge.source}|${edge.target}|${
    edge.label ?? ""
  }|${timeoutKey}`;
}

/**
 * Fallback generator for edge identifiers when ID is undefined.
 */
function resolveNormalizedEdgeId(edge: FlowEdge, kind: EdgeKind): string {
  return edge.id || `${kind}_${edge.source}__${edge.target}`;
}

/**
 * Registers incoming or outgoing edge kind traffic to a label bucket map.
 * Used for role classification algorithms during subsequent finalization stages.
 */
function addLabelTraffic(
  bucket: Map<string, Set<EdgeKind>>,
  labelId: string,
  kind: EdgeKind,
): void {
  const existing = bucket.get(labelId);
  if (existing) {
    existing.add(kind);
    return;
  }
  bucket.set(labelId, new Set([kind]));
}

/**
 * Filters the return-tracking set to only retain valid active node IDs.
 */
function rebuildReturnTrackingSet(
  existing: Set<string>,
  validNodeIds: Set<string>,
): Set<string> {
  return new Set(
    Array.from(existing).filter((labelId) => validNodeIds.has(labelId)),
  );
}

/**
 * Standardizes the compiled parser graph state.
 * Performs critical validation, validation repair, and semantic mapping:
 * 1. Sanitizes, validates, and deduplicates all nodes; drops empty IDs.
 * 2. Sanitizes and validates all edges (source, target, kind validity).
 * 3. Registers structured diagnostics for empty, duplicate, or unresolved targets.
 * 4. Prunes duplicate semantic edges with identical source, target, label, and timeout keys.
 * 5. Rebuilds fast-lookup state indexes (nodeMap, edgeMap, allLabelIds).
 * 6. Computes label traffic arrays (incomingByLabel, outgoingByLabel) and call sets.
 * 7. Constructs a fresh Graphology MultiDirectedGraph representing the processed network.
 *
 * @param state The global parser graph state containing raw scanned elements.
 */
export function normalizeGraphState(state: ParseGraphState): void {
  const normalizedNodes: FlowNode[] = [];
  const nodeMap = new Map<string, FlowNode>();

  // Validate and deduplicate nodes
  for (const node of state.nodes) {
    const normalizedNodeId = normalizeIdentifier(node.id);
    if (!normalizedNodeId) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          message: "Dropped node with empty ID during parser normalization.",
          context: {
            category: "invalid_node",
            detail: node.label,
          },
          recoveryAction: "Ensure every parsed node has a non-empty stable ID.",
        },
        `diagnostic|normalization|invalid_node|${node.label}`,
      );
      continue;
    }
    if (nodeMap.has(normalizedNodeId)) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          message:
            `Dropped duplicate node "${normalizedNodeId}" during parser normalization.`,
          location: {
            sourceId: normalizedNodeId,
          },
          context: {
            category: "duplicate_node",
            detail: normalizedNodeId,
          },
          recoveryAction: "Ensure each emitted node ID is unique and stable.",
        },
        `diagnostic|normalization|duplicate_node|${normalizedNodeId}`,
      );
      continue;
    }
    const normalizedNode: FlowNode = normalizedNodeId === node.id
      ? node
      : { ...node, id: normalizedNodeId };
    nodeMap.set(normalizedNode.id, normalizedNode);
    normalizedNodes.push(normalizedNode);
  }

  const normalizedEdges: FlowEdge[] = [];
  const semanticEdgeKeys = new Set<string>();
  const nodeIds = new Set(normalizedNodes.map((node) => node.id));

  // Validate, normalize and deduplicate edges
  for (const edge of state.edges) {
    const normalizedSource = normalizeIdentifier(edge.source);
    const normalizedTarget = normalizeIdentifier(edge.target);

    if (!normalizedSource) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          message: `Dropped edge "${edge.id}" because source is empty.`,
          location: {
            edgeId: edge.id,
            targetId: edge.target,
          },
          context: {
            category: "missing_edge_source",
          },
          recoveryAction:
            "Ensure jump/call edge generation always sets a source ID.",
        },
        `diagnostic|normalization|missing_edge_source|${edge.id}`,
      );
      continue;
    }
    if (!normalizedTarget) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          message: `Dropped edge "${edge.id}" because target is empty.`,
          location: {
            edgeId: edge.id,
            sourceId: edge.source,
          },
          context: {
            category: "missing_edge_target",
          },
          recoveryAction:
            "Ensure jump/call edge generation always sets a target ID.",
        },
        `diagnostic|normalization|missing_edge_target|${edge.id}`,
      );
      continue;
    }

    if (!nodeIds.has(normalizedSource)) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          message:
            `Dropped edge "${edge.id}" because source node "${edge.source}" does not exist.`,
          location: {
            edgeId: edge.id,
            sourceId: normalizedSource,
            targetId: normalizedTarget,
          },
          context: {
            category: "missing_edge_source",
          },
          recoveryAction: "Ensure edge sources reference emitted nodes.",
        },
        `diagnostic|normalization|missing_edge_source_node|${edge.id}|${edge.source}`,
      );
      continue;
    }

    const normalizedKind = normalizeEdgeKind(edge);
    const normalizedEdgeBase: FlowEdge =
      normalizedSource === edge.source && normalizedTarget === edge.target
        ? edge
        : { ...edge, source: normalizedSource, target: normalizedTarget };
    const normalizedEdgeId = resolveNormalizedEdgeId(
      normalizedEdgeBase,
      normalizedKind,
    );
    if (edge.kind !== normalizedKind) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          message:
            `Normalized edge kind for "${normalizedEdgeId}" to "${normalizedKind}".`,
          location: {
            edgeId: normalizedEdgeId,
            sourceId: normalizedSource,
            targetId: normalizedTarget,
          },
          context: {
            category: "invalid_edge_kind",
            detail: String(edge.kind ?? "undefined"),
          },
          recoveryAction:
            "Emit edge kinds using known values: sequence, jump, call, or call_return.",
        },
        `diagnostic|normalization|invalid_edge_kind|${normalizedEdgeId}|${normalizedKind}|${
          edge.kind ?? "undefined"
        }`,
      );
    }

    // Flag unresolved target endpoints (unresolved jump/calls remain in graph as warnings)
    if (
      !nodeIds.has(normalizedTarget) &&
      !state.globalScreens.has(normalizedTarget)
    ) {
      addParseDiagnostic(
        state,
        {
          code: "unresolved_target",
          severity: "warning",
          message:
            `Edge "${normalizedEdgeId}" targets unresolved label "${normalizedTarget}".`,
          location: {
            edgeId: normalizedEdgeId,
            sourceId: normalizedSource,
            targetId: normalizedTarget,
          },
          recoveryAction:
            "Define the target label or update the jump/call target expression.",
        },
        `diagnostic|unresolved_target|${normalizedEdgeId}|${normalizedSource}|${normalizedTarget}`,
      );
    }

    const normalizedEdge: FlowEdge = {
      ...normalizedEdgeBase,
      kind: normalizedKind,
      id: normalizedEdgeId,
    };
    const semanticKey = stableSemanticEdgeId(normalizedEdge, normalizedKind);
    if (semanticEdgeKeys.has(semanticKey)) {
      addParseDiagnostic(
        state,
        {
          code: "normalization",
          severity: "warning",
          message: `Dropped duplicate semantic edge "${normalizedEdge.id}".`,
          location: {
            edgeId: normalizedEdge.id,
            sourceId: normalizedEdge.source,
            targetId: normalizedEdge.target,
          },
          context: {
            category: "duplicate_semantic_edge",
            detail: semanticKey,
          },
          recoveryAction:
            "Avoid emitting duplicate edges with identical semantic meaning.",
        },
        `diagnostic|normalization|duplicate_semantic_edge|${semanticKey}`,
      );
      continue;
    }
    semanticEdgeKeys.add(semanticKey);
    normalizedEdges.push(normalizedEdge);
  }

  // Bind normalized variables to global state
  state.nodes = normalizedNodes;
  state.edges = normalizedEdges;
  state.nodeMap = new Map(normalizedNodes.map((node) => [node.id, node]));
  state.edgeMap = new Map(normalizedEdges.map((edge) => [edge.id, edge]));
  state.nodeIds = new Set(normalizedNodes.map((node) => node.id));
  state.edgeIds = new Set(normalizedEdges.map((edge) => edge.id));
  state.allLabelIds = new Set(
    normalizedNodes.filter((node) => node.type === "LABEL").map((node) =>
      node.id
    ),
  );

  // Initialize and populate traffic trackers
  state.incomingByLabel = new Map();
  state.outgoingByLabel = new Map();
  state.calledLabels = new Set();
  state.calledFromMenuOptionTargets = new Set();
  state.hasReturnInLabel = rebuildReturnTrackingSet(
    state.hasReturnInLabel,
    state.nodeIds,
  );

  for (const edge of normalizedEdges) {
    const edgeKind = edge.kind ?? "sequence";
    if (state.nodeIds.has(edge.source)) {
      addLabelTraffic(state.outgoingByLabel, edge.source, edgeKind);
    }
    if (state.nodeIds.has(edge.target)) {
      addLabelTraffic(state.incomingByLabel, edge.target, edgeKind);
    }
    if (edgeKind === "call") {
      state.calledLabels.add(edge.target);
      const sourceNode = state.nodeMap.get(edge.source);
      if (sourceNode?.type === "MENU") {
        state.calledFromMenuOptionTargets.add(edge.target);
      }
    }
  }

  // Re-instantiate Graphology instance representation
  state.graph = new MultiDirectedGraph<FlowNode, FlowEdge>();
  state.pendingGraphEdgeIds = new Set();
  for (const node of normalizedNodes) {
    state.graph.addNode(node.id, node);
  }
  for (const edge of normalizedEdges) {
    if (state.graph.hasNode(edge.source) && state.graph.hasNode(edge.target)) {
      state.graph.addDirectedEdgeWithKey(
        edge.id,
        edge.source,
        edge.target,
        edge,
      );
      continue;
    }
    state.pendingGraphEdgeIds.add(edge.id);
  }

  const assetMap = new Map<
    string,
    { name: string; type: "image" | "scene" | "audio"; nodeIds?: string[] }
  >();
  for (const node of normalizedNodes) {
    if (node.audioAssetCues) {
      for (const cue of node.audioAssetCues) {
        const assetType: "image" | "scene" | "audio" = cue.type === "scene"
          ? "scene"
          : "audio";
        const key = `${assetType}:${cue.asset}`;
        const existing = assetMap.get(key);
        if (existing) {
          if (existing.nodeIds && !existing.nodeIds.includes(node.id)) {
            existing.nodeIds.push(node.id);
          }
        } else {
          assetMap.set(key, {
            name: cue.asset,
            type: assetType,
            nodeIds: [node.id],
          });
        }
      }
    }
  }
  state.assets = Array.from(assetMap.values());
}
