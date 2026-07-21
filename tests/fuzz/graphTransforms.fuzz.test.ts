import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildVisibleEdges,
  buildVisibleNodes,
  findPath,
  simplifyGraph,
} from "../../src/domain";
import { applyDagreLayout } from "../../src/infrastructure";
import { randomGraphArbitrary } from "./arbitraries";

const numRuns = process.env.DEEP_FUZZ ? 5000 : 100;

describe("Graph Transforms Fuzz Testing Suite", () => {
  it(
    `fuzzes buildVisibleNodes & buildVisibleEdges with arbitrary graph topologies (${numRuns} runs)`,
    () => {
      fc.assert(
        fc.property(
          randomGraphArbitrary,
          fc.fullUnicodeString({ maxLength: 20 }),
          fc.boolean(),
          (graph, search, showCallReturns) => {
            const visibleNodes = buildVisibleNodes({
              nodes: graph.nodes,
              search,
              minDialogue: 0,
              collapsedChapters: {},
              collapsedLabelChildren: new Set(),
              theme: "violet",
            });

            expect(Array.isArray(visibleNodes)).toBe(true);

            const visibleNodeIds = new Set(
              visibleNodes.filter((n) => !n.hidden).map((n) => n.id),
            );

            const visibleEdges = buildVisibleEdges({
              edges: graph.edges,
              showCallReturns,
              visibleEdgeKinds: {
                sequence: true,
                jump: true,
                call: true,
                call_return: true,
              },
              visibleNodeIds,
              edgeColor: "#4b5563",
              largeGraphMode: graph.nodes.length > 100,
            });

            expect(Array.isArray(visibleEdges)).toBe(true);
          },
        ),
        { numRuns },
      );
    },
  );

  it(
    `fuzzes simplifyGraph and findPath with random cyclic/disconnected graph inputs (${numRuns} runs)`,
    () => {
      fc.assert(
        fc.property(randomGraphArbitrary, (graph) => {
          const simplified = simplifyGraph(graph.nodes, graph.edges, {
            collapseSequences: true,
            removeUnreachable: false,
          });

          expect(simplified).toBeDefined();
          expect(Array.isArray(simplified.nodes)).toBe(true);
          expect(Array.isArray(simplified.edges)).toBe(true);

          if (graph.nodes.length >= 2) {
            const startId = graph.nodes[0]!.id;
            const targetId = graph.nodes[graph.nodes.length - 1]!.id;
            const pathResult = findPath(graph.nodes, graph.edges, startId, targetId);

            expect(pathResult).toBeDefined();
            expect(typeof pathResult.reachable).toBe("boolean");
          }
        }),
        { numRuns },
      );
    },
  );

  it(
    `fuzzes applyDagreLayout with arbitrary graph states (${numRuns} runs)`,
    () => {
      fc.assert(
        fc.property(randomGraphArbitrary, fc.constantFrom("TB", "LR"), (graph, rankDir) => {
          const layoutResult = applyDagreLayout(graph.nodes, graph.edges, rankDir);

          expect(layoutResult).toBeDefined();
          expect(Array.isArray(layoutResult.nodes)).toBe(true);
          expect(Array.isArray(layoutResult.edges)).toBe(true);
        }),
        { numRuns },
      );
    },
  );
});
