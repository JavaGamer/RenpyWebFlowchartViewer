import type { CanvasNode, FlowEdge, FlowNode, NodeData } from "../index.ts";

/** Standard node width in pixels used across all node types in the layout. */
export const NODE_WIDTH = 220;
/** Base height for a standard LABEL node. */
export const NODE_HEIGHT_LABEL = 90;
/** Additional height for terminal story outcome LABEL nodes. */
export const NODE_HEIGHT_LABEL_TERMINAL = 104;
/** Increased height for shadowed (duplicate) LABEL nodes to accommodate the shadow indicator. */
export const NODE_HEIGHT_LABEL_SHADOWED = 122;
/** Height for MENU choice nodes. */
export const NODE_HEIGHT_MENU = 80;
// Keep this aligned with the rendered decision node height (diamond + vertical padding).
/** Height for DECISION branching nodes (diamond shape plus vertical padding). */
export const NODE_HEIGHT_DECISION = 176;
/** Width for collapsed chapter summary nodes on the canvas. */
export const CHAPTER_SUMMARY_WIDTH = 260;
/** Height for collapsed chapter summary nodes on the canvas. */
export const CHAPTER_SUMMARY_HEIGHT = 110;
/** Padding inside expanded chapter container boxes. */
export const CHAPTER_CONTAINER_PADDING = {
  top: 50,
  left: 24,
  bottom: 24,
  right: 24,
};
/** Header height for expanded chapter containers. */
export const CHAPTER_HEADER_HEIGHT = 44;

/**
 * Nodes below this count use the full Dagre layout.
 * Above it, `applyDagreLayout` switches to `applyProgressiveDagreLayout`
 * to avoid long stalls on very large graphs.
 */
export const PROGRESSIVE_LAYOUT_NODE_LIMIT = 220;

export type NodeHeightInput =
  & Pick<FlowNode, "type">
  & Partial<
    Pick<
      FlowNode,
      | "label"
      | "isShadowed"
      | "isTerminalOutcome"
      | "isOrphan"
      | "collapsedLabels"
      | "mutations"
      | "audioAssetCues"
    >
  >;

/**
 * Computes the correct pixel height for a LABEL node based on its visual variant
 * (shadowed, terminal outcome, or standard), wrapped label text, and header badges.
 */
export function getLabelHeight(
  params: Partial<Omit<NodeHeightInput, "type">>,
): number {
  let height = NODE_HEIGHT_LABEL;
  if (params.isShadowed) {
    height = NODE_HEIGHT_LABEL_SHADOWED;
  } else if (params.isTerminalOutcome) {
    height = NODE_HEIGHT_LABEL_TERMINAL;
  }

  if ((params.label?.length ?? 0) > 24) {
    height += 20;
  }

  let badgeCount = 0;
  if (params.isOrphan || params.isTerminalOutcome) badgeCount += 1;
  if (params.isShadowed) badgeCount += 1;
  if ((params.collapsedLabels?.length ?? 0) > 0) badgeCount += 1;
  if ((params.mutations?.length ?? 0) > 0) badgeCount += 1;
  if (badgeCount >= 2) {
    height += 22;
  }

  return height;
}

/**
 * Returns the pixel height for any node type: dispatches to
 * the appropriate constant or `getLabelHeight` and adds extra
 * padding if titles wrap or audio/asset cues are present.
 */
export function getNodeHeight(node: NodeHeightInput): number {
  if (node.type === "MENU") {
    return (node.label?.length ?? 0) > 24
      ? NODE_HEIGHT_MENU + 20
      : NODE_HEIGHT_MENU;
  }
  if (node.type === "DECISION") return NODE_HEIGHT_DECISION;
  const baseHeight = getLabelHeight(node);
  if (node.audioAssetCues && node.audioAssetCues.length > 0) {
    return baseHeight + 24;
  }
  return baseHeight;
}

/**
 * Computes the center pixel coordinate of a node using its position and measured
 * (or estimated) height. Used for viewport centering when focusing a node.
 */
export function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  const nodeData = node.data as NodeData;
  if (node.type === "chapterNode") {
    const w = node.measured?.width ??
      (typeof node.style?.width === "number"
        ? node.style.width
        : node.width ?? CHAPTER_SUMMARY_WIDTH);
    const h = node.measured?.height ??
      (typeof node.style?.height === "number"
        ? node.style.height
        : node.height ?? CHAPTER_SUMMARY_HEIGHT);
    return {
      x: node.position.x + w / 2,
      y: node.position.y + h / 2,
    };
  }
  const nodeWidth = node.measured?.width ?? node.width ?? NODE_WIDTH;
  const nodeHeight = node.measured?.height ??
    getNodeHeight({
      type: node.type === "menuNode"
        ? "MENU"
        : node.type === "decisionNode"
        ? "DECISION"
        : node.type === "screenCallNode"
        ? "SCREEN_CALL"
        : node.type === "syntaxErrorNode"
        ? "SYNTAX_ERROR"
        : "LABEL",
      label: nodeData.label,
      isShadowed: nodeData.isShadowed,
      isTerminalOutcome: nodeData.isTerminalOutcome,
      isOrphan: nodeData.isOrphan,
      collapsedLabels: nodeData.collapsedLabels,
      mutations: nodeData.mutations,
      audioAssetCues: nodeData.audioAssetCues,
    });
  return {
    x: node.position.x + nodeWidth / 2,
    y: node.position.y + nodeHeight / 2,
  };
}

export interface ClusterBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Computes tight bounding box and container dimensions for a collection of laid-out child nodes.
 */
export function computeClusterBoundingBox(
  placedNodes: Array<{ x: number; y: number; width: number; height: number }>,
  padding = CHAPTER_CONTAINER_PADDING,
  minWidth = 280,
  minHeight = 160,
): ClusterBoundingBox {
  if (placedNodes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: minWidth,
      maxY: minHeight,
      width: minWidth,
      height: minHeight,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of placedNodes) {
    const left = node.x - node.width / 2;
    const right = node.x + node.width / 2;
    const top = node.y - node.height / 2;
    const bottom = node.y + node.height / 2;

    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  }

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;

  const width = Math.max(minWidth, contentWidth + padding.left + padding.right);
  const height = Math.max(
    minHeight,
    contentHeight + padding.top + padding.bottom,
  );

  return { minX, minY, maxX, maxY, width, height };
}

/**
 * Converts a child node's Dagre center coordinates into relative top-left position
 * inside its parent chapter container.
 */
export function normalizeChildPosition(
  dagreNode: { x: number; y: number },
  nodeWidth: number,
  nodeHeight: number,
  minX: number,
  minY: number,
  padding = CHAPTER_CONTAINER_PADDING,
): { x: number; y: number } {
  return {
    x: (dagreNode.x - nodeWidth / 2 - minX) + padding.left,
    y: (dagreNode.y - nodeHeight / 2 - minY) + padding.top,
  };
}

/**
 * Normalizes the geometry of fork-and-rejoin structures (diamonds).
 * 1. Branch Rank Equalization: Immediate branch head nodes from a fork node share the same tier level.
 * 2. Join Centering: The reconvergence join node is centered horizontally beneath the branch centroid.
 */
export function normalizeForkRejoinGeometry(
  nodes: CanvasNode[],
  edges: FlowEdge[],
  direction: "TB" | "LR" = "TB",
): void {
  if (nodes.length === 0 || edges.length === 0) return;

  const nodeById = new Map<string, CanvasNode>();
  for (const n of nodes) {
    if (n.type !== "chapterNode") {
      nodeById.set(n.id, n);
    }
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;

    let outList = outgoing.get(e.source);
    if (!outList) {
      outList = [];
      outgoing.set(e.source, outList);
    }
    outList.push(e.target);

    let inList = incoming.get(e.target);
    if (!inList) {
      inList = [];
      incoming.set(e.target, inList);
    }
    inList.push(e.source);
  }

  for (const [forkId, targets] of outgoing.entries()) {
    if (targets.length < 2) continue;
    const forkNode = nodeById.get(forkId);
    if (!forkNode) continue;

    const branchNodes: CanvasNode[] = [];
    for (const tId of targets) {
      const bn = nodeById.get(tId);
      if (bn && bn.parentId === forkNode.parentId) {
        branchNodes.push(bn);
      }
    }
    if (branchNodes.length < 2) continue;

    // 1. Branch Rank Equalization (only for immediate sibling heads within the same tier band)
    if (direction === "TB") {
      let minY = Infinity;
      for (const bn of branchNodes) {
        if (bn.position.y < minY) minY = bn.position.y;
      }
      const immediateBranches = branchNodes.filter(
        (bn) => Math.abs(bn.position.y - minY) < 120,
      );
      if (immediateBranches.length >= 2) {
        let maxY = -Infinity;
        for (const bn of immediateBranches) {
          if (bn.position.y > maxY) maxY = bn.position.y;
        }
        for (const bn of immediateBranches) {
          const inDegree = incoming.get(bn.id)?.length ?? 0;
          if (inDegree === 1 && bn.position.y < maxY) {
            bn.position.y = maxY;
          }
        }
      }
    } else {
      let minX = Infinity;
      for (const bn of branchNodes) {
        if (bn.position.x < minX) minX = bn.position.x;
      }
      const immediateBranches = branchNodes.filter(
        (bn) => Math.abs(bn.position.x - minX) < 120,
      );
      if (immediateBranches.length >= 2) {
        let maxX = -Infinity;
        for (const bn of immediateBranches) {
          if (bn.position.x > maxX) maxX = bn.position.x;
        }
        for (const bn of immediateBranches) {
          const inDegree = incoming.get(bn.id)?.length ?? 0;
          if (inDegree === 1 && bn.position.x < maxX) {
            bn.position.x = maxX;
          }
        }
      }
    }

    // 2. Identify potential Join node
    const targetSets = branchNodes.map((bn) =>
      new Set(outgoing.get(bn.id) ?? [])
    );
    const commonTargets: string[] = [];
    if (targetSets.length > 0) {
      const firstSet = targetSets[0]!;
      for (const candidate of firstSet) {
        if (candidate !== forkId && targetSets.every((s) => s.has(candidate))) {
          commonTargets.push(candidate);
        }
      }
    }

    for (const joinId of commonTargets) {
      const joinNode = nodeById.get(joinId);
      if (!joinNode || joinNode.parentId !== forkNode.parentId) continue;

      const joinIncoming = incoming.get(joinId) ?? [];
      const branchIdSet = new Set(branchNodes.map((b) => b.id));
      const allFromBranches = joinIncoming.every((src) => branchIdSet.has(src));

      if (allFromBranches) {
        if (direction === "TB") {
          let minX = Infinity;
          let maxX = -Infinity;
          for (const bn of branchNodes) {
            const w = bn.measured?.width ?? bn.width ?? NODE_WIDTH;
            if (bn.position.x < minX) minX = bn.position.x;
            if (bn.position.x + w > maxX) maxX = bn.position.x + w;
          }
          const joinWidth = joinNode.measured?.width ?? joinNode.width ??
            NODE_WIDTH;
          const centeredX = (minX + maxX) / 2 - joinWidth / 2;
          joinNode.position.x = centeredX;
        } else {
          let minY = Infinity;
          let maxY = -Infinity;
          for (const bn of branchNodes) {
            const h = bn.measured?.height ?? bn.height ?? 80;
            if (bn.position.y < minY) minY = bn.position.y;
            if (bn.position.y + h > maxY) maxY = bn.position.y + h;
          }
          const joinHeight = joinNode.measured?.height ?? joinNode.height ??
            80;
          const centeredY = (minY + maxY) / 2 - joinHeight / 2;
          joinNode.position.y = centeredY;
        }
      }
    }
  }
}
