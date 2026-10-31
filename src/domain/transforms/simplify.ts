import type {
  CallArgument,
  CallContext,
  ConditionBranchKind,
  ConditionMetadata,
  EdgeKind,
  FlowEdge,
  FlowNode,
  SourceLocation,
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
 * Clean Story Graph pass-through.
 * Under the modern AST story graph engine, node explosion does not occur,
 * so artificial node inlining and chain collapsing are unnecessary.
 */
export function simplifyGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options?: GraphSimplificationOptions,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (options?.collapseLinearChains) {
    return collapseLinearChains(nodes, edges);
  }
  return { nodes, edges };
}

function serializeCallArguments(args?: CallArgument[]): string {
  if (!args || args.length === 0) return "";
  return args
    .map((a) => `${a.name ?? ""}=${a.value}`)
    .sort()
    .join(";");
}

function serializeCallContext(ctx?: CallContext): string {
  if (!ctx) return "";
  return `${ctx.callSiteId ?? ""}__${ctx.returnTargetId ?? ""}__${
    ctx.callContextId ?? ""
  }`;
}

function serializeTimeout(t?: FlowEdge["timeout"]): string {
  if (!t) return "";
  return `${t.isTimeout}_${t.durationSeconds ?? ""}`;
}

/**
 * Pre-layout transform that collapses child MENU nodes belonging to collapsed parent labels
 * and transitively redirects their outgoing choice edges to the parent label so downstream
 * narrative branches stay connected and the layout compacts cleanly.
 */
export function collapseParentLabelSubgraphs(
  nodes: FlowNode[],
  edges: FlowEdge[],
  collapsedParentLabels?: Record<string, boolean>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (!collapsedParentLabels) {
    return { nodes, edges };
  }

  const collapsedMenuIds = new Set<string>();
  for (const node of nodes) {
    if (
      node.type === "MENU" &&
      node.parentLabelId &&
      collapsedParentLabels[node.parentLabelId]
    ) {
      collapsedMenuIds.add(node.id);
    }
  }

  if (collapsedMenuIds.size === 0) {
    return { nodes, edges };
  }

  const outgoingBySource = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    const list = outgoingBySource.get(edge.source) ?? [];
    list.push(edge);
    outgoingBySource.set(edge.source, list);
  }

  const newEdges: FlowEdge[] = [];

  for (const u of nodes) {
    if (collapsedMenuIds.has(u.id)) continue;

    const emittedEdgeKeys = new Set<string>();
    const visitedQueueStates = new Set<string>();

    const queue: Array<{
      nodeId: string;
      label: string;
      kind: EdgeKind;
      condition?: ConditionMetadata;
      timeout?: FlowEdge["timeout"];
      arguments?: CallArgument[];
      sourceLocation?: SourceLocation;
      callContext?: CallContext;
      originalId: string;
      isRedirected: boolean;
      pathVisited: Set<string>;
    }> = [];

    for (const edge of outgoingBySource.get(u.id) ?? []) {
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
        isRedirected: false,
        pathVisited: new Set([edge.target]),
      });
    }

    let head = 0;
    const MAX_QUEUE = 1000;
    while (head < queue.length && head < MAX_QUEUE) {
      const current = queue[head++]!;

      if (!collapsedMenuIds.has(current.nodeId)) {
        const edgeKey = `${current.nodeId}__${current.kind}__${
          current.condition?.expression ?? ""
        }__${current.condition?.branchKind ?? ""}__${current.label || ""}__${
          serializeTimeout(current.timeout)
        }__${serializeCallArguments(current.arguments)}__${
          serializeCallContext(current.callContext)
        }`;
        if (emittedEdgeKeys.has(edgeKey)) {
          continue;
        }
        emittedEdgeKeys.add(edgeKey);

        newEdges.push({
          id: current.isRedirected
            ? `${
              current.kind || "sequence"
            }_${u.id}__${current.nodeId}__collapsed_label_${current.originalId}_${newEdges.length}`
            : current.originalId,
          source: u.id,
          target: current.nodeId,
          kind: current.kind,
          label: current.label || undefined,
          condition: current.condition,
          timeout: current.timeout,
          arguments: current.arguments,
          sourceLocation: current.sourceLocation,
          callContext: current.callContext,
        });
        continue;
      }

      const nextEdges = outgoingBySource.get(current.nodeId) ?? [];
      for (const nextEdge of nextEdges) {
        if (
          collapsedMenuIds.has(nextEdge.target) &&
          current.pathVisited.has(nextEdge.target)
        ) {
          continue;
        }

        const mergedLabel = nextEdge.label || current.label || "";
        let mergedKind: EdgeKind = current.kind;
        if (nextEdge.kind === "call_return" || mergedKind === "call_return") {
          mergedKind = "call_return";
        } else if (nextEdge.kind === "call" || mergedKind === "call") {
          mergedKind = "call";
        } else if (nextEdge.kind === "jump" || mergedKind === "jump") {
          mergedKind = "jump";
        } else {
          mergedKind = "sequence";
        }

        let mergedCondition = nextEdge.condition || current.condition;
        if (current.condition && nextEdge.condition) {
          const exp1 = current.condition.expression;
          const exp2 = nextEdge.condition.expression;
          const mergedExpression = exp1 && exp2
            ? `(${exp1}) and (${exp2})`
            : exp1 || exp2;
          const mergedRefs = Array.from(
            new Set([
              ...(current.condition.references || []),
              ...(nextEdge.condition.references || []),
            ]),
          ).sort();
          const branchKind: ConditionBranchKind =
            current.condition.branchKind === "if" ||
              nextEdge.condition.branchKind === "if"
              ? "if"
              : current.condition.branchKind === "else" &&
                  nextEdge.condition.branchKind === "else"
              ? "else"
              : "elif";
          mergedCondition = {
            branchKind,
            expression: mergedExpression,
            references: mergedRefs,
            decisionNodeId: nextEdge.condition.decisionNodeId ||
              current.condition.decisionNodeId,
          };
        }

        const mergedTimeout = nextEdge.timeout || current.timeout;
        const mergedArguments = nextEdge.arguments || current.arguments;
        const mergedCallContext = nextEdge.callContext || current.callContext;

        if (collapsedMenuIds.has(nextEdge.target)) {
          const queueKey = `${nextEdge.target}__${mergedKind}__${
            mergedCondition?.expression ?? ""
          }__${mergedLabel}`;
          if (visitedQueueStates.has(queueKey)) {
            continue;
          }
          visitedQueueStates.add(queueKey);
        }

        const nextVisited = new Set(current.pathVisited);
        nextVisited.add(nextEdge.target);

        if (queue.length < MAX_QUEUE) {
          queue.push({
            nodeId: nextEdge.target,
            label: mergedLabel,
            kind: mergedKind,
            condition: mergedCondition,
            timeout: mergedTimeout,
            arguments: mergedArguments,
            sourceLocation: nextEdge.sourceLocation || current.sourceLocation,
            callContext: mergedCallContext,
            originalId: nextEdge.id || current.originalId,
            isRedirected: true,
            pathVisited: nextVisited,
          });
        }
      }
    }
  }

  const remainingNodes = nodes.filter((n) => !collapsedMenuIds.has(n.id));
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

  const collapsibleEdges = new Map<string, FlowEdge>();
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
      A.label?.toLowerCase() !== "start" &&
      B.id !== "start" &&
      B.label?.toLowerCase() !== "start" &&
      (outgoing.get(A.id)?.length ?? 0) === 1 &&
      (incoming.get(B.id)?.length ?? 0) === 1 &&
      !edge.label &&
      !edge.condition &&
      !edge.timeout &&
      (edge.kind === "sequence" || edge.kind === "jump" ||
        edge.kind === "fallthrough")
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
    if (locations.length === 1) return locations[0];
    const file = fallback?.file || locations[0]!.file;

    let minLine = Infinity;
    let minCol = Infinity;
    let minOffset = Infinity;
    let maxLine = -Infinity;
    let maxCol = -Infinity;
    let maxOffset = -Infinity;
    let count = 0;

    for (let i = 0; i < locations.length; i++) {
      const l = locations[i]!;
      if (l.file !== file) continue;
      count++;
      if (
        l.start.line < minLine ||
        (l.start.line === minLine && l.start.character < minCol)
      ) {
        minLine = l.start.line;
        minCol = l.start.character;
        if (l.start.offset !== undefined) minOffset = l.start.offset;
      }
      if (
        l.end.line > maxLine ||
        (l.end.line === maxLine && l.end.character > maxCol)
      ) {
        maxLine = l.end.line;
        maxCol = l.end.character;
        if (l.end.offset !== undefined) maxOffset = l.end.offset;
      }
    }

    if (count === 0) return fallback;

    return {
      file,
      start: {
        line: minLine,
        character: minCol !== Infinity ? minCol : 0,
        offset: minOffset !== Infinity ? minOffset : 0,
      },
      end: {
        line: maxLine,
        character: maxCol !== -Infinity ? maxCol : 0,
        offset: maxOffset !== -Infinity ? maxOffset : 0,
      },
    };
  }

  function collapsePath(path: string[]) {
    if (path.length <= 1) return;
    const rootId = path[0]!;
    const rootNode = nodeMap.get(rootId)!;
    let dialogueCount = rootNode.dialogueCount;
    let wordCount = rootNode.wordCount ?? 0;
    let pauseDuration = rootNode.pauseDuration ?? 0;
    const dialogueLines = [...(rootNode.dialogueLines || [])];
    const dialogueLineNums = [...(rootNode.dialogueLineNums || [])];
    const audioAssetCues = [...(rootNode.audioAssetCues || [])];
    const collapsedLabels = [...(rootNode.collapsedLabels || [])];
    const collapsedNodeIds =
      rootNode.collapsedNodeIds && rootNode.collapsedNodeIds.length > 0
        ? [...rootNode.collapsedNodeIds]
        : [rootId];
    let isShadowed = rootNode.isShadowed;
    let isTerminalOutcome = rootNode.isTerminalOutcome;

    for (let i = 1; i < path.length; i++) {
      const node = nodeMap.get(path[i]!)!;
      dialogueCount += node.dialogueCount;
      wordCount += node.wordCount ?? 0;
      pauseDuration += node.pauseDuration ?? 0;
      dialogueLines.push(...(node.dialogueLines || []));
      dialogueLineNums.push(...(node.dialogueLineNums || []));
      audioAssetCues.push(...(node.audioAssetCues || []));
      collapsedLabels.push(node.label);
      collapsedLabels.push(...(node.collapsedLabels || []));
      collapsedNodeIds.push(node.id);
      collapsedNodeIds.push(...(node.collapsedNodeIds || []));
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
      collapsedNodeIds,
      collapsedLocations: collapsedLocations.length > 0
        ? collapsedLocations
        : rootNode.collapsedLocations,
      sourceLocation: combinedSourceLocation,
      isShadowed,
      isTerminalOutcome,
    });
  }

  const visited = new Set<string>();

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
      if (nextId === rootId) break;
      if (visited.has(nextId)) break;
      visited.add(nextId);
      path.push(nextId);
      currentId = nextId;
    }

    collapsePath(path);
  }

  for (const startId of hasOutgoingCollapsible) {
    if (visited.has(startId)) continue;
    visited.add(startId);

    let currentId = startId;
    const path: string[] = [startId];

    while (collapsibleEdges.has(currentId)) {
      const edge = collapsibleEdges.get(currentId)!;
      const nextId = edge.target;
      if (nextId === startId) break;
      if (visited.has(nextId)) break;
      visited.add(nextId);
      path.push(nextId);
      currentId = nextId;
    }

    collapsePath(path);
  }

  const finalNodes: FlowNode[] = [];
  for (const node of nodes) {
    if (collapsedInto.has(node.id)) continue;
    if (mergedNodesMap.has(node.id)) {
      finalNodes.push(mergedNodesMap.get(node.id)!);
    } else {
      finalNodes.push(node);
    }
  }

  function resolveRoot(id: string): string {
    let curr = id;
    while (collapsedInto.has(curr)) {
      curr = collapsedInto.get(curr)!;
    }
    return curr;
  }

  const finalEdges: FlowEdge[] = [];
  for (const edge of edges) {
    const sRoot = resolveRoot(edge.source);
    const tRoot = resolveRoot(edge.target);
    if (sRoot === tRoot) {
      if (
        edge.source !== edge.target &&
        !finalEdges.some((e) => e.source === sRoot && e.target === tRoot)
      ) {
        finalEdges.push({
          ...edge,
          id: `${edge.id}__collapsed_loop`,
          source: sRoot,
          target: tRoot,
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
      });
    } else {
      finalEdges.push(edge);
    }
  }

  return { nodes: finalNodes, edges: finalEdges };
}
