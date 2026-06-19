import { expose } from "comlink";
import { applyElkLayout, preWarmElk } from "../domain/index.ts";
import type { FlowEdge, FlowNode, LayoutDensity, ThemeName } from "../domain/index.ts";

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
    },
  ) {
    return applyElkLayout(rawNodes, rawEdges, direction, {
      theme: options?.theme,
      layoutDensity: options?.layoutDensity,
    });
  },
};

expose(layoutApi);

export type LayoutWorkerApi = typeof layoutApi;
export default null as unknown;
