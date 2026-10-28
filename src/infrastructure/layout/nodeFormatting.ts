import type { CanvasNode, FlowNode, NodeData } from "../../domain/index.ts";
import type { ElkEdge } from "./types.ts";

export function buildCanvasNodeData(n: FlowNode): NodeData {
  return {
    label: n.label,
    dialogueCount: n.dialogueCount,
    wordCount: n.wordCount,
    pauseDuration: n.pauseDuration,
    dialogueLines: n.dialogueLines,
    dialogueLineNums: n.dialogueLineNums,
    audioAssetCues: n.audioAssetCues,
    mutations: n.mutations,
    nodeType: n.type,
    chapter: n.chapter,
    parentLabelId: n.parentLabelId,
    role: n.role,
    isShadowed: n.isShadowed,
    shadowOfId: n.shadowOfId,
    isTerminalOutcome: n.isTerminalOutcome,
    isOrphan: n.isOrphan,
    collapsedLabels: n.collapsedLabels,
    collapsedNodeIds: n.collapsedNodeIds,
    characterDialogue: n.characterDialogue,
    conditionExpression: n.condition?.expression,
    conditionReferences: n.condition?.references,
  };
}

/**
 * Maps a domain FlowNode type to its corresponding React Flow CanvasNode type.
 */
export function mapDomainNodeTypeToCanvasType(
  type: FlowNode["type"],
): "labelNode" | "menuNode" | "decisionNode" {
  if (type === "MENU") return "menuNode";
  if (type === "DECISION") return "decisionNode";
  return "labelNode";
}

export function pointToRectBoundaryDist(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number {
  const dxOut = px < rx ? rx - px : px > rx + rw ? px - (rx + rw) : 0;
  const dyOut = py < ry ? ry - py : py > ry + rh ? py - (ry + rh) : 0;
  if (dxOut > 0 || dyOut > 0) {
    return Math.hypot(dxOut, dyOut);
  }
  return Math.min(px - rx, rx + rw - px, py - ry, ry + rh - py);
}

/**
 * Applies translation delta alignment using absolute leaf node coordinates
 * (falling back to container IDs when all chapters are collapsed) so toggling
 * layout settings or compound mode keeps the graph visually anchored.
 */
export function applyLeafTranslationAlignment(
  nodes: CanvasNode[],
  previousPositions?:
    | Map<string, { x: number; y: number }>
    | Array<[string, { x: number; y: number }]>,
  elkEdgeMap?: Map<string, ElkEdge>,
): void {
  if (!previousPositions) return;
  const prevMap = previousPositions instanceof Map
    ? previousPositions
    : new Map(previousPositions);
  if (prevMap.size === 0) return;

  const nodeById = new Map<string, CanvasNode>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    nodeById.set(n.id, n);
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.type === "chapterNode") continue;
    const prev = prevMap.get(n.id);
    if (!prev) continue;

    let absX = n.position.x;
    let absY = n.position.y;
    if (n.parentId) {
      const parent = nodeById.get(n.parentId);
      if (parent) {
        absX += parent.position.x;
        absY += parent.position.y;
      }
    }
    sumX += prev.x - absX;
    sumY += prev.y - absY;
    count += 1;
  }

  if (count === 0) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const prev = prevMap.get(n.id);
      if (prev) {
        sumX += prev.x - n.position.x;
        sumY += prev.y - n.position.y;
        count += 1;
      }
    }
  }

  if (count === 0) return;

  const deltaX = sumX / count;
  const deltaY = sumY / count;
  if (Math.abs(deltaX) < 1e-6 && Math.abs(deltaY) < 1e-6) return;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (!n.parentId) {
      n.position = {
        x: n.position.x + deltaX,
        y: n.position.y + deltaY,
      };
    }
  }

  if (elkEdgeMap) {
    for (const edge of elkEdgeMap.values()) {
      edge.sections?.forEach((section) => {
        if (section.startPoint) {
          section.startPoint.x += deltaX;
          section.startPoint.y += deltaY;
        }
        if (section.endPoint) {
          section.endPoint.x += deltaX;
          section.endPoint.y += deltaY;
        }
        section.bendPoints?.forEach((bp) => {
          bp.x += deltaX;
          bp.y += deltaY;
        });
      });
      edge.junctionPoints?.forEach((jp) => {
        jp.x += deltaX;
        jp.y += deltaY;
      });
    }
  }
}
