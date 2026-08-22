import { describe, expect, it } from "vitest";
import {
  applyDagreLayout,
  applyElkLayout,
  setElkInstance,
} from "../../src/infrastructure/index.ts";
import type { FlowEdge, FlowNode } from "../../src/domain/index.ts";

describe("compound layout tests (Dagre & ELK)", () => {
  const multiChapterNodes: FlowNode[] = [
    {
      id: "ch1_node1",
      type: "LABEL",
      label: "Chapter 1 Intro",
      dialogueCount: 4,
      wordCount: 40,
      chapter: "ch1.rpy",
    },
    {
      id: "ch1_node2",
      type: "MENU",
      label: "Chapter 1 Choice",
      dialogueCount: 0,
      chapter: "ch1.rpy",
    },
    {
      id: "ch2_node1",
      type: "LABEL",
      label: "Chapter 2 Intro",
      dialogueCount: 10,
      wordCount: 100,
      chapter: "ch2.rpy",
    },
  ];

  const multiChapterEdges: FlowEdge[] = [
    {
      id: "e1",
      source: "ch1_node1",
      target: "ch1_node2",
      kind: "sequence",
    },
    {
      id: "e2",
      source: "ch1_node2",
      target: "ch2_node1",
      kind: "jump",
    },
  ];

  describe("Dagre Compound Layout", () => {
    it("creates compound chapter containers when multiple chapters exist", () => {
      const result = applyDagreLayout(
        multiChapterNodes,
        multiChapterEdges,
        "TB",
        { enableCompoundContainers: true },
      );

      const chapterNodes = result.nodes.filter((n) => n.type === "chapterNode");
      expect(chapterNodes).toHaveLength(2);

      const ch1Container = result.nodes.find((n) => n.id === "chapter:ch1.rpy");
      expect(ch1Container).toBeDefined();
      expect(ch1Container?.data.isChapterContainer).toBe(true);
      expect(ch1Container?.data.isCollapsed).toBe(false);

      // Child nodes must have parentId set
      const ch1Child1 = result.nodes.find((n) => n.id === "ch1_node1");
      const ch1Child2 = result.nodes.find((n) => n.id === "ch1_node2");
      expect(ch1Child1?.parentId).toBe("chapter:ch1.rpy");
      expect(ch1Child2?.parentId).toBe("chapter:ch1.rpy");

      // Verify that parent nodes precede child nodes in the nodes array
      const ch1ContainerIndex = result.nodes.findIndex((n) =>
        n.id === "chapter:ch1.rpy"
      );
      const ch1Child1Index = result.nodes.findIndex((n) =>
        n.id === "ch1_node1"
      );
      expect(ch1ContainerIndex).toBeLessThan(ch1Child1Index);
    });

    it("collapses chapter container into a single summary node and reconnects cross-chapter edges", () => {
      const result = applyDagreLayout(
        multiChapterNodes,
        multiChapterEdges,
        "TB",
        {
          enableCompoundContainers: true,
          collapsedChapters: { "ch1.rpy": true },
        },
      );

      // Collapsed chapter summary node
      const ch1Summary = result.nodes.find((n) => n.id === "chapter:ch1.rpy");
      expect(ch1Summary).toBeDefined();
      expect(ch1Summary?.data.isCollapsed).toBe(true);

      // Children of collapsed chapter should not be in the output nodes
      const ch1Child = result.nodes.find((n) => n.id === "ch1_node1");
      expect(ch1Child).toBeUndefined();

      // Non-collapsed chapter child should still exist
      const ch2Child = result.nodes.find((n) => n.id === "ch2_node1");
      expect(ch2Child).toBeDefined();

      // Cross-chapter edge should reconnect from summary node to ch2_node1
      const crossEdge = result.edges.find((e) => e.target === "ch2_node1");
      expect(crossEdge).toBeDefined();
      expect(crossEdge?.source).toBe("chapter:ch1.rpy");
    });
  });

  describe("ELK Compound Layout", () => {
    it("handles compound hierarchy in mock ELK instance", async () => {
      interface MockElkChild {
        id: string;
        children?: MockElkChild[];
        width?: number;
        height?: number;
        x?: number;
        y?: number;
        layoutOptions?: Record<string, string>;
      }

      interface MockElkGraph {
        id: string;
        layoutOptions: Record<string, string>;
        children: MockElkChild[];
        edges: unknown[];
      }

      const mockElk = {
        layout(graph: MockElkGraph): Promise<MockElkGraph> {
          // Verify hierarchy options and children structure
          expect(graph.layoutOptions["elk.hierarchyHandling"]).toBe(
            "INCLUDE_CHILDREN",
          );
          expect(graph.children).toBeDefined();
          return Promise.resolve({
            ...graph,
            children: graph.children.map((c: MockElkChild) => ({
              ...c,
              x: 0,
              y: 0,
              width: 300,
              height: 200,
              children: c.children?.map((child: MockElkChild) => ({
                ...child,
                x: 20,
                y: 50,
              })),
            })),
          });
        },
      };

      setElkInstance(mockElk);

      const result = await applyElkLayout(
        multiChapterNodes,
        multiChapterEdges,
        "TB",
        { enableCompoundContainers: true },
      );

      const ch1Container = result.nodes.find((n) => n.id === "chapter:ch1.rpy");
      expect(ch1Container).toBeDefined();
      expect(ch1Container?.type).toBe("chapterNode");

      const child1 = result.nodes.find((n) => n.id === "ch1_node1");
      expect(child1?.parentId).toBe("chapter:ch1.rpy");
      expect(child1?.position).toEqual({ x: 20, y: 50 });

      setElkInstance(null);
    });
  });
});
