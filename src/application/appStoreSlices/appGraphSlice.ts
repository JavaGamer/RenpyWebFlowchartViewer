import type { StateCreator } from "zustand";
import type {
  AudioAssetCue,
  FlowEdge,
  FlowNode,
  ProjectTranslations,
} from "../../domain/index.ts";
import type { ParseDiagnosticPayload } from "../../infrastructure/index.ts";
import type { VariantDetectionResult } from "../../config/parserRules.ts";
import type { AppStore } from "../appStore.ts";

export interface AppGraphState {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  parseDiagnostics: ParseDiagnosticPayload[];
  importRevision: number;
  translations: ProjectTranslations | null;
  availableLanguages: string[];
  parsedVariant: string | null;
  isVariantAutoDetected: boolean;
  variantDetectionResult: VariantDetectionResult | null;
}

export interface AppGraphActions {
  updateNodeDetails: (
    details: Record<
      string,
      {
        dialogueLines?: string[];
        dialogueLineNums?: number[];
        audioAssetCues?: AudioAssetCue[];
      }
    >,
  ) => void;
  partialParseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
  ) => void;
  parseSuccess: (
    nodes: FlowNode[],
    edges: FlowEdge[],
    diagnostics?: ParseDiagnosticPayload[],
    translations?: ProjectTranslations | null,
    meta?: {
      parsedVariant?: string;
      isVariantAutoDetected?: boolean;
      variantDetectionResult?: VariantDetectionResult;
      preserveSession?: boolean;
    },
  ) => void;
  setTranslations: (translations: ProjectTranslations | null) => void;
}

export type AppGraphSlice = AppGraphState & AppGraphActions;

export const defaultAppGraphState: AppGraphState = {
  flowNodes: [],
  flowEdges: [],
  parseDiagnostics: [],
  importRevision: 0,
  translations: null,
  availableLanguages: [],
  parsedVariant: null,
  isVariantAutoDetected: false,
  variantDetectionResult: null,
};

export const createAppGraphSlice: StateCreator<
  AppStore,
  [["zustand/immer", never]],
  [],
  AppGraphSlice
> = (set) => ({
  ...defaultAppGraphState,

  updateNodeDetails: (details) =>
    set((draft) => {
      for (const node of draft.flowNodes) {
        const payload = details[node.id];
        if (payload) {
          if (payload.dialogueLines) node.dialogueLines = payload.dialogueLines;
          if (payload.dialogueLineNums) {
            node.dialogueLineNums = payload.dialogueLineNums;
          }
          if (payload.audioAssetCues) {
            node.audioAssetCues = payload.audioAssetCues;
          }
          node.isDetailsLoaded = true;
        }
      }
    }),

  partialParseSuccess: (nodes, edges, diagnostics) =>
    set((draft) => {
      draft.phase = "parsing";
      draft.flowNodes = nodes;
      draft.flowEdges = edges;
      if (diagnostics !== undefined) {
        draft.parseDiagnostics = diagnostics;
      }
    }),

  parseSuccess: (nodes, edges, diagnostics, translations, meta) =>
    set((draft) => {
      draft.phase = "done";
      draft.isReparsing = false;
      draft.flowNodes = nodes;
      draft.flowEdges = edges;
      draft.parseDiagnostics = diagnostics ?? [];
      draft.translations = translations ?? null;
      draft.availableLanguages = translations?.availableLanguages ?? [];
      draft.parseProgress = null;
      if (!meta?.preserveSession) {
        draft.importRevision += 1;
      }
      draft.parsedVariant = meta?.parsedVariant ?? null;
      draft.isVariantAutoDetected = meta?.isVariantAutoDetected ?? false;
      draft.variantDetectionResult = meta?.variantDetectionResult ?? null;
    }),

  setTranslations: (translations) =>
    set((draft) => {
      draft.translations = translations;
      draft.availableLanguages = translations?.availableLanguages ?? [];
    }),
});
