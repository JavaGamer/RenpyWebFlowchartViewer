import type { FlowEdge, FlowNode } from "../../domain/index.ts";
import { exportMermaid } from "./mermaidExporter.ts";

export function exportStandaloneHtml(
  nodes: FlowNode[],
  edges: FlowEdge[],
): string {
  const mermaidStr = exportMermaid(nodes, edges);
  // Preserve Mermaid entities (&lt;, &gt;, &#124;, etc.) while allowing <br/> line breaks
  const safeMermaidStr = mermaidStr;
  const jsonStr = JSON.stringify({ nodes, edges })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RenpyWebFlowchartViewer - Standalone</title>
  <style>
    body { font-family: sans-serif; margin: 0; padding: 20px; background: #f9fafb; color: #111827; }
    h1 { text-align: center; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .mermaid { display: flex; justify-content: center; }
  </style>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, maxTextSize: 90000 });
  </script>
</head>
<body>
  <div class="container">
    <h1>Flowchart Viewer</h1>
    <div class="mermaid">
${safeMermaidStr}
    </div>
  </div>
  <!-- Embedded data for offline access if needed -->
  <script id="graph-data" type="application/json">
    ${jsonStr}
  </script>
</body>
</html>`;
}
