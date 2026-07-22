import type { FlowEdge, FlowNode } from "../../domain/index.ts";

export function exportNarrativeOutline(
  nodes: FlowNode[],
  edges: FlowEdge[],
): string {
  let md = "# Narrative Outline\n\n";
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edgesBySource = new Map<string, FlowEdge[]>();

  for (const edge of edges) {
    let list = edgesBySource.get(edge.source);
    if (!list) {
      list = [];
      edgesBySource.set(edge.source, list);
    }
    list.push(edge);
  }

  for (const node of nodes) {
    md += `## ${node.label}\n`;
    if (node.chapter) {
      md += `**Chapter**: ${node.chapter}\n\n`;
    }
    if (node.dialogueLines && node.dialogueLines.length > 0) {
      for (const rawLine of node.dialogueLines) {
        if (!rawLine) continue;
        let lineStr: string;
        if (typeof rawLine === "string") {
          lineStr = rawLine;
        } else if (typeof rawLine === "object" && rawLine !== null) {
          const obj = rawLine as { speaker?: string; text?: string };
          lineStr = obj.speaker ? `${obj.speaker}: ${obj.text ?? ""}` : String(obj.text ?? "");
        } else {
          lineStr = String(rawLine);
        }
        if (!lineStr.trim()) continue;
        const sublines = lineStr.split(/\r?\n/);
        for (const subline of sublines) {
          md += `> ${subline}\n`;
        }
      }
      md += "\n";
    }

    const outEdges = edgesBySource.get(node.id) ?? [];
    if (outEdges.length > 0) {
      md += "**Transitions**:\n";
      for (const e of outEdges) {
        const targetNode = nodeMap.get(e.target);
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
