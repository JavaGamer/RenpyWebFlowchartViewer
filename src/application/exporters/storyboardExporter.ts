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
    const updatedNodes = useAppStore.getState().flowNodes;
    return exportToStoryboard(updatedNodes);
  }
  return exportToStoryboard(nodes);
}
