import type { FlowEdge, FlowNode } from "../../domain/index.ts";

export function exportToMermaid(nodes: FlowNode[], edges: FlowEdge[]): string {
  const lines: string[] = ["flowchart TD"];

  for (const node of nodes) {
    const escapedLabel = node.label.replace(/"/g, "'");
    if (node.type === "MENU") {
      lines.push(`  ${node.id}{{"${escapedLabel}"}}`);
    } else if (node.type === "DECISION") {
      lines.push(`  ${node.id}{"${escapedLabel}"}`);
    } else {
      lines.push(`  ${node.id}["${escapedLabel}"]`);
    }
  }

  for (const edge of edges) {
    let edgeStr = `  ${edge.source} -->`;
    const labelText =
      edge.kind === "call_return" && edge.callContext?.returnTargetId
        ? `return to ${edge.callContext.returnTargetId}`
        : (edge.label ?? "");
    if (labelText) {
      edgeStr += `|"${labelText.replace(/"/g, "'")}"|`;
    }
    edgeStr += ` ${edge.target}`;
    lines.push(edgeStr);
  }

  return lines.join("\n");
}
