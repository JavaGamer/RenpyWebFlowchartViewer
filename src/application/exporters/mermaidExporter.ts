import type { FlowEdge, FlowNode } from "../../domain/index.ts";

export function exportMermaid(nodes: FlowNode[], edges: FlowEdge[]): string {
  let mermaid = "flowchart TD\n";
  const idMap = new Map<string, string>();
  const usedSanitizedIds = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const rawSanitized = "n_" + node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    let safeId = rawSanitized;
    let suffix = i;
    while (usedSanitizedIds.has(safeId)) {
      safeId = `${rawSanitized}_${suffix++}`;
    }
    usedSanitizedIds.add(safeId);
    idMap.set(node.id, safeId);

    const label = (node.label || node.id)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "'")
      .replace(/\|/g, "&#124;")
      .replace(/\[/g, "&#91;")
      .replace(/\]/g, "&#93;")
      .replace(/\{/g, "&#123;")
      .replace(/\}/g, "&#125;")
      .replace(/\(/g, "&#40;")
      .replace(/\)/g, "&#41;")
      .replace(/\r?\n/g, "<br/>");

    let shapeStart = '["';
    let shapeEnd = '"]';

    if (node.type === "DECISION" || node.type === "MENU") {
      shapeStart = '{"';
      shapeEnd = '"}';
    } else if (node.isTerminalOutcome) {
      shapeStart = '(["';
      shapeEnd = '"])';
    }

    mermaid += `  ${safeId}${shapeStart}${label}${shapeEnd}\n`;
  }

  for (const edge of edges) {
    const source = idMap.get(edge.source) ||
      ("n_" + edge.source.replace(/[^a-zA-Z0-9_]/g, "_"));
    const target = idMap.get(edge.target) ||
      ("n_" + edge.target.replace(/[^a-zA-Z0-9_]/g, "_"));
    const sanitizedLabel = edge.label
      ? edge.label
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "'")
          .replace(/\|/g, "&#124;")
          .replace(/\[/g, "&#91;")
          .replace(/\]/g, "&#93;")
          .replace(/\{/g, "&#123;")
          .replace(/\}/g, "&#125;")
          .replace(/\(/g, "&#40;")
          .replace(/\)/g, "&#41;")
          .replace(/\r?\n/g, "<br/>")
      : "";
    const label = sanitizedLabel ? `|"${sanitizedLabel}"|` : "";
    mermaid += `  ${source} -->${label} ${target}\n`;
  }

  return mermaid;
}
