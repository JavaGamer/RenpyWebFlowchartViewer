import { expose } from 'comlink';
import { applyElkLayout } from '../domain';
import type { FlowNode, FlowEdge, ThemeName, LayoutDensity } from '../domain';

const layoutApi = {
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
export default null as any;
