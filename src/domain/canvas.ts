import type { Edge, Node } from '@xyflow/react';
import type { FlowNode, FlowEdge, EdgeKind } from './graph';

export interface NodeData extends Record<string, unknown> {
  label: string;
  dialogueCount: number;
  dialogueLines?: string[];
  audioAssetCues?: FlowNode['audioAssetCues'];
  nodeType: 'LABEL' | 'MENU' | 'DECISION';
  chapter?: string;
  parentLabelId?: string;
  role?: FlowNode['role'];
  isShadowed?: boolean;
  shadowOfId?: string;
  isTerminalOutcome?: boolean;
  conditionExpression?: string;
  conditionReferences?: string[];
  theme: 'violet' | 'highContrast' | 'colorblind';
}

export interface EdgeData extends Record<string, unknown> {
  label: string;
  kind?: 'sequence' | 'jump' | 'call' | 'call_return';
  condition?: FlowEdge['condition'];
  timeout?: FlowEdge['timeout'];
  conditionState?: ConditionReachability;
}

export type LabelNodeType = Node<NodeData, 'labelNode'>;
export type MenuNodeType = Node<NodeData, 'menuNode'>;
export type DecisionNodeType = Node<NodeData, 'decisionNode'>;
export type CanvasNode = LabelNodeType | MenuNodeType | DecisionNodeType;

export type LabeledEdgeType = Edge<EdgeData, 'labeled'>;
export type CanvasEdge = LabeledEdgeType;

export type EdgeKindFilter = EdgeKind;
export type ConditionReachability = 'reachable' | 'unreachable' | 'unknown';
export type ConditionVisibilityMode = 'fade' | 'hide';

export type ThemeName = 'violet' | 'highContrast' | 'colorblind';
export type LayoutDirection = 'TB' | 'LR';

