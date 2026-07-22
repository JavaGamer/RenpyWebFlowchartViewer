export function deriveCollapsedLabelChildren(
  nodes: Array<{
    id: string;
    type?: string;
    parentLabelId?: string | null;
    data?: {
      nodeType?: string;
      parentLabelId?: string | null;
      isSubLabel?: boolean;
    };
  }>,
  collapsedParentLabels: Record<string, boolean>,
): Set<string> {
  const collapsedChildren = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (collapsedChildren.has(node.id)) continue;
      const type = node.data?.nodeType ?? node.type;
      const parentLabelId = node.data?.parentLabelId ?? node.parentLabelId;
      if (!parentLabelId) continue;
      const isParentCollapsed = collapsedParentLabels[parentLabelId] || collapsedChildren.has(parentLabelId);
      if (!isParentCollapsed) continue;
      if (
        type === "MENU" ||
        type === "menuNode" ||
        type === "DECISION" ||
        type === "decisionNode" ||
        node.data?.isSubLabel
      ) {
        collapsedChildren.add(node.id);
        changed = true;
      }
    }
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
    try {
      const decoded = atob(data.replace(/\s/g, ""));
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i += 1) {
        bytes[i] = decoded.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType });
    } catch {
      // Fallback if base64 decoding fails
    }
  }
  try {
    return new Blob([decodeURIComponent(data)], { type: mimeType });
  } catch {
    return new Blob([data], { type: mimeType });
  }
}
