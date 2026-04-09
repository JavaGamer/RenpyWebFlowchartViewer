import type { FlowEdge, FlowNode } from '../domain';
import type { ParseWarningPayload } from '../infrastructure';
import type { DialogueSearchMode, ParseProgress } from './appState';
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
  parseWarnings: ParseWarningPayload[];
  privacy: DebugBundlePrivacyOptions;
}

interface RedactedWarning {
  code: ParseWarningPayload['code'];
  construct: string;
  chapter?: string;
  targetExpression?: string;
  message?: string;
  sourceId?: string;
}

function redactWarning(
  warning: ParseWarningPayload,
  privacy: DebugBundlePrivacyOptions,
): RedactedWarning {
  return {
    code: warning.code,
    construct: warning.construct,
    ...(privacy.includeFileNames && warning.chapter ? { chapter: warning.chapter } : {}),
    ...(privacy.includeRawScriptDetails && warning.targetExpression
      ? { targetExpression: warning.targetExpression }
      : {}),
    ...(privacy.includeRawScriptDetails && warning.message ? { message: warning.message } : {}),
    ...(privacy.includeRawScriptDetails && warning.sourceId ? { sourceId: warning.sourceId } : {}),
  };
}

function redactNode(node: FlowNode, privacy: DebugBundlePrivacyOptions): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    role: node.role,
    dialogueCount: node.dialogueCount,
    parentLabelId: node.parentLabelId,
    ...(privacy.includeFileNames && node.chapter ? { chapter: node.chapter } : {}),
    ...(privacy.includeRawScriptDetails && node.dialogueLines ? { dialogueLines: node.dialogueLines } : {}),
  };
}

function redactEdge(edge: FlowEdge, privacy: DebugBundlePrivacyOptions): Record<string, unknown> {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    ...(privacy.includeRawScriptDetails && edge.label ? { label: edge.label } : {}),
  };
}

export function buildDebugBundle(input: BuildDebugBundleInput) {
  const warningCodes = Array.from(new Set(input.parseWarnings.map((warning) => warning.code))).sort();
  const warnings = input.privacy.includeExtraDiagnostics
    ? input.parseWarnings.map((warning) => redactWarning(warning, input.privacy))
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
      errorMsg: input.state.errorMsg || undefined,
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
      warningCount: input.parseWarnings.length,
      warningCodes,
    },
    graph: {
      nodes: input.graph.flowNodes.map((node) => redactNode(node, input.privacy)),
      edges: input.graph.flowEdges.map((edge) => redactEdge(edge, input.privacy)),
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
