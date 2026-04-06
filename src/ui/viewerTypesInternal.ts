import type { FlowEdge, FlowNode } from '../domain';

export interface FlowchartViewerProps {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
}
