import diff from 'microdiff';
import type { FlowNode } from '../graph.ts';

export interface GraphDiffResult {
  addedNodeIds: string[];
  removedNodeIds: string[];
  modifiedNodeIds: string[];
  unchangedNodeIds: string[];
}

/**
 * Computes structural differences between a base flowchart node map (v1.0)
 * and a comparison node map (v1.1) using microdiff with fast-path reference checks.
 */
export function computeGraphDiff(
  baseNodes: FlowNode[],
  compareNodes: FlowNode[]
): GraphDiffResult {
  if (!Array.isArray(baseNodes) || !Array.isArray(compareNodes)) {
    return {
      addedNodeIds: [],
      removedNodeIds: [],
      modifiedNodeIds: [],
      unchangedNodeIds: [],
    };
  }

  const validBaseNodes = baseNodes.filter((n): n is FlowNode => Boolean(n && typeof n.id === 'string'));
  const validCompareNodes = compareNodes.filter((n): n is FlowNode => Boolean(n && typeof n.id === 'string'));

  const baseMap = new Map(validBaseNodes.map((n) => [n.id, n]));
  const compareMap = new Map(validCompareNodes.map((n) => [n.id, n]));

  const addedNodeIds: string[] = [];
  const removedNodeIds: string[] = [];
  const modifiedNodeIds: string[] = [];
  const unchangedNodeIds: string[] = [];

  // Check compare nodes against base nodes
  for (const [id, compNode] of compareMap) {
    const baseNode = baseMap.get(id);
    if (!baseNode) {
      addedNodeIds.push(id);
    } else if (baseNode === compNode) {
      // Identity fast-path
      unchangedNodeIds.push(id);
    } else {
      // Shallow property check before running deep microdiff
      const isShallowEqual =
        baseNode.label === compNode.label &&
        baseNode.type === compNode.type &&
        baseNode.chapter === compNode.chapter &&
        baseNode.dialogueCount === compNode.dialogueCount &&
        baseNode.wordCount === compNode.wordCount &&
        baseNode.role === compNode.role &&
        baseNode.isTerminalOutcome === compNode.isTerminalOutcome &&
        baseNode.isOrphan === compNode.isOrphan &&
        (baseNode.dialogueLines?.length ?? 0) === (compNode.dialogueLines?.length ?? 0) &&
        JSON.stringify(baseNode.characterDialogue ?? null) === JSON.stringify(compNode.characterDialogue ?? null) &&
        JSON.stringify(baseNode.audioAssetCues ?? null) === JSON.stringify(compNode.audioAssetCues ?? null);

      if (!isShallowEqual) {
        modifiedNodeIds.push(id);
      } else {
        const differences = diff(baseNode, compNode);
        if (differences.length > 0) {
          modifiedNodeIds.push(id);
        } else {
          unchangedNodeIds.push(id);
        }
      }
    }
  }

  // Check for removed nodes
  for (const [id] of baseMap) {
    if (!compareMap.has(id)) {
      removedNodeIds.push(id);
    }
  }

  return {
    addedNodeIds,
    removedNodeIds,
    modifiedNodeIds,
    unchangedNodeIds,
  };
}
