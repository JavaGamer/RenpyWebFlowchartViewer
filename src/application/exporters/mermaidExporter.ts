import type { FlowEdge, FlowNode } from "../../domain/index.ts";

function sanitizeMermaidText(text: string): string {
  return text
    .replace(/\\/g, "#92;")
    .replace(/\r\n|\r|\n/g, "<br/>")
    .replace(/"/g, "#quot;")
    .replace(/\|/g, "#124;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "#91;")
    .replace(/\]/g, "#93;")
    .replace(/\{/g, "#123;")
    .replace(/\}/g, "#125;")
    .trim();
}

const RESERVED_MERMAID_KEYWORDS = new Set([
  "end",
  "subgraph",
  "flowchart",
  "graph",
  "style",
  "class",
  "classdef",
  "click",
  "call",
  "interpolate",
  "linkstyle",
]);

export function exportToMermaid(nodes: FlowNode[], edges: FlowEdge[]): string {
  const lines: string[] = ["flowchart TD"];
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();

  const allocateSafeId = (id: string, idx: number): string => {
    const base = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(id) &&
        !RESERVED_MERMAID_KEYWORDS.has(id.toLowerCase())
      ? id
      : `n_${idx}_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    let candidate = base;
    let suffix = 1;
    while (usedIds.has(candidate)) {
      candidate = `${base}_${suffix++}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  nodes.forEach((node, idx) => {
    const safeId = allocateSafeId(node.id, idx);
    idMap.set(node.id, safeId);
  });

  const getSafeId = (id: string): string => {
    let safe = idMap.get(id);
    if (!safe) {
      safe = allocateSafeId(id, idMap.size);
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
      edgeStr += `|${sanitizeMermaidText(labelText)}|`;
    }
    edgeStr += ` ${safeTarget}`;
    lines.push(edgeStr);
  }

  return lines.join("\n");
}
