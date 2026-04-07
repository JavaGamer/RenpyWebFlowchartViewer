import type { IFuseOptions } from 'fuse.js';

export interface DialogueSearchDocument {
  nodeId: string;
  nodeLabel: string;
  lineIndex: number;
  lineText: string;
}

export interface NodeSearchDocument {
  nodeId: string;
  label: string;
  dialogueCountText: string;
}

export const DIALOGUE_FUSE_OPTIONS: IFuseOptions<DialogueSearchDocument> = {
  keys: ['lineText', 'nodeLabel'],
  threshold: 0.35,
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 2,
};

export const NODE_FUSE_OPTIONS: IFuseOptions<NodeSearchDocument> = {
  keys: ['label', 'dialogueCountText'],
  threshold: 0.3,
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 1,
};
