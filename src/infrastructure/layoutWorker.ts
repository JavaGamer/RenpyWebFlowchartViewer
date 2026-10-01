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

let cachedRawNodes: FlowNode[] = [];
let cachedRawEdges: FlowEdge[] = [];
let cachedGraphRevision: number | undefined;
let cachedSimplifyKey: string | null = null;
let cachedSimplified: { nodes: FlowNode[]; edges: FlowEdge[] } | null = null;

const layoutApi = {
  async preWarm() {
    await preWarmElk();
  },
  async runLayout(
    rawNodes: FlowNode[] | null,
    rawEdges: FlowEdge[] | null,
    direction: "TB" | "LR",
    options?: {
      theme?: ThemeName;
      layoutDensity?: LayoutDensity;
      previousPositions?: Array<[string, { x: number; y: number }]>;
      simplifyOptions?: GraphSimplificationOptions;
      enableCompoundContainers?: boolean;
      collapsedChapters?: Record<string, boolean>;
      collapsedParentLabels?: Record<string, boolean>;
      graphRevision?: number;
    },
  ) {
    if (rawNodes !== null || rawEdges !== null) {
      if (rawNodes !== null) cachedRawNodes = rawNodes;
      if (rawEdges !== null) cachedRawEdges = rawEdges;
      cachedGraphRevision = options?.graphRevision;
      cachedSimplifyKey = null;
      cachedSimplified = null;
    }

    let nodes = rawNodes ?? cachedRawNodes;
    let edges = rawEdges ?? cachedRawEdges;

    if (options?.simplifyOptions) {
      const rev = options.graphRevision ?? cachedGraphRevision ?? "unversioned";
      const simplifyKey = `${rev}:${JSON.stringify(options.simplifyOptions)}`;
      if (cachedSimplifyKey === simplifyKey && cachedSimplified) {
        nodes = cachedSimplified.nodes;
        edges = cachedSimplified.edges;
      } else {
        cachedSimplified = simplifyGraph(
          nodes,
          edges,
          options.simplifyOptions,
        );
        cachedSimplifyKey = simplifyKey;
        nodes = cachedSimplified.nodes;
        edges = cachedSimplified.edges;
      }
    }

    return await applyElkLayout(nodes, edges, direction, {
      theme: options?.theme,
      layoutDensity: options?.layoutDensity,
      previousPositions: options?.previousPositions,
      enableCompoundContainers: options?.enableCompoundContainers,
      collapsedChapters: options?.collapsedChapters,
      collapsedParentLabels: options?.collapsedParentLabels,
    });
  },
};

expose(layoutApi);

export type LayoutWorkerApi = typeof layoutApi;
export default null as unknown;
