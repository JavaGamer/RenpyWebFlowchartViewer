import type { Options } from "minisearch";

export interface DialogueSearchDocument {
  id: string; // Unique ID: `${nodeId}::${lineIndex}`
  nodeId: string;
  nodeLabel: string;
  lineIndex: number;
  lineText: string;
}

export interface NodeSearchDocument {
  id: string; // Unique ID: nodeId
  nodeId: string;
  label: string;
  dialogueCountText: string;
}

export const DIALOGUE_MINISEARCH_OPTIONS: Options<DialogueSearchDocument> = {
  fields: ["lineText", "nodeLabel"],
  storeFields: ["nodeId", "nodeLabel", "lineIndex", "lineText"],
  searchOptions: {
    boost: { lineText: 2, nodeLabel: 1 },
    prefix: true,
    fuzzy: 0.25,
  },
};

export const NODE_MINISEARCH_OPTIONS: Options<NodeSearchDocument> = {
  fields: ["label", "dialogueCountText"],
  storeFields: ["nodeId"],
  searchOptions: {
    boost: { label: 2, dialogueCountText: 1 },
    prefix: true,
    fuzzy: 0.25,
  },
};
