import { expose } from "comlink";
import { applyElkLayout, preWarmElk } from "./layoutEngines.ts";
import {
  type FlowEdge,
  type FlowNode,
  type GraphSimplificationOptions,
  type LayoutDensity,
  simplifyGraph,
  type ThemeName,
} from "../domain/index.ts";

const layoutApi = {
  async preWarm() {
    await preWarmElk();
  },
  async runLayout(
    rawNodes: FlowNode[],
    rawEdges: FlowEdge[],
    direction: "TB" | "LR",
    options?: {
      theme?: ThemeName;
      layoutDensity?: LayoutDensity;
      previousPositions?: Array<[string, { x: number; y: number }]>;
      simplifyOptions?: GraphSimplificationOptions;
    },
  ) {
    let nodes = rawNodes;
    let edges = rawEdges;
    if (options?.simplifyOptions) {
      const simplified = simplifyGraph(
        rawNodes,
        rawEdges,
        options.simplifyOptions,
      );
      nodes = simplified.nodes;
      edges = simplified.edges;
    }
    return await applyElkLayout(nodes, edges, direction, {
      theme: options?.theme,
      layoutDensity: options?.layoutDensity,
      previousPositions: options?.previousPositions,
    });
  },
};

expose(layoutApi);

export type LayoutWorkerApi = typeof layoutApi;
export default null as unknown;
