import type { FlowEdge, FlowNode } from "../../domain/index.ts";

export function exportMermaid(nodes: FlowNode[], edges: FlowEdge[]): string {
  let mermaid = "flowchart TD\n";

  for (const node of nodes) {
    const id = "n_" + node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const label = (node.label || node.id).replace(/"/g, "'");

    let shapeStart = '["';
    let shapeEnd = '"]';

    if (node.type === "DECISION" || node.type === "MENU") {
      shapeStart = '{"';
      shapeEnd = '"}';
    } else if (node.isTerminalOutcome) {
      shapeStart = '(["';
      shapeEnd = '"])';
    }

    mermaid += `  ${id}${shapeStart}${label}${shapeEnd}\n`;
  }

  for (const edge of edges) {
    const source = "n_" + edge.source.replace(/[^a-zA-Z0-9_]/g, "_");
    const target = "n_" + edge.target.replace(/[^a-zA-Z0-9_]/g, "_");
    const label = edge.label ? `|"${edge.label.replace(/"/g, "'")}"|` : "";
    mermaid += `  ${source} -->${label} ${target}\n`;
  }

  return mermaid;
}
