import type {
  FlowAsset,
  FlowEdge,
  FlowNode,
  ProjectTranslations,
} from "../domain/index.ts";
import type {
  InitVariableDescriptor,
  ParseDiagnostic,
  ParseGraphState,
  ParseInputFile,
  ParserVariant,
  PendingCallReturn,
  ScreenActionRule,
  ScreenDefinition,
  SerializableParserVariantPlugin,
  VariableMutation,
  VariableValue,
} from "./index.ts";

export interface PrePassState {
  globalLabelVariableLiteralTargets?: Array<[string, string]>;
  globalLabelVariableDictTargets?: Array<[string, Array<[string, string]>]>;
  globalLabelVariableListTargets?: Array<[string, string[]]>;
  initVariables?: Array<[string, InitVariableDescriptor]>;
  globalPersistentVariables?: Array<[string, VariableValue]>;
  globalScreens?: string[];
  globalCharacters?: string[];
  imageDefinitions?: Array<[string, string]>;
  screenDefinitions?: Array<[string, ScreenDefinition]>;
}

export interface InternalChunkResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: ParseDiagnostic[];
  pendingCallReturns: PendingCallReturn[];
  hasReturnInLabel?: string[];
  hasReliableReturnInLabel: string[];
  calledLabels?: string[];
  calledFromMenuOptionTargets?: string[];
  globalScreens: string[];
  globalCharacters?: string[];
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
  initVariables?: Array<[string, InitVariableDescriptor]>;
  globalPersistentVariables?: Array<[string, VariableValue]>;
  globalLabelVariableLiteralTargets?: Array<[string, string]>;
  globalLabelVariableDictTargets?: Array<[string, Array<[string, string]>]>;
  globalLabelVariableListTargets?: Array<[string, string[]]>;
  nodeMutations?: Array<[string, VariableMutation[]]>;
  imageDefinitions?: Array<[string, string]>;
  assets?: FlowAsset[];
  allConditionalExpressions?: ParseGraphState["allConditionalExpressions"];
}

export interface FinalizeDiagnosticItem {
  code: string;
  message: string;
  file?: string;
  line?: number;
  assetName?: string;
  label?: string;
}

export interface FinalizeChunkOptions {
  sessionId?: string;
  files?: ParseInputFile[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics?: FinalizeDiagnosticItem[];
  pendingCallReturns: PendingCallReturn[];
  hasReturnInLabel?: string[];
  hasReliableReturnInLabel: string[];
  calledLabels?: string[];
  calledFromMenuOptionTargets?: string[];
  globalScreens: string[];
  globalCharacters?: string[];
  labelDefinitionCount: Array<[string, number]>;
  canonicalLabelIds: Array<[string, string]>;
  initVariables?: Array<[string, InitVariableDescriptor]>;
  globalPersistentVariables?: Array<[string, VariableValue]>;
  globalLabelVariableLiteralTargets?: Array<[string, string]>;
  globalLabelVariableDictTargets?: Array<[string, Array<[string, string]>]>;
  globalLabelVariableListTargets?: Array<[string, string[]]>;
  nodeMutations?: Array<[string, VariableMutation[]]>;
  imageDefinitions?: Array<[string, string]>;
  assets?: FlowAsset[];
  projectMediaFiles?:
    | Array<{ relativePath: string; fileName: string }>
    | Set<string>
    | string[];
  maxCallStackDepth?: number;
  allConditionalExpressions?: ParseGraphState["allConditionalExpressions"];
  screenDefinitions?: Array<[string, ScreenDefinition]>;
  translations?: ProjectTranslations;
  availableLanguages?: string[];
  appendToActiveGraph?: boolean;
  resetActiveGraph?: boolean;
  isFinalChunk?: boolean;
  deferDetails?: boolean;
  captureDialogueLines?: boolean;
  parserVariant?: ParserVariant;
  customVariantPlugins?: SerializableParserVariantPlugin[];
  screenActionRules?: ScreenActionRule[];
  pruneDeadEndDecisions?: boolean;
}

export function applyPrePassState(
  state: ParseGraphState,
  prePass?: PrePassState,
): void {
  if (!prePass) return;

  if (prePass.globalLabelVariableLiteralTargets) {
    for (const [k, v] of prePass.globalLabelVariableLiteralTargets) {
      state.globalLabelVariableLiteralTargets.set(k, v);
    }
  }
  if (prePass.globalLabelVariableDictTargets) {
    for (const [k, entries] of prePass.globalLabelVariableDictTargets) {
      state.globalLabelVariableDictTargets.set(k, new Map(entries));
    }
  }
  if (prePass.globalLabelVariableListTargets) {
    for (const [k, list] of prePass.globalLabelVariableListTargets) {
      state.globalLabelVariableListTargets.set(k, [...list]);
    }
  }
  if (prePass.initVariables) {
    if (!state.initVariables) state.initVariables = new Map();
    for (const [vName, desc] of prePass.initVariables) {
      state.initVariables.set(vName, desc);
    }
  }
  if (prePass.globalPersistentVariables) {
    if (!state.globalPersistentVariables) {
      state.globalPersistentVariables = new Map();
    }
    for (const [k, v] of prePass.globalPersistentVariables) {
      state.globalPersistentVariables.set(k, v);
    }
  }
  if (prePass.globalScreens) {
    for (const s of prePass.globalScreens) {
      state.globalScreens.add(s);
    }
  }
  if (prePass.globalCharacters) {
    for (const c of prePass.globalCharacters) {
      state.globalCharacters.add(c);
    }
  }
  if (prePass.imageDefinitions) {
    if (!state.imageDefinitions) state.imageDefinitions = new Map();
    for (const [k, v] of prePass.imageDefinitions) {
      state.imageDefinitions.set(k, v);
    }
  }
  if (prePass.screenDefinitions) {
    if (!state.screenDefinitions) state.screenDefinitions = new Map();
    for (const [k, v] of prePass.screenDefinitions) {
      state.screenDefinitions.set(k, v);
    }
  }
}

export function mergeChunkIntoState(
  target: ParseGraphState,
  source: FinalizeChunkOptions,
): void {
  if (!target.labelsByChapter) {
    target.labelsByChapter = new Map();
  }
  for (const node of source.nodes) {
    target.nodes.push(node);
    target.nodeMap.set(node.id, node);
    if (node.type === "LABEL" && node.chapter) {
      let chapterMap = target.labelsByChapter.get(node.chapter);
      if (!chapterMap) {
        chapterMap = new Map();
        target.labelsByChapter.set(node.chapter, chapterMap);
      }
      const rawLabel = node.label || node.id.split("__shadow_")[0]!;
      if (!chapterMap.has(rawLabel)) {
        chapterMap.set(rawLabel, node.id);
      }
    }
  }
  for (const edge of source.edges) {
    target.edges.push(edge);
    target.edgeMap.set(edge.id, edge);
  }
  if (source.diagnostics) {
    target.diagnostics.push(...(source.diagnostics as ParseDiagnostic[]));
  }
  target.pendingCallReturns.push(...source.pendingCallReturns);
  if (source.hasReturnInLabel) {
    for (const label of source.hasReturnInLabel) {
      target.hasReturnInLabel.add(label);
    }
  }
  for (const label of source.hasReliableReturnInLabel) {
    target.hasReliableReturnInLabel.add(label);
  }
  if (source.calledLabels) {
    for (const label of source.calledLabels) {
      target.calledLabels.add(label);
    }
  }
  if (source.calledFromMenuOptionTargets) {
    for (const label of source.calledFromMenuOptionTargets) {
      target.calledFromMenuOptionTargets.add(label);
    }
  }
  for (const screen of source.globalScreens) {
    target.globalScreens.add(screen);
  }
  if (source.globalCharacters) {
    for (const c of source.globalCharacters) {
      target.globalCharacters.add(c);
    }
  }
  for (const [name, count] of source.labelDefinitionCount) {
    target.labelDefinitionCountByName.set(
      name,
      (target.labelDefinitionCountByName.get(name) ?? 0) + count,
    );
  }
  for (const [name, id] of source.canonicalLabelIds) {
    target.canonicalLabelIdByName.set(name, id);
  }
  if (source.nodeMutations) {
    if (!target.nodeMutations) target.nodeMutations = new Map();
    for (const [nId, muts] of source.nodeMutations) {
      const existing = target.nodeMutations.get(nId) ?? [];
      target.nodeMutations.set(nId, [...existing, ...muts]);
    }
  }
  if (source.initVariables) {
    if (!target.initVariables) target.initVariables = new Map();
    for (const [vName, desc] of source.initVariables) {
      const existing = target.initVariables.get(vName);
      let shouldOverwrite: boolean;
      if (!existing) {
        shouldOverwrite = true;
      } else if (existing.kind === "define" && desc.kind !== "define") {
        shouldOverwrite = desc.priority > existing.priority;
      } else if (desc.kind === "define" && existing.kind !== "define") {
        shouldOverwrite = desc.priority >= existing.priority;
      } else if (desc.kind === "default" && existing.kind === "default") {
        shouldOverwrite = desc.priority > existing.priority;
      } else {
        shouldOverwrite = desc.priority >= existing.priority;
      }
      if (shouldOverwrite) {
        target.initVariables.set(vName, desc);
      }
    }
  }
  if (source.globalPersistentVariables) {
    if (!target.globalPersistentVariables) {
      target.globalPersistentVariables = new Map();
    }
    for (const [k, v] of source.globalPersistentVariables) {
      target.globalPersistentVariables.set(k, v);
    }
  }
  if (source.globalLabelVariableLiteralTargets) {
    for (const [k, v] of source.globalLabelVariableLiteralTargets) {
      target.globalLabelVariableLiteralTargets.set(k, v);
    }
  }
  if (source.globalLabelVariableDictTargets) {
    for (const [k, entries] of source.globalLabelVariableDictTargets) {
      let existingDict = target.globalLabelVariableDictTargets.get(k);
      if (!existingDict) {
        existingDict = new Map();
        target.globalLabelVariableDictTargets.set(k, existingDict);
      }
      for (const [entryK, entryV] of entries) {
        existingDict.set(entryK, entryV);
      }
    }
  }
  if (source.globalLabelVariableListTargets) {
    for (const [k, list] of source.globalLabelVariableListTargets) {
      const existingList = target.globalLabelVariableListTargets.get(k) ?? [];
      target.globalLabelVariableListTargets.set(
        k,
        Array.from(new Set([...existingList, ...list])),
      );
    }
  }
  if (source.assets) {
    if (!target.assets) target.assets = [];
    target.assets.push(...source.assets);
  }
  if (source.imageDefinitions) {
    if (!target.imageDefinitions) target.imageDefinitions = new Map();
    for (const [k, v] of source.imageDefinitions) {
      target.imageDefinitions.set(k, v);
    }
  }
  if (source.projectMediaFiles) {
    target.projectMediaFiles = source.projectMediaFiles;
  }
  if (source.allConditionalExpressions) {
    if (!target.allConditionalExpressions) {
      target.allConditionalExpressions = [];
    }
    target.allConditionalExpressions.push(...source.allConditionalExpressions);
  }
  if (source.maxCallStackDepth !== undefined) {
    target.maxCallStackDepth = source.maxCallStackDepth;
  }
  if (source.screenDefinitions) {
    if (!target.screenDefinitions) target.screenDefinitions = new Map();
    for (const [k, v] of source.screenDefinitions) {
      target.screenDefinitions.set(k, v);
    }
  }
  if (source.translations) {
    target.translations = source.translations;
  }
  if (source.availableLanguages) {
    target.availableLanguages = source.availableLanguages;
  }
}
