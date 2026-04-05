import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { LabelNodeComponent, MenuNodeComponent } from './viewerNodes';
import { LabeledEdge } from './viewerEdges';

export const nodeTypes: NodeTypes = {
  labelNode: LabelNodeComponent,
  menuNode: MenuNodeComponent,
};

export const edgeTypes: EdgeTypes = {
  labeled: LabeledEdge,
};
