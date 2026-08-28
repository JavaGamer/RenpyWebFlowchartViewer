/**
 * src/parser/mapReduceLinker.ts
 *
 * 2-Pass MapReduce Linker Architecture for Ren'Py Script Parser.
 *
 * Pass 1 (Parallel Map): Parses isolated .rpy files into decoupled File-Local Graph Fragments.
 * Pass 2 (Fast Linker): Merges local symbol tables and graph fragments in a single fast pass to resolve cross-file jumps, pendingCallReturns, and finalize roles.
 */

import type { FlowAsset, FlowEdge, FlowNode } from "../domain/index.ts";
import { compareDeterministicStrings } from "../domain/index.ts";
import type {
  InitVariableDescriptor,
  ParseDiagnostic,
  ParseGraphState,
  ParseInputFile,
  ParseOptions,
  PendingCallReturn,
  VariableMutation,
  VariableValue,
} from "./pipelineTypes.ts";
import { createGraphState } from "./pipelineState.ts";
import { processTokenizedFile, tokenizeOneFile } from "./filePipeline.ts";
import { finalizeRoles } from "./roleFinalization.ts";

export interface FileGraphFragment {
  filePath: string;
  chapter: string;
  fileIndex: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics: ParseDiagnostic[];
  pendingCallReturns: PendingCallReturn[];
  hasReturnInLabel: string[];
  hasReliableReturnInLabel: string[];
  calledLabels: string[];
  calledFromMenuOptionTargets: string[];
  nodeMutations: Array<[string, VariableMutation[]]>;
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
  globalScreens: string[];
  globalCharacters: string[];
  initVariables?: Array<[string, InitVariableDescriptor]>;
  globalPersistentVariables?: Array<[string, VariableValue]>;
  globalLabelVariableLiteralTargets?: Array<[string, string]>;
  globalLabelVariableDictTargets?: Array<[string, Array<[string, string]>]>;
  globalLabelVariableListTargets?: Array<[string, string[]]>;
  imageDefinitions?: Array<[string, string]>;
  assets?: FlowAsset[];
  allConditionalExpressions?: ParseGraphState["allConditionalExpressions"];
}

export function createFileGraphFragment(
  state: ParseGraphState,
  file: ParseInputFile,
  fileIndex: number,
): FileGraphFragment {
  const rawPath = file.relativePath ?? file.name;
  const filePath = rawPath.replace(/\\/g, "/");
  const chapter = filePath.replace(/\.rpy$/i, "");
  const fileCanonicalLabelIds = state.nodes
    .filter((n) => n.type === "LABEL" && !n.id.includes("__scene_"))
    .map((n): [string, string] => [
      n.label || n.id.split("__shadow_")[0]!,
      n.id,
    ]);

  return {
    filePath,
    chapter,
    fileIndex,
    nodes: state.nodes,
    edges: state.edges,
    diagnostics: state.diagnostics,
    pendingCallReturns: state.pendingCallReturns,
    hasReturnInLabel: Array.from(state.hasReturnInLabel),
    hasReliableReturnInLabel: Array.from(state.hasReliableReturnInLabel),
    calledLabels: Array.from(state.calledLabels),
    calledFromMenuOptionTargets: Array.from(state.calledFromMenuOptionTargets),
    nodeMutations: state.nodeMutations
      ? Array.from(state.nodeMutations.entries())
      : [],
    labelDefinitionCount: Array.from(
      state.labelDefinitionCountByName.entries(),
    ),
    canonicalLabelIds: fileCanonicalLabelIds,
    globalScreens: Array.from(state.globalScreens),
    globalCharacters: Array.from(state.globalCharacters),
    initVariables: state.initVariables
      ? Array.from(state.initVariables.entries())
      : undefined,
    globalPersistentVariables: state.globalPersistentVariables
      ? Array.from(state.globalPersistentVariables.entries())
      : undefined,
    globalLabelVariableLiteralTargets: Array.from(
      state.globalLabelVariableLiteralTargets.entries(),
    ),
    globalLabelVariableDictTargets: Array.from(
      state.globalLabelVariableDictTargets.entries(),
    ).map(([k, v]) => [k, Array.from(v.entries())]),
    globalLabelVariableListTargets: Array.from(
      state.globalLabelVariableListTargets.entries(),
    ),
    imageDefinitions: state.imageDefinitions
      ? Array.from(state.imageDefinitions.entries())
      : undefined,
    assets: state.assets,
    allConditionalExpressions: state.allConditionalExpressions,
  };
}

export async function parseFileToFragment(
  file: ParseInputFile,
  options: ParseOptions = {},
  prePassState?: ParseGraphState,
  fileIndex: number = 0,
): Promise<FileGraphFragment> {
  const state = createGraphState();
  if (options.dynamicJumpRules) {
    state.dynamicJumpRules = options.dynamicJumpRules;
  }
  if (prePassState) {
    if (prePassState.dynamicJumpRules) {
      state.dynamicJumpRules = prePassState.dynamicJumpRules;
    }
    if (prePassState.canonicalLabelIdByName) {
      for (const [k, v] of prePassState.canonicalLabelIdByName.entries()) {
        state.canonicalLabelIdByName.set(k, v);
      }
    }
    if (prePassState.globalScreens) {
      for (const s of prePassState.globalScreens) {
        state.globalScreens.add(s);
      }
    }
    if (prePassState.globalCharacters) {
      for (const c of prePassState.globalCharacters) {
        state.globalCharacters.add(c);
      }
    }
    if (prePassState.initVariables) {
      state.initVariables = new Map(prePassState.initVariables);
    }
    if (prePassState.imageDefinitions) {
      state.imageDefinitions = new Map(prePassState.imageDefinitions);
    }
    if (prePassState.globalPersistentVariables) {
      state.globalPersistentVariables = new Map(
        prePassState.globalPersistentVariables,
      );
    }
    if (prePassState.globalLabelVariableLiteralTargets) {
      for (
        const [k, v] of prePassState.globalLabelVariableLiteralTargets.entries()
      ) {
        state.globalLabelVariableLiteralTargets.set(k, v);
      }
    }
    if (prePassState.globalLabelVariableDictTargets) {
      for (
        const [k, v] of prePassState.globalLabelVariableDictTargets.entries()
      ) {
        state.globalLabelVariableDictTargets.set(k, new Map(v));
      }
    }
    if (prePassState.globalLabelVariableListTargets) {
      for (
        const [k, v] of prePassState.globalLabelVariableListTargets.entries()
      ) {
        state.globalLabelVariableListTargets.set(k, [...v]);
      }
    }
    if (prePassState.screenDefinitions) {
      state.screenDefinitions = new Map(prePassState.screenDefinitions);
    }
  }

  const tokenized = await tokenizeOneFile(file, options, fileIndex);
  processTokenizedFile(state, tokenized, {
    captureDialogueLines: options.captureDialogueLines,
    deferDetails: options.deferDetails,
    parserVariant: options.parserVariant,
    screenActionRules: options.screenActionRules,
    sceneSplitDialogueThreshold: options.sceneSplitDialogueThreshold,
  });

  return createFileGraphFragment(state, file, fileIndex);
}

function formatEdgePrefix(
  kind: string | undefined,
  source: string,
  target: string,
): string {
  const k = !kind || kind === "sequence"
    ? "seq"
    : kind === "call_return"
    ? "ret"
    : kind;
  return `${k}_${source}__${target}`;
}

export function linkGraphFragments(
  fragments: FileGraphFragment[],
  targetState?: ParseGraphState,
  options: ParseOptions = {},
): ParseGraphState {
  const state = targetState ?? createGraphState();
  if (options.dynamicJumpRules) {
    state.dynamicJumpRules = options.dynamicJumpRules;
  }
  if (options.maxCallStackDepth !== undefined) {
    state.maxCallStackDepth = options.maxCallStackDepth;
  }
  if (options.projectMediaFiles && !state.projectMediaFiles) {
    state.projectMediaFiles = options.projectMediaFiles;
  }

  // Sort fragments deterministically by fileIndex then filePath (using deterministic string comparison)
  const sortedFragments = [...fragments].sort((a, b) =>
    (a.fileIndex - b.fileIndex) ||
    compareDeterministicStrings(a.filePath, b.filePath)
  );

  const seenLabelCounts = new Map<string, number>();
  const seenMenuCounts = new Map<string, number>();
  const seenDecisionCounts = new Map<string, number>();
  const fragmentNodeIdRemapMaps: Map<string, string>[] = [];
  const fragmentEdgeIdRemapMaps: Map<string, string>[] = [];

  // Pass 2.1: Disambiguate duplicate node IDs across fragments
  for (const fragment of sortedFragments) {
    const nodeIdRemap = new Map<string, string>();

    // First pass over fragment nodes: main labels, menus, decisions
    for (const node of fragment.nodes) {
      if (node.type === "LABEL") {
        const isSceneSplit = node.id.includes("__scene_");
        if (!isSceneSplit) {
          const rawLabel = node.label || node.id.split("__shadow_")[0]!;
          const currentCount = (seenLabelCounts.get(rawLabel) ?? 0) + 1;
          seenLabelCounts.set(rawLabel, currentCount);

          const expectedId = currentCount === 1
            ? rawLabel
            : `${rawLabel}__shadow_${currentCount}`;

          if (node.id !== expectedId) {
            nodeIdRemap.set(node.id, expectedId);
            node.id = expectedId;
          }

          if (currentCount > 1) {
            node.isShadowed = true;
            node.shadowOfId = rawLabel;
            state.diagnostics.push({
              code: "shadowed_label",
              severity: "warning",
              message:
                `Label "${rawLabel}" is a duplicate definition and is shadowed by canonical label "${rawLabel}".`,
              location: {
                chapter: fragment.chapter,
                construct: "label",
                sourceId: node.id,
                targetId: rawLabel,
                sourceLocation: node.sourceLocation,
              },
              recoveryAction:
                "Rename duplicate labels or keep one canonical definition.",
              context: {
                category: "shadowed_label",
                detail: rawLabel,
              },
            });
          }
        }
      } else if (node.type === "MENU") {
        const rawId = node.id.split("__dup_")[0]!;
        const currentCount = (seenMenuCounts.get(rawId) ?? 0) + 1;
        seenMenuCounts.set(rawId, currentCount);
        const expectedId = currentCount === 1
          ? rawId
          : `${rawId}__dup_${currentCount}`;
        if (node.id !== expectedId) {
          nodeIdRemap.set(node.id, expectedId);
          node.id = expectedId;
        }
      } else if (node.type === "DECISION") {
        const rawId = node.id.split("__dup_")[0]!;
        const currentCount = (seenDecisionCounts.get(rawId) ?? 0) + 1;
        seenDecisionCounts.set(rawId, currentCount);
        const expectedId = currentCount === 1
          ? rawId
          : `${rawId}__dup_${currentCount}`;
        if (node.id !== expectedId) {
          nodeIdRemap.set(node.id, expectedId);
          node.id = expectedId;
        }
        if (node.condition) {
          node.condition = {
            ...node.condition,
            decisionNodeId: node.id,
          };
        }
      }
    }

    // Second pass over fragment nodes: remap scene-split nodes whose parent label was remapped
    for (const node of fragment.nodes) {
      if (node.id.includes("__scene_")) {
        const sceneMatch = /^(.*?)__scene_(\d+)$/.exec(node.id);
        if (sceneMatch) {
          const parentId = sceneMatch[1]!;
          const sceneIndex = sceneMatch[2]!;
          if (nodeIdRemap.has(parentId)) {
            const remappedParentId = nodeIdRemap.get(parentId)!;
            const newSceneId = `${remappedParentId}__scene_${sceneIndex}`;
            nodeIdRemap.set(node.id, newSceneId);
            node.id = newSceneId;
          }
        }
      }
    }

    // Third pass over fragment nodes: update parentLabelId if parent label was remapped, then register node
    for (const node of fragment.nodes) {
      if (node.parentLabelId && nodeIdRemap.has(node.parentLabelId)) {
        node.parentLabelId = nodeIdRemap.get(node.parentLabelId)!;
      }
      state.nodes.push(node);
      state.nodeMap.set(node.id, node);
      state.nodeIds.add(node.id);
    }

    fragmentNodeIdRemapMaps.push(nodeIdRemap);
  }

  // Pass 2.2: Remap and merge edges (preserving edge ID suffixes & tracking edgeIdRemap)
  for (let idx = 0; idx < sortedFragments.length; idx += 1) {
    const fragment = sortedFragments[idx]!;
    const nodeRemap = fragmentNodeIdRemapMaps[idx]!;
    const edgeIdRemap = new Map<string, string>();

    for (const edge of fragment.edges) {
      const oldEdgeId = edge.id;
      const oldSource = edge.source;
      const oldTarget = edge.target;
      let remapped = false;
      if (nodeRemap.has(edge.source)) {
        edge.source = nodeRemap.get(edge.source)!;
        remapped = true;
      }
      if (nodeRemap.has(edge.target)) {
        edge.target = nodeRemap.get(edge.target)!;
        remapped = true;
      }
      if (edge.condition && edge.condition.decisionNodeId) {
        const decisionRemapped = nodeRemap.get(edge.condition.decisionNodeId);
        if (decisionRemapped) {
          edge.condition = {
            ...edge.condition,
            decisionNodeId: decisionRemapped,
          };
        }
      }
      if (edge.callContext) {
        const siteRemapped = nodeRemap.get(edge.callContext.callSiteId);
        const returnRemapped = nodeRemap.get(edge.callContext.returnTargetId);
        if (siteRemapped || returnRemapped) {
          edge.callContext = {
            ...edge.callContext,
            callSiteId: siteRemapped ?? edge.callContext.callSiteId,
            returnTargetId: returnRemapped ?? edge.callContext.returnTargetId,
          };
        }
      }
      if (remapped) {
        const oldPrefix = formatEdgePrefix(edge.kind, oldSource, oldTarget);
        const newPrefix = formatEdgePrefix(edge.kind, edge.source, edge.target);
        if (edge.id.startsWith(oldPrefix)) {
          edge.id = newPrefix + edge.id.slice(oldPrefix.length);
        } else {
          edge.id = newPrefix;
        }
        if (edge.callContext) {
          edge.callContext = {
            ...edge.callContext,
            callEdgeId: edge.id,
          };
        }
        edgeIdRemap.set(oldEdgeId, edge.id);
      }
      state.edges.push(edge);
      state.edgeMap.set(edge.id, edge);
      state.edgeIds.add(edge.id);
    }
    fragmentEdgeIdRemapMaps.push(edgeIdRemap);
  }

  // Pass 2.3: Merge symbol tables, call returns, init variables, and flags
  for (let idx = 0; idx < sortedFragments.length; idx += 1) {
    const fragment = sortedFragments[idx]!;
    const nodeRemap = fragmentNodeIdRemapMaps[idx]!;
    const edgeRemap = fragmentEdgeIdRemapMaps[idx]!;

    // Diagnostics
    if (fragment.diagnostics) {
      for (const diag of fragment.diagnostics) {
        state.diagnostics.push(diag);
      }
    }

    // Assets
    if (fragment.assets) {
      if (!state.assets) state.assets = [];
      for (const asset of fragment.assets) {
        state.assets.push(asset);
      }
    }

    // Conditional expressions
    if (fragment.allConditionalExpressions) {
      if (!state.allConditionalExpressions) {
        state.allConditionalExpressions = [];
      }
      for (const cond of fragment.allConditionalExpressions) {
        state.allConditionalExpressions.push(cond);
      }
    }

    // Pending call returns (callTargetId, returnTargetId, callContextId, callEdgeId remap node/edge IDs)
    for (const pcr of fragment.pendingCallReturns) {
      const callTargetId = nodeRemap.get(pcr.callTargetId) ?? pcr.callTargetId;
      const returnTargetId = pcr.returnTargetId
        ? (nodeRemap.get(pcr.returnTargetId) ?? pcr.returnTargetId)
        : pcr.returnTargetId;
      const callContextId = pcr.callContextId
        ? (nodeRemap.get(pcr.callContextId) ?? pcr.callContextId)
        : pcr.callContextId;
      const callEdgeId = edgeRemap.get(pcr.callEdgeId) ??
        (nodeRemap.get(pcr.callEdgeId) ?? pcr.callEdgeId);
      state.pendingCallReturns.push({
        ...pcr,
        callTargetId,
        returnTargetId,
        callContextId,
        callEdgeId,
      });
    }

    // Labels & returns flags (remap node IDs for shadowed returns and calls)
    for (const label of fragment.hasReturnInLabel) {
      state.hasReturnInLabel.add(nodeRemap.get(label) ?? label);
    }
    for (const label of fragment.hasReliableReturnInLabel) {
      state.hasReliableReturnInLabel.add(nodeRemap.get(label) ?? label);
    }
    for (const label of fragment.calledLabels) {
      state.calledLabels.add(nodeRemap.get(label) ?? label);
    }
    for (const label of fragment.calledFromMenuOptionTargets) {
      state.calledFromMenuOptionTargets.add(nodeRemap.get(label) ?? label);
    }

    // Screens and characters
    for (const s of fragment.globalScreens) {
      state.globalScreens.add(s);
    }
    for (const c of fragment.globalCharacters) {
      state.globalCharacters.add(c);
    }

    for (const [name, id] of fragment.canonicalLabelIds) {
      const finalId = nodeRemap.get(id) ?? id;
      if (!state.canonicalLabelIdByName.has(name)) {
        state.canonicalLabelIdByName.set(name, finalId);
      }
      let chapterMap = state.labelsByChapter.get(fragment.chapter);
      if (!chapterMap) {
        chapterMap = new Map();
        state.labelsByChapter.set(fragment.chapter, chapterMap);
      }
      if (!chapterMap.has(name)) {
        chapterMap.set(name, finalId);
      }
    }

    // Node mutations
    if (fragment.nodeMutations && fragment.nodeMutations.length > 0) {
      if (!state.nodeMutations) state.nodeMutations = new Map();
      for (const [nodeId, mutations] of fragment.nodeMutations) {
        const finalNodeId = nodeRemap.get(nodeId) ?? nodeId;
        const remappedMutations = mutations.map((m) => ({
          ...m,
          nodeId: nodeRemap.get(m.nodeId) ?? m.nodeId,
        }));
        const existingMutations = state.nodeMutations.get(finalNodeId) ?? [];
        state.nodeMutations.set(finalNodeId, [
          ...existingMutations,
          ...remappedMutations,
        ]);
      }
    }

    // Init variables with Ren'Py precedence rules (define > default > python, priority precedence)
    if (fragment.initVariables && fragment.initVariables.length > 0) {
      if (!state.initVariables) state.initVariables = new Map();
      for (const [varName, desc] of fragment.initVariables) {
        const existing = state.initVariables.get(varName);
        let shouldOverwrite: boolean;
        if (!existing) {
          shouldOverwrite = true;
        } else if (existing.kind === "define" && desc.kind !== "define") {
          shouldOverwrite = desc.priority > existing.priority;
        } else if (desc.kind === "define" && existing.kind !== "define") {
          shouldOverwrite = desc.priority >= existing.priority;
        } else if (desc.kind === "default" && existing.kind === "default") {
          shouldOverwrite = desc.priority > existing.priority;
        } else {
          shouldOverwrite = desc.priority >= existing.priority;
        }

        if (shouldOverwrite) {
          state.initVariables.set(varName, desc);
        }
      }
    }

    // Persistent variables
    if (
      fragment.globalPersistentVariables &&
      fragment.globalPersistentVariables.length > 0
    ) {
      if (!state.globalPersistentVariables) {
        state.globalPersistentVariables = new Map();
      }
      for (const [k, v] of fragment.globalPersistentVariables) {
        state.globalPersistentVariables.set(k, v);
      }
    }

    // Label variable targets (deep dictionary & deduplicated list entry merging)
    if (fragment.globalLabelVariableLiteralTargets) {
      for (const [k, v] of fragment.globalLabelVariableLiteralTargets) {
        state.globalLabelVariableLiteralTargets.set(k, v);
      }
    }
    if (fragment.globalLabelVariableDictTargets) {
      for (const [k, dictEntries] of fragment.globalLabelVariableDictTargets) {
        let existingDict = state.globalLabelVariableDictTargets.get(k);
        if (!existingDict) {
          existingDict = new Map();
          state.globalLabelVariableDictTargets.set(k, existingDict);
        }
        for (const [entryK, entryV] of dictEntries) {
          existingDict.set(entryK, entryV);
        }
      }
    }
    if (fragment.globalLabelVariableListTargets) {
      for (const [k, list] of fragment.globalLabelVariableListTargets) {
        const existingList = state.globalLabelVariableListTargets.get(k) ?? [];
        state.globalLabelVariableListTargets.set(
          k,
          Array.from(new Set([...existingList, ...list])),
        );
      }
    }
    if (fragment.imageDefinitions) {
      if (!state.imageDefinitions) state.imageDefinitions = new Map();
      for (const [k, v] of fragment.imageDefinitions) {
        state.imageDefinitions.set(k, v);
      }
    }
  }

  // Set definition counts from seen label definitions across fragments
  state.labelDefinitionCountByName.clear();
  for (const [name, count] of seenLabelCounts.entries()) {
    state.labelDefinitionCountByName.set(name, count);
  }

  // Pass 2.4: Finalize roles, materialize call-returns, normalize graph, & run CFA
  finalizeRoles(state);

  return state;
}
