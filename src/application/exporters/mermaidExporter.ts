import type { FlowEdge, FlowNode } from "../../domain/index.ts";

function sanitizeMermaidText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, "<br/>")
    .replace(/"/g, "'")
    .replace(/\|/g, "#124;")
    .trim();
}

export function exportToMermaid(nodes: FlowNode[], edges: FlowEdge[]): string {
  const lines: string[] = ["flowchart TD"];
  const idMap = new Map<string, string>();

  nodes.forEach((node, idx) => {
    const safeId = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(node.id)
      ? node.id
      : `node_${idx}_${node.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    idMap.set(node.id, safeId);
  });

  const getSafeId = (id: string): string => {
    let safe = idMap.get(id);
    if (!safe) {
      safe = `node_${idMap.size}_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      idMap.set(id, safe);
    }
    return safe;
  };

  for (const node of nodes) {
    const safeId = getSafeId(node.id);
    const escapedLabel = sanitizeMermaidText(node.label);
    if (node.type === "MENU") {
      lines.push(`  ${safeId}{{"${escapedLabel}"}}`);
    } else if (node.type === "DECISION") {
      lines.push(`  ${safeId}{"${escapedLabel}"}`);
    } else {
      lines.push(`  ${safeId}["${escapedLabel}"]`);
    }
  }

  for (const edge of edges) {
    const safeSource = getSafeId(edge.source);
    const safeTarget = getSafeId(edge.target);
    let edgeStr = `  ${safeSource} -->`;
    const labelText =
      edge.kind === "call_return" && edge.callContext?.returnTargetId
        ? `return to ${edge.callContext.returnTargetId}`
        : (edge.label ?? "");
    if (labelText) {
      edgeStr += `|"${sanitizeMermaidText(labelText)}"|`;
    }
    edgeStr += ` ${safeTarget}`;
    lines.push(edgeStr);
  }

  return lines.join("\n");
}
