import type { CanvasNode, FlowNode, NodeData } from "../index.ts";

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

/**
 * Computes the correct pixel height for a LABEL node based on its visual variant
 * (shadowed, terminal outcome, or standard).
 */
export function getLabelHeight(
  params: { isShadowed?: boolean; isTerminalOutcome?: boolean },
): number {
  if (params.isShadowed) return NODE_HEIGHT_LABEL_SHADOWED;
  if (params.isTerminalOutcome) return NODE_HEIGHT_LABEL_TERMINAL;
  return NODE_HEIGHT_LABEL;
}

/**
 * Returns the pixel height for any node type: dispatches to
 * the appropriate constant or `getLabelHeight` and adds extra
 * padding if audio/asset cues are present.
 */
export function getNodeHeight(
  node: Pick<
    FlowNode,
    "type" | "isShadowed" | "isTerminalOutcome" | "audioAssetCues"
  >,
): number {
  if (node.type === "MENU") return NODE_HEIGHT_MENU;
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
      isShadowed: nodeData.isShadowed,
      isTerminalOutcome: nodeData.isTerminalOutcome,
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
