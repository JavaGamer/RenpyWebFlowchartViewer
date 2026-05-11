import type { FlowEdge, FlowNode } from '../domain';
import type { ParseDiagnosticPayload } from '../infrastructure';
import type { DialogueSearchMode, ParseProgress } from './appStore';
import type { ParserVariant, ScreenActionRule } from '../config/parserRules';

export const DEBUG_BUNDLE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS: DebugBundlePrivacyOptions = {
  includeFileNames: false,
  includeRawScriptDetails: false,
  includeExtraDiagnostics: false,
};

export interface DebugBundlePrivacyOptions {
  includeFileNames: boolean;
  includeRawScriptDetails: boolean;
  includeExtraDiagnostics: boolean;
}

export interface BuildDebugBundleInput {
  appVersion: string;
  state: {
    phase: 'idle' | 'reading' | 'parsing' | 'done' | 'error';
    fileCount: number;
    importRevision: number;
    dialogueSearchMode: DialogueSearchMode;
    errorMsg: string;
    parseProgress: ParseProgress | null;
  };
  parser: {
    selectedVariant: ParserVariant;
    customScreenActionRules: ScreenActionRule[];
  };
  graph: {
    flowNodes: FlowNode[];
    flowEdges: FlowEdge[];
  };
  parseDiagnostics: ParseDiagnosticPayload[];
  privacy: DebugBundlePrivacyOptions;
}

interface RedactedWarning {
  code: ParseDiagnosticPayload['code'];
  severity: ParseDiagnosticPayload['severity'];
  construct?: string;
  category?:
    | 'invalid_node'
    | 'duplicate_node'
    | 'missing_edge_source'
    | 'missing_edge_target'
    | 'invalid_edge_kind'
    | 'duplicate_semantic_edge';
  edgeId?: string;
  sourceId?: string;
  targetId?: string;
  chapter?: string;
  targetExpression?: string;
  message?: string;
}

interface GraphAliasContext {
  nodeAliasById: Map<string, string>;
  edgeAliasById: Map<string, string>;
  unmappedNodeAliasById: Map<string, string>;
  unmappedEdgeAliasById: Map<string, string>;
  nextUnmappedNodeAliasNumber: number;
  nextUnmappedEdgeAliasNumber: number;
}

function createGraphAliasContext(
  nodes: FlowNode[],
  edges: FlowEdge[],
): GraphAliasContext {
  const nodeAliasById = new Map<string, string>();
  nodes.forEach((node, index) => {
    nodeAliasById.set(node.id, `n${index + 1}`);
  });
  const edgeAliasById = new Map<string, string>();
  edges.forEach((edge, index) => {
    edgeAliasById.set(edge.id, `e${index + 1}`);
  });
  return {
    nodeAliasById,
    edgeAliasById,
    unmappedNodeAliasById: new Map(),
    unmappedEdgeAliasById: new Map(),
    nextUnmappedNodeAliasNumber: nodeAliasById.size + 1,
    nextUnmappedEdgeAliasNumber: edgeAliasById.size + 1,
  };
}

function getNodeAlias(context: GraphAliasContext, nodeId: string): string {
  const mapped = context.nodeAliasById.get(nodeId);
  if (mapped) return mapped;
  const existingUnmapped = context.unmappedNodeAliasById.get(nodeId);
  if (existingUnmapped) return existingUnmapped;
  const alias = `n_unmapped_${context.nextUnmappedNodeAliasNumber}`;
  context.nextUnmappedNodeAliasNumber += 1;
  context.unmappedNodeAliasById.set(nodeId, alias);
  return alias;
}

function getEdgeAlias(context: GraphAliasContext, edgeId: string): string {
  const mapped = context.edgeAliasById.get(edgeId);
  if (mapped) return mapped;
  const existingUnmapped = context.unmappedEdgeAliasById.get(edgeId);
  if (existingUnmapped) return existingUnmapped;
  const alias = `e_unmapped_${context.nextUnmappedEdgeAliasNumber}`;
  context.nextUnmappedEdgeAliasNumber += 1;
  context.unmappedEdgeAliasById.set(edgeId, alias);
  return alias;
}

function redactWarning(
  warning: ParseDiagnosticPayload,
  privacy: DebugBundlePrivacyOptions,
  graphAliasContext: GraphAliasContext,
): RedactedWarning {
  const legacyWarning = warning as ParseDiagnosticPayload & {
    chapter?: string;
    construct?: string;
    targetExpression?: string;
    edgeId?: string;
    sourceId?: string;
    targetId?: string;
    category?: RedactedWarning['category'];
  };
  const location = warning.location ?? {
    chapter: legacyWarning.chapter,
    construct: legacyWarning.construct,
    targetExpression: legacyWarning.targetExpression,
    edgeId: legacyWarning.edgeId,
    sourceId: legacyWarning.sourceId,
    targetId: legacyWarning.targetId,
  };
  const context = warning.context ?? {
    category: legacyWarning.category,
  };
  return {
    code: warning.code,
    // Backward-compatible fallback for legacy bundles/tests that still provide warning-like payloads.
    severity: warning.severity ?? 'warning',
    ...(location.construct ? { construct: location.construct } : {}),
    ...(context.category ? { category: context.category } : {}),
    ...(location.edgeId
      ? { edgeId: privacy.includeRawScriptDetails ? location.edgeId : getEdgeAlias(graphAliasContext, location.edgeId) }
      : {}),
    ...(location.sourceId
      ? { sourceId: privacy.includeRawScriptDetails ? location.sourceId : getNodeAlias(graphAliasContext, location.sourceId) }
      : {}),
    ...(location.targetId
      ? { targetId: privacy.includeRawScriptDetails ? location.targetId : getNodeAlias(graphAliasContext, location.targetId) }
      : {}),
    ...(privacy.includeFileNames && location.chapter ? { chapter: location.chapter } : {}),
    ...(privacy.includeRawScriptDetails && location.targetExpression
      ? { targetExpression: location.targetExpression }
      : {}),
    ...(privacy.includeRawScriptDetails && warning.message ? { message: warning.message } : {}),
  };
}

function redactNode(
  node: FlowNode,
  privacy: DebugBundlePrivacyOptions,
  graphAliasContext: GraphAliasContext,
): Record<string, unknown> {
  const nodeId = privacy.includeRawScriptDetails
    ? node.id
    : getNodeAlias(graphAliasContext, node.id);
  return {
    id: nodeId,
    type: node.type,
    label: privacy.includeRawScriptDetails ? node.label : nodeId,
    role: node.role,
    dialogueCount: node.dialogueCount,
    parentLabelId: node.parentLabelId
      ? (privacy.includeRawScriptDetails
        ? node.parentLabelId
        : getNodeAlias(graphAliasContext, node.parentLabelId))
      : undefined,
    ...(privacy.includeFileNames && node.chapter ? { chapter: node.chapter } : {}),
    ...(privacy.includeRawScriptDetails && node.dialogueLines ? { dialogueLines: node.dialogueLines } : {}),
  };
}

function redactEdge(
  edge: FlowEdge,
  privacy: DebugBundlePrivacyOptions,
  graphAliasContext: GraphAliasContext,
): Record<string, unknown> {
  return {
    id: privacy.includeRawScriptDetails ? edge.id : getEdgeAlias(graphAliasContext, edge.id),
    source: privacy.includeRawScriptDetails ? edge.source : getNodeAlias(graphAliasContext, edge.source),
    target: privacy.includeRawScriptDetails ? edge.target : getNodeAlias(graphAliasContext, edge.target),
    kind: edge.kind,
    ...(privacy.includeRawScriptDetails && edge.label ? { label: edge.label } : {}),
  };
}

export function buildDebugBundle(input: BuildDebugBundleInput) {
  const warningCodes = Array.from(new Set(input.parseDiagnostics.map((warning) => warning.code))).sort();
  const graphAliasContext = createGraphAliasContext(input.graph.flowNodes, input.graph.flowEdges);
  const warnings = input.privacy.includeExtraDiagnostics
    ? input.parseDiagnostics.map((warning) => redactWarning(warning, input.privacy, graphAliasContext))
    : undefined;

  return {
    schemaVersion: DEBUG_BUNDLE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    app: {
      name: "Ren'Py Web Flowchart Viewer",
      version: input.appVersion,
      phase: input.state.phase,
      importRevision: input.state.importRevision,
      fileCount: input.state.fileCount,
      dialogueSearchMode: input.state.dialogueSearchMode,
      ...(input.state.errorMsg
        ? { errorSummary: 'Import failed. Enable "Include raw/script details (opt-in)" to include the full error message.' }
        : {}),
      ...(input.privacy.includeRawScriptDetails && input.state.errorMsg
        ? { errorMsg: input.state.errorMsg }
        : {}),
      parseProgress: input.state.parseProgress
        ? {
          doneFiles: input.state.parseProgress.doneFiles,
          totalFiles: input.state.parseProgress.totalFiles,
          ...(input.privacy.includeFileNames && input.state.parseProgress.currentFile
            ? { currentFile: input.state.parseProgress.currentFile }
            : {}),
        }
        : null,
    },
    parser: {
      selectedVariant: input.parser.selectedVariant,
      customScreenActionRules: input.parser.customScreenActionRules,
    },
    privacy: input.privacy,
    graphSummary: {
      nodeCount: input.graph.flowNodes.length,
      edgeCount: input.graph.flowEdges.length,
      warningCount: input.parseDiagnostics.length,
      warningCodes,
    },
    graph: {
      nodes: input.graph.flowNodes.map((node) => redactNode(node, input.privacy, graphAliasContext)),
      edges: input.graph.flowEdges.map((edge) => redactEdge(edge, input.privacy, graphAliasContext)),
    },
    ...(warnings ? { warnings } : {}),
  };
}

export function toDebugBundleBlob(bundle: unknown): Blob {
  return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
}

interface BuildIssueDraftUrlInput {
  owner: string;
  repo: string;
  privacy: DebugBundlePrivacyOptions;
  state: {
    phase: 'idle' | 'reading' | 'parsing' | 'done' | 'error';
    dialogueSearchMode: DialogueSearchMode;
    selectedVariant: ParserVariant;
    fileCount: number;
    warningCount: number;
  };
}

export function buildIssueDraftUrl(input: BuildIssueDraftUrlInput): string {
  const metadata = [
    `- App phase: ${input.state.phase}`,
    `- Parser variant: ${input.state.selectedVariant}`,
    `- Dialogue search mode: ${input.state.dialogueSearchMode}`,
    `- Imported .rpy file count: ${input.state.fileCount}`,
    `- Parser warning count: ${input.state.warningCount}`,
    `- Debug bundle file names included: ${input.privacy.includeFileNames ? 'yes' : 'no'}`,
    `- Debug bundle raw/script details included: ${input.privacy.includeRawScriptDetails ? 'yes' : 'no'}`,
    `- Debug bundle extra diagnostics included: ${input.privacy.includeExtraDiagnostics ? 'yes' : 'no'}`,
  ].join('\n');

  const body = [
    '## Summary',
    'Describe the problem and what you expected to happen.',
    '',
    '## Steps to Reproduce',
    '1. ',
    '2. ',
    '3. ',
    '',
    '## Debug Bundle',
    'Attach the exported debug bundle JSON file (optional, privacy-aware).',
    '',
    '## Metadata',
    metadata,
  ].join('\n');

  const params = new URLSearchParams({
    template: 'bug_report.md',
    title: '[Bug] ',
    body,
  });

  return `https://github.com/${input.owner}/${input.repo}/issues/new?${params.toString()}`;
}
