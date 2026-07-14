
export function deriveCollapsedLabelChildren(
  nodes: Array<{
    id: string;
    type?: string;
    parentLabelId?: string | null;
    data?: {
      nodeType?: string;
      parentLabelId?: string | null;
    };
  }>,
  collapsedParentLabels: Record<string, boolean>,
): Set<string> {
  const collapsedChildren = new Set<string>();
  for (const node of nodes) {
    const type = node.data?.nodeType ?? node.type;
    const parentLabelId = node.data?.parentLabelId ?? node.parentLabelId;
    if (type !== "MENU") continue;
    if (!parentLabelId) continue;
    if (!collapsedParentLabels[parentLabelId]) continue;
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
