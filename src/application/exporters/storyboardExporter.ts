import type { FlowNode } from "../../domain/index.ts";

export function exportToStoryboard(nodes: FlowNode[]): string {
  const lines: string[] = ["# Narrative Storyboard\n"];

  const byChapter = new Map<string, FlowNode[]>();
  for (const node of nodes) {
    const chapter = node.chapter || "Uncategorized";
    if (!byChapter.has(chapter)) byChapter.set(chapter, []);
    byChapter.get(chapter)!.push(node);
  }

  const sortedChapters = Array.from(byChapter.keys()).sort();
  for (const chapter of sortedChapters) {
    lines.push(`## ${chapter}\n`);
    const chapterNodes = byChapter.get(chapter)!;

    for (const node of chapterNodes) {
      lines.push(`### ${node.label}`);
      lines.push(
        `*Type: ${node.type} | Dialogue Lines: ${node.dialogueCount} | Words: ${
          node.wordCount || 0
        }*`,
      );
      if (node.dialogueLines && node.dialogueLines.length > 0) {
        lines.push("");
        for (const dl of node.dialogueLines) {
          lines.push(`> ${dl}`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

import { extractNodeDetailsInWorker } from "../../infrastructure/index.ts";
import { useAppStore } from "../appStore.ts";
import { useViewerStore } from "../viewerStore.ts";

export async function exportToStoryboardWithHydration(
  nodes: FlowNode[],
): Promise<string> {
  const unhydratedIds = nodes
    .filter((n) =>
      n.dialogueCount > 0 && !n.isDetailsLoaded && !n.dialogueLines
    )
    .map((n) => n.id);
  if (unhydratedIds.length > 0) {
    const details = await extractNodeDetailsInWorker(unhydratedIds);
    useAppStore.getState().updateNodeDetails(details);
    const viewerState = useViewerStore.getState();
    if (viewerState.hydratedNodeDetailIds) {
      for (const id of Object.keys(details)) {
        viewerState.hydratedNodeDetailIds.add(id);
      }
    }
    const updatedMap = new Map(
      useAppStore.getState().flowNodes.map((n) => [n.id, n]),
    );
    const updatedNodes = nodes.map((n) => updatedMap.get(n.id) ?? n);
    return exportToStoryboard(updatedNodes);
  }
  return exportToStoryboard(nodes);
}
