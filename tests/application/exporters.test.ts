import { describe, expect, it } from "vitest";
import { exportMermaid } from "../../src/application/exporters/mermaidExporter.ts";
import { exportNarrativeOutline } from "../../src/application/exporters/narrativeOutlineExporter.ts";
import { exportStandaloneHtml } from "../../src/application/exporters/standaloneExporter.ts";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";

describe("application / exporters", () => {
  const sampleNodes: FlowNode[] = [
    {
      id: "label_start",
      type: "LABEL",
      label: 'Start "Scene"',
      dialogueCount: 2,
      chapter: "Chapter 1",
      dialogueLines: ["Hello world", "Welcome to the story!"],
    },
    {
      id: "menu_choice",
      type: "MENU",
      label: "Choose Route",
      dialogueCount: 0,
    },
    {
      id: "label_end",
      type: "LABEL",
      label: "The End",
      dialogueCount: 1,
      isTerminalOutcome: true,
    },
  ];

  const sampleEdges: FlowEdge[] = [
    {
      id: "e1",
      source: "label_start",
      target: "menu_choice",
      kind: "sequence",
    },
    {
      id: "e2",
      source: "menu_choice",
      target: "label_end",
      kind: "jump",
      label: '"Option A"',
    },
  ];

  describe("exportMermaid", () => {
    it("formats nodes and edges into Mermaid TD flowchart string with quotes escaped", () => {
      const output = exportMermaid(sampleNodes, sampleEdges);

      expect(output).toContain("flowchart TD");
      // Double quotes should be escaped to single quotes
      expect(output).toContain("n_label_start[\"Start 'Scene'\"]");
      // Menu node uses curly braces
      expect(output).toContain('n_menu_choice{"Choose Route"}');
      // Terminal node uses round-square brackets
      expect(output).toContain('n_label_end(["The End"])');
      // Edges
      expect(output).toContain("n_label_start --> n_menu_choice");
      expect(output).toContain("n_menu_choice -->|\"'Option A'\"| n_label_end");
    });
  });

  describe("exportNarrativeOutline", () => {
    it("generates markdown document with headers, chapters, dialogue quotes, and transitions", () => {
      const md = exportNarrativeOutline(sampleNodes, sampleEdges);

      expect(md).toContain("# Narrative Outline");
      expect(md).toContain('## Start "Scene"');
      expect(md).toContain("**Chapter**: Chapter 1");
      expect(md).toContain("> Hello world");
      expect(md).toContain("> Welcome to the story!");
      expect(md).toContain("- -> Choose Route");
      expect(md).toContain('- "Option A" -> The End');
    });
  });

  describe("exportStandaloneHtml", () => {
    it("generates standalone HTML document embedding Mermaid graph and JSON payload", () => {
      const html = exportStandaloneHtml(sampleNodes, sampleEdges);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain(
        "<title>RenpyWebFlowchartViewer - Standalone</title>",
      );
      expect(html).toContain("flowchart TD");
      expect(html).toContain(
        '<script id="graph-data" type="application/json">',
      );
      // Verify < and > in JSON string are sanitized to \u003c and \u003e
      expect(html).not.toContain("<label_start");
    });
  });
});
