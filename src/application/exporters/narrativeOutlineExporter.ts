import type { FlowEdge, FlowNode } from "../../domain/index.ts";

export function exportNarrativeOutline(
  nodes: FlowNode[],
  edges: FlowEdge[],
): string {
  let md = "# Narrative Outline\n\n";

  for (const node of nodes) {
    md += `## ${node.label}\n`;
    if (node.chapter) {
      md += `**Chapter**: ${node.chapter}\n\n`;
    }
    if (node.dialogueLines && node.dialogueLines.length > 0) {
      for (const line of node.dialogueLines) {
        md += `> ${line}\n`;
      }
      md += "\n";
    }

    const outEdges = edges.filter((e) => e.source === node.id);
    if (outEdges.length > 0) {
      md += "**Transitions**:\n";
      for (const e of outEdges) {
        const targetNode = nodes.find((n) => n.id === e.target);
        if (targetNode) {
          md += `- ${e.label ? e.label + " " : ""}-> ${targetNode.label}\n`;
        }
      }
      md += "\n";
    }
    md += "---\n\n";
  }

  return md;
}
