import type {
  CanvasNode,
  FlowNode,
  NodeData,
} from "../index.ts";

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
  const nodeHeight = node.measured?.height ??
    (node.type === "labelNode"
      ? getLabelHeight({
        isShadowed: nodeData.isShadowed,
        isTerminalOutcome: nodeData.isTerminalOutcome,
      })
      : node.type === "menuNode"
      ? NODE_HEIGHT_MENU
      : NODE_HEIGHT_DECISION);
  return {
    x: node.position.x + NODE_WIDTH / 2,
    y: node.position.y + nodeHeight / 2,
  };
}
