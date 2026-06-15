import type { FlowNode } from "../domain/index.ts";

export function deriveCollapsedLabelChildren(
  nodes: FlowNode[],
  collapsedParentLabels: Record<string, boolean>,
): Set<string> {
  const collapsedChildren = new Set<string>();
  for (const node of nodes) {
    if (node.type !== "MENU") continue;
    if (!node.parentLabelId) continue;
    if (!collapsedParentLabels[node.parentLabelId]) continue;
    collapsedChildren.add(node.id);
  }
  return collapsedChildren;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(",");
  const meta = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : dataUrl;
  const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : "";
  const isBase64 = meta.includes(";base64");
  const mimeMatch = meta.match(/data:([^;]+)/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  if (isBase64) {
    const decoded = atob(data);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }
  try {
    return new Blob([decodeURIComponent(data)], { type: mimeType });
  } catch {
    return new Blob([data], { type: mimeType });
  }
}
