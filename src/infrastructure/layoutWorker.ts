import { expose } from 'comlink';
import { applyElkLayout, preWarmElk } from '../domain';
import type { FlowNode, FlowEdge, ThemeName, LayoutDensity } from '../domain';

const layoutApi = {
  async preWarm() {
    await preWarmElk();
  },
  async runLayout(
    rawNodes: FlowNode[],
    rawEdges: FlowEdge[],
    direction: 'TB' | 'LR',
    options?: {
      theme?: ThemeName;
      layoutDensity?: LayoutDensity;
      previousPositions?: Array<[string, { x: number; y: number }]>;
    }
  ) {
    return applyElkLayout(rawNodes, rawEdges, direction, {
      theme: options?.theme,
      layoutDensity: options?.layoutDensity,
    });
  }
};

expose(layoutApi);

export type LayoutWorkerApi = typeof layoutApi;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default null as any;

