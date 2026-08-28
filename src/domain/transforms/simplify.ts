import type {
  CallArgument,
  CallContext,
  ConditionBranchKind,
  ConditionMetadata,
  EdgeKind,
  FlowEdge,
  FlowNode,
  SourceLocation,
  VariableMutation,
} from "../graph.ts";

export interface GraphSimplificationOptions {
  collapseLinearChains: boolean;
  inlineUtilities: boolean;
  inlineDetours: boolean;
  inlineStateToggles: boolean;
  inlineEmptyLabels: boolean;
  inlineDialogueThreshold: number;
}

/**
 * Simplifies the node graph by inlining specified roles or empty labels,
 * and collapsing consecutive 1-to-1 linear chains.
 */
export function simplifyGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: GraphSimplificationOptions,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let currentNodes = [...nodes];
  let currentEdges = [...edges];

  // 1. Inlining pass
  if (
    options.inlineUtilities ||
    options.inlineDetours ||
    options.inlineStateToggles ||
    options.inlineEmptyLabels
  ) {
    const { nodes: inlinedNodes, edges: inlinedEdges } = inlineNodes(
      currentNodes,
      currentEdges,
      options,
    );
    currentNodes = inlinedNodes;
    currentEdges = inlinedEdges;
  }

  // 2. Collapsing pass
  if (options.collapseLinearChains) {
    const { nodes: collapsedNodes, edges: collapsedEdges } =
      collapseLinearChains(
        currentNodes,
        currentEdges,
      );
    currentNodes = collapsedNodes;
    currentEdges = collapsedEdges;
  }

  return { nodes: currentNodes, edges: currentEdges };
}

function inlineNodes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options: GraphSimplificationOptions,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const H = new Set<string>();

  // Count incoming edges per node (excluding self-loops)
  const incomingCounts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  }

  for (const node of nodes) {
    if (node.type !== "LABEL") continue;

    // Protect entry start node
    const isStartNode = node.id === "start" ||
      node.label.toLowerCase() === "start";
    if (isStartNode) continue;

    // Protect terminal outcomes (end of routes)
    if (node.isTerminalOutcome) continue;

    // Protect root nodes (no incoming edges)
    const incomingCount = incomingCounts.get(node.id) ?? 0;
    if (incomingCount === 0) continue;

    let shouldInline = false;
    if (node.chapter === "__unresolved__") {
      shouldInline = false;
    } else if (options.inlineUtilities && node.role === "utility") {
      shouldInline = true;
    } else if (options.inlineDetours && node.role === "detour") {
      shouldInline = true;
    } else if (options.inlineStateToggles && node.role === "state_toggle") {
      shouldInline = true;
    } else if (
      options.inlineEmptyLabels &&
      options.inlineDialogueThreshold !== undefined &&
      node.dialogueCount < options.inlineDialogueThreshold
    ) {
      shouldInline = true;
    }

    if (shouldInline) {
      H.add(node.id);
    }
  }

  if (H.size === 0) {
    return { nodes, edges };
  }

  const nodesMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoingEdges = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const list = outgoingEdges.get(edge.source) || [];
    list.push(edge);
    outgoingEdges.set(edge.source, list);
  }

  const newEdges: FlowEdge[] = [];

  for (const u of nodes) {
    if (H.has(u.id)) continue;

    const queue: Array<{
      nodeId: string;
      label: string;
      kind: EdgeKind;
      condition?: ConditionMetadata;
      timeout?: FlowEdge["timeout"];
      arguments?: CallArgument[];
      sourceLocation?: SourceLocation;
      callContext?: CallContext;
      originalId?: string;
      isInlinedPath: boolean;
      pathVisited: Set<string>;
    }> = [];

    for (const edge of outgoingEdges.get(u.id) ?? []) {
      queue.push({
        nodeId: edge.target,
        label: edge.label || "",
        kind: edge.kind || "sequence",
        condition: edge.condition,
        timeout: edge.timeout,
        arguments: edge.arguments,
        sourceLocation: edge.sourceLocation,
        callContext: edge.callContext,
        originalId: edge.id,
        isInlinedPath: false,
        pathVisited: new Set([u.id, edge.target]),
      });
    }

    let head = 0;
    const MAX_INLINE_QUEUE = 1000;
    while (head < queue.length && queue.length < MAX_INLINE_QUEUE) {
      const current = queue[head++]!;

      const targetNode = nodesMap.get(current.nodeId);
      if (!targetNode || !H.has(current.nodeId)) {
        newEdges.push({
          id: current.isInlinedPath
            ? `${
              current.kind || "sequence"
            }_${u.id}__${current.nodeId}__inlined_${current
              .originalId!}_${newEdges.length}`
            : current.originalId!,
          source: u.id,
          target: current.nodeId,
          kind: current.kind,
          label: current.label || undefined,
          condition: current.condition,
          timeout: current.timeout,
          arguments: current.arguments,
          sourceLocation: current.sourceLocation,
          callContext: current.callContext
            ? current.isInlinedPath
              ? {
                ...current.callContext,
                callSiteId: current.callContext.callSiteId === current.nodeId
                  ? u.id
                  : current.callContext.callSiteId,
                returnTargetId:
                  current.callContext.returnTargetId === current.nodeId
                    ? u.id
                    : current.callContext.returnTargetId,
              }
              : current.callContext
            : undefined,
        });
        continue;
      }

      if (
        targetNode && targetNode.mutations && targetNode.mutations.length > 0
      ) {
        if (!u.mutations) u.mutations = [];
        for (const m of targetNode.mutations) {
          if (
            !u.mutations.some((existing) =>
              existing.variableName === m.variableName &&
              existing.operator === m.operator &&
              existing.rawExpression === m.rawExpression
            )
          ) {
            u.mutations.push(m);
          }
        }
      }

      const nextEdges = outgoingEdges.get(current.nodeId) || [];
      for (const edge of nextEdges) {
        if (current.pathVisited.has(edge.target)) continue;
        const nextPathVisited = new Set(current.pathVisited);
        nextPathVisited.add(edge.target);

        const mergedLabel = current.label || edge.label || "";
        let mergedKind: EdgeKind = current.kind;
        if (edge.kind === "call_return" || mergedKind === "call_return") {
          mergedKind = "call_return";
        } else if (edge.kind === "call" || mergedKind === "call") {
          mergedKind = "call";
        } else if (edge.kind === "jump" || mergedKind === "jump") {
          mergedKind = "jump";
        } else {
          mergedKind = "sequence";
        }

        let mergedCondition = current.condition || edge.condition;
        if (current.condition && edge.condition) {
          const exp1 = current.condition.expression;
          const exp2 = edge.condition.expression;
          let mergedExpression: string | undefined;
          if (exp1 && exp2) {
            mergedExpression = `(${exp1}) and (${exp2})`;
          } else {
            mergedExpression = exp1 || exp2;
          }
          const mergedRefs = Array.from(
            new Set([
              ...(current.condition.references || []),
              ...(edge.condition.references || []),
            ]),
          ).sort();

          const branchKind: ConditionBranchKind =
            current.condition.branchKind === "if" ||
              edge.condition.branchKind === "if"
              ? "if"
              : current.condition.branchKind === "else" &&
                  edge.condition.branchKind === "else"
              ? "else"
              : "elif";

          mergedCondition = {
            branchKind,
            expression: mergedExpression,
            references: mergedRefs,
            decisionNodeId: current.condition.decisionNodeId ||
              edge.condition.decisionNodeId,
          };
        }
        const mergedTimeout = current.timeout || edge.timeout;

        let mergedCallContext = current.callContext || edge.callContext;
        if (mergedCallContext) {
          mergedCallContext = {
            ...mergedCallContext,
            callSiteId: mergedCallContext.callSiteId === current.nodeId
              ? u.id
              : mergedCallContext.callSiteId,
            returnTargetId: mergedCallContext.returnTargetId === current.nodeId
              ? u.id
              : mergedCallContext.returnTargetId,
          };
        }

        queue.push({
          nodeId: edge.target,
          label: mergedLabel,
          kind: mergedKind,
          condition: mergedCondition,
          timeout: mergedTimeout,
          arguments: current.arguments || edge.arguments,
          sourceLocation: current.sourceLocation || edge.sourceLocation,
          callContext: mergedCallContext,
          originalId: current.originalId || edge.id,
          isInlinedPath: true,
          pathVisited: nextPathVisited,
        });
      }
    }
  }

  const remainingNodes = nodes.filter((n) => !H.has(n.id));

  return { nodes: remainingNodes, edges: newEdges };
}

export function collapseLinearChains(
  nodes: FlowNode[],
  edges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const outgoing = new Map<string, FlowEdge[]>();
  const incoming = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);

    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target)!.push(edge);
  }

  const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));

  const collapsibleEdges = new Map<string, FlowEdge>(); // sourceId -> edge
  const hasIncomingCollapsible = new Set<string>();
  const hasOutgoingCollapsible = new Set<string>();

  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const A = nodeMap.get(edge.source);
    const B = nodeMap.get(edge.target);
    if (!A || !B) continue;

    if (
      A.type === "LABEL" &&
      B.type === "LABEL" &&
      A.chapter === B.chapter &&
      A.id !== "start" &&
      B.id !== "start" &&
      (outgoing.get(A.id)?.length ?? 0) === 1 &&
      (incoming.get(B.id)?.length ?? 0) === 1 &&
      !edge.label &&
      !edge.condition &&
      !edge.timeout &&
      (edge.kind === "sequence" || edge.kind === "jump")
    ) {
      collapsibleEdges.set(A.id, edge);
      hasIncomingCollapsible.add(B.id);
      hasOutgoingCollapsible.add(A.id);
    }
  }

  const collapsedInto = new Map<string, string>();
  const mergedNodesMap = new Map<string, FlowNode>();
  function combineSourceLocations(
    locations: SourceLocation[],
    fallback?: SourceLocation,
  ): SourceLocation | undefined {
    if (locations.length === 0) return fallback;
    const file = locations[0]!.file;
    const sameFileLocs = locations.filter((l) => l.file === file);
    if (sameFileLocs.length === 0) return fallback;

    let minLine = Infinity;
    let minCol = Infinity;
    let minOffset: number | undefined = Infinity;
    let maxLine = -Infinity;
    let maxCol = -Infinity;
    let maxOffset: number | undefined = -Infinity;

    for (const l of sameFileLocs) {
      if (
        l.start.line < minLine ||
        (l.start.line === minLine && l.start.character < minCol)
      ) {
        minLine = l.start.line;
        minCol = l.start.character;
      }
      if (
        l.start.offset !== undefined &&
        (minOffset === undefined || l.start.offset < minOffset)
      ) {
        minOffset = l.start.offset;
      }
      if (
        l.end.line > maxLine ||
        (l.end.line === maxLine && l.end.character > maxCol)
      ) {
        maxLine = l.end.line;
        maxCol = l.end.character;
      }
      if (
        l.end.offset !== undefined &&
        (maxOffset === undefined || l.end.offset > maxOffset)
      ) {
        maxOffset = l.end.offset;
      }
    }

    return {
      file,
      start: {
        line: minLine,
        character: minCol !== Infinity ? minCol : 0,
        offset: minOffset !== Infinity && minOffset !== undefined
          ? minOffset
          : 0,
      },
      end: {
        line: maxLine,
        character: maxCol !== -Infinity ? maxCol : 0,
        offset: maxOffset !== -Infinity && maxOffset !== undefined
          ? maxOffset
          : 0,
      },
    };
  }

  const visited = new Set<string>();
  const cycleRoots = new Set<string>();

  // 1. Traverse starting from roots (nodes with outgoing collapsible, but no incoming collapsible)
  const roots = [...hasOutgoingCollapsible].filter((id) =>
    !hasIncomingCollapsible.has(id)
  );
  for (const rootId of roots) {
    if (visited.has(rootId)) continue;
    visited.add(rootId);

    let currentId = rootId;
    const path: string[] = [rootId];

    while (collapsibleEdges.has(currentId)) {
      const edge = collapsibleEdges.get(currentId)!;
      const nextId = edge.target;
      if (nextId === rootId) {
        cycleRoots.add(rootId);
        break;
      }
      if (visited.has(nextId)) break; // cycle safety
      visited.add(nextId);
      path.push(nextId);
      currentId = nextId;
    }

    if (path.length > 1) {
      const rootNode = nodeMap.get(rootId)!;
      let dialogueCount = rootNode.dialogueCount;
      let wordCount = rootNode.wordCount ?? 0;
      let pauseDuration = rootNode.pauseDuration ?? 0;
      const dialogueLines = [...(rootNode.dialogueLines || [])];
      const dialogueLineNums = [...(rootNode.dialogueLineNums || [])];
      const audioAssetCues = [...(rootNode.audioAssetCues || [])];
      const collapsedLabels = [...(rootNode.collapsedLabels || [])];
      let isShadowed = rootNode.isShadowed;
      let isTerminalOutcome = rootNode.isTerminalOutcome;

      const characterDialogue: Record<
        string,
        { lineCount: number; wordCount: number }
      > = {};
      if (rootNode.characterDialogue) {
        for (
          const [char, stats] of Object.entries(rootNode.characterDialogue)
        ) {
          characterDialogue[char] = { ...stats };
        }
      }

      const mutations: VariableMutation[] = [...(rootNode.mutations || [])];

      for (let i = 1; i < path.length; i++) {
        const node = nodeMap.get(path[i])!;
        dialogueCount += node.dialogueCount;
        wordCount += node.wordCount ?? 0;
        pauseDuration += node.pauseDuration ?? 0;
        dialogueLines.push(...(node.dialogueLines || []));
        dialogueLineNums.push(...(node.dialogueLineNums || []));
        audioAssetCues.push(...(node.audioAssetCues || []));
        collapsedLabels.push(node.label);
        collapsedLabels.push(...(node.collapsedLabels || []));
        if (node.characterDialogue) {
          for (const [char, stats] of Object.entries(node.characterDialogue)) {
            if (!characterDialogue[char]) {
              characterDialogue[char] = { lineCount: 0, wordCount: 0 };
            }
            characterDialogue[char].lineCount += stats.lineCount;
            characterDialogue[char].wordCount += stats.wordCount;
          }
        }
        if (node.mutations) {
          mutations.push(...node.mutations);
        }
        if (node.isShadowed) isShadowed = true;
        if (node.isTerminalOutcome) isTerminalOutcome = true;
        collapsedInto.set(node.id, rootId);
      }

      const collapsedLocations = path
        .map((id) => nodeMap.get(id)?.sourceLocation)
        .filter((loc): loc is NonNullable<typeof loc> => Boolean(loc));

      const combinedSourceLocation = combineSourceLocations(
        collapsedLocations,
        rootNode.sourceLocation,
      );

      mergedNodesMap.set(rootId, {
        ...rootNode,
        dialogueCount,
        wordCount,
        pauseDuration,
        dialogueLines,
        dialogueLineNums,
        audioAssetCues,
        collapsedLabels,
        characterDialogue: Object.keys(characterDialogue).length > 0
          ? characterDialogue
          : undefined,
        collapsedLocations: collapsedLocations.length > 0
          ? collapsedLocations
          : rootNode.collapsedLocations,
        sourceLocation: combinedSourceLocation,
        mutations: mutations.length > 0 ? mutations : undefined,
        isShadowed,
        isTerminalOutcome,
      });
    }
  }

  // 2. Traverse remaining nodes with outgoing collapsible (handles cycles)
  for (const startId of hasOutgoingCollapsible) {
    if (visited.has(startId)) continue;
    visited.add(startId);

    let currentId = startId;
    const path: string[] = [startId];

    while (collapsibleEdges.has(currentId)) {
      const edge = collapsibleEdges.get(currentId)!;
      const nextId = edge.target;
      if (nextId === startId) {
        cycleRoots.add(startId);
        break;
      }
      if (visited.has(nextId)) break;
      visited.add(nextId);
      path.push(nextId);
      currentId = nextId;
    }

    if (path.length > 1) {
      const rootId = startId;
      const rootNode = nodeMap.get(rootId)!;
      let dialogueCount = rootNode.dialogueCount;
      let wordCount = rootNode.wordCount ?? 0;
      let pauseDuration = rootNode.pauseDuration ?? 0;
      const dialogueLines = [...(rootNode.dialogueLines || [])];
      const dialogueLineNums = [...(rootNode.dialogueLineNums || [])];
      const audioAssetCues = [...(rootNode.audioAssetCues || [])];
      const collapsedLabels = [...(rootNode.collapsedLabels || [])];
      let isShadowed = rootNode.isShadowed;
      let isTerminalOutcome = rootNode.isTerminalOutcome;

      const characterDialogue: Record<
        string,
        { lineCount: number; wordCount: number }
      > = {};
      if (rootNode.characterDialogue) {
        for (
          const [char, stats] of Object.entries(rootNode.characterDialogue)
        ) {
          characterDialogue[char] = { ...stats };
        }
      }

      const mutations: VariableMutation[] = [...(rootNode.mutations || [])];

      for (let i = 1; i < path.length; i++) {
        const node = nodeMap.get(path[i])!;
        dialogueCount += node.dialogueCount;
        wordCount += node.wordCount ?? 0;
        pauseDuration += node.pauseDuration ?? 0;
        dialogueLines.push(...(node.dialogueLines || []));
        dialogueLineNums.push(...(node.dialogueLineNums || []));
        audioAssetCues.push(...(node.audioAssetCues || []));
        collapsedLabels.push(node.label);
        collapsedLabels.push(...(node.collapsedLabels || []));
        if (node.characterDialogue) {
          for (const [char, stats] of Object.entries(node.characterDialogue)) {
            if (!characterDialogue[char]) {
              characterDialogue[char] = { lineCount: 0, wordCount: 0 };
            }
            characterDialogue[char].lineCount += stats.lineCount;
            characterDialogue[char].wordCount += stats.wordCount;
          }
        }
        if (node.mutations) {
          mutations.push(...node.mutations);
        }
        if (node.isShadowed) isShadowed = true;
        if (node.isTerminalOutcome) isTerminalOutcome = true;
        collapsedInto.set(node.id, rootId);
      }

      const collapsedLocations = path
        .map((id) => nodeMap.get(id)?.sourceLocation)
        .filter((loc): loc is NonNullable<typeof loc> => Boolean(loc));

      const combinedSourceLocation = combineSourceLocations(
        collapsedLocations,
        rootNode.sourceLocation,
      );

      mergedNodesMap.set(rootId, {
        ...rootNode,
        dialogueCount,
        wordCount,
        pauseDuration,
        dialogueLines,
        dialogueLineNums,
        audioAssetCues,
        collapsedLabels,
        characterDialogue: Object.keys(characterDialogue).length > 0
          ? characterDialogue
          : undefined,
        collapsedLocations: collapsedLocations.length > 0
          ? collapsedLocations
          : rootNode.collapsedLocations,
        sourceLocation: combinedSourceLocation,
        mutations: mutations.length > 0 ? mutations : undefined,
        isShadowed,
        isTerminalOutcome,
      });
    }
  }

  // 3. Filter and map nodes
  const finalNodes: FlowNode[] = [];
  for (const node of nodes) {
    if (collapsedInto.has(node.id)) continue;
    if (mergedNodesMap.has(node.id)) {
      finalNodes.push(mergedNodesMap.get(node.id)!);
    } else {
      finalNodes.push(node);
    }
  }

  // 4. Filter and map edges
  const collapsedEdgeIds = new Set<string>();
  for (const edge of collapsibleEdges.values()) {
    collapsedEdgeIds.add(edge.id);
  }

  const finalEdges: FlowEdge[] = [];
  const addedSelfLoopRoots = new Set<string>();

  for (const edge of edges) {
    const sRoot = collapsedInto.get(edge.source) ?? edge.source;
    const tRoot = collapsedInto.get(edge.target) ?? edge.target;

    const updatedCallContext = edge.callContext
      ? {
        ...edge.callContext,
        callSiteId: collapsedInto.get(edge.callContext.callSiteId) ??
          edge.callContext.callSiteId,
        returnTargetId: collapsedInto.get(edge.callContext.returnTargetId) ??
          edge.callContext.returnTargetId,
      }
      : undefined;

    if (collapsedEdgeIds.has(edge.id)) {
      if (
        sRoot === tRoot && cycleRoots.has(sRoot) &&
        !addedSelfLoopRoots.has(sRoot)
      ) {
        addedSelfLoopRoots.add(sRoot);
        finalEdges.push({
          ...edge,
          id: `${edge.kind || "sequence"}_${sRoot}__${tRoot}__loop`,
          source: sRoot,
          target: tRoot,
          callContext: updatedCallContext,
        });
      }
      continue;
    }

    if (collapsedInto.has(edge.source) || collapsedInto.has(edge.target)) {
      finalEdges.push({
        ...edge,
        id: `${edge.id}__collapsed`,
        source: sRoot,
        target: tRoot,
        callContext: updatedCallContext,
      });
    } else {
      finalEdges.push(
        updatedCallContext !== edge.callContext
          ? { ...edge, callContext: updatedCallContext }
          : edge,
      );
    }
  }

  return { nodes: finalNodes, edges: finalEdges };
}
