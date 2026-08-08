import type { FlowEdge, FlowNode } from "../../domain/index.ts";

function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function exportToMermaid(nodes: FlowNode[], edges: FlowEdge[]): string {
  const lines: string[] = ["flowchart TD"];

  for (const node of nodes) {
    const safeId = sanitizeMermaidId(node.id);
    const escapedLabel = node.label.replace(/"/g, "'");
    if (node.type === "MENU") {
      lines.push(`  ${safeId}{{"${escapedLabel}"}}`);
    } else if (node.type === "DECISION") {
      lines.push(`  ${safeId}{"${escapedLabel}"}`);
    } else {
      lines.push(`  ${safeId}["${escapedLabel}"]`);
    }
  }

  for (const edge of edges) {
    const safeSource = sanitizeMermaidId(edge.source);
    const safeTarget = sanitizeMermaidId(edge.target);
    let edgeStr = `  ${safeSource} -->`;
    const labelText =
      edge.kind === "call_return" && edge.callContext?.returnTargetId
        ? `return to ${edge.callContext.returnTargetId}`
        : (edge.label ?? "");
    if (labelText) {
      edgeStr += `|"${labelText.replace(/"/g, "'")}"|`;
    }
    edgeStr += ` ${safeTarget}`;
    lines.push(edgeStr);
  }

  return lines.join("\n");
}
