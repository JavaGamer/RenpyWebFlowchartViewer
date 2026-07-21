import type { EdgeTypes, NodeTypes } from "@xyflow/react";
import {
  ClusterNodeComponent,
  DecisionNodeComponent,
  LabelNodeComponent,
  MenuNodeComponent,
} from "./viewerNodes.tsx";
import { LabeledEdge } from "./viewerEdges.tsx";

export const nodeTypes: NodeTypes = {
  labelNode: LabelNodeComponent,
  menuNode: MenuNodeComponent,
  decisionNode: DecisionNodeComponent,
  clusterNode: ClusterNodeComponent,
};

export const edgeTypes: EdgeTypes = {
  labeled: LabeledEdge,
};
