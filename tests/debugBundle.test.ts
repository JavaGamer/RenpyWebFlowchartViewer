import { describe, expect, it } from 'vitest';
import {
  buildDebugBundle,
  buildIssueDraftUrl,
  toDebugBundleBlob,
  DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
} from '../src/application';

const REDACTED_ERROR_SUMMARY =
  'Import failed. Enable "Include raw/script details (opt-in)" to include the full error message.';

describe('debug bundle privacy defaults', () => {
  it('redacts file names, raw script details, and identifiers by default', () => {
    const bundle = buildDebugBundle({
      appVersion: 'test',
      state: {
        phase: 'error',
        fileCount: 1,
        importRevision: 0,
        dialogueSearchMode: 'auto',
        errorMsg: 'failed at secret-file.rpy line 12',
        parseProgress: {
          doneFiles: 1,
          totalFiles: 1,
          currentFile: 'secret-file.rpy',
        },
      },
      parser: {
        selectedVariant: 'renpy',
        customScreenActionRules: [],
      },
      graph: {
        flowNodes: [{
          id: 'start',
          type: 'LABEL',
          label: 'start',
          chapter: 'secret-file',
          dialogueCount: 1,
          dialogueLines: ['sensitive line'],
        }],
        flowEdges: [{
          id: 'e1',
          source: 'start',
          target: 'end',
          kind: 'jump',
          label: 'sensitive edge',
        }],
      },
      parseDiagnostics: [{
        code: 'dynamic_target',
        severity: 'warning',
        location: {
          chapter: 'secret-file',
          construct: 'renpy.call',
          targetExpression: 'secret_target',
        },
        message: 'Dynamic renpy.call target cannot be resolved statically: secret_target',
      }],
      privacy: DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
    });

    const appMetadata = bundle.app as { errorMsg?: string; errorSummary?: string; parseProgress: { currentFile?: string } | null };
    expect(appMetadata.errorMsg).toBeUndefined();
    expect(appMetadata.errorSummary).toBe(REDACTED_ERROR_SUMMARY);
    const progress = appMetadata.parseProgress;
    expect(progress).not.toBeNull();
    expect(progress?.currentFile).toBeUndefined();
    const firstNode = bundle.graph.nodes[0] as {
      id: string;
      label: string;
      chapter?: string;
      dialogueLines?: string[];
    };
    expect(firstNode.chapter).toBeUndefined();
    expect(firstNode.dialogueLines).toBeUndefined();
    expect(firstNode.id).toBe('n1');
    expect(firstNode.label).toBe('n1');
    const firstEdge = bundle.graph.edges[0] as { id: string; source: string; target: string; label?: string };
    expect(firstEdge.label).toBeUndefined();
    expect(firstEdge.id).toBe('e1');
    expect(firstEdge.source).toBe('n1');
    expect(firstEdge.target).toBe('n_unmapped_2');
    expect(bundle.warnings).toBeUndefined();
  });

  it('includes sensitive fields only when opted in', () => {
    const bundle = buildDebugBundle({
      appVersion: 'test',
      state: {
        phase: 'done',
        fileCount: 1,
        importRevision: 1,
        dialogueSearchMode: 'full',
        errorMsg: 'specific parse failure',
        parseProgress: null,
      },
      parser: {
        selectedVariant: 'st',
        customScreenActionRules: [{ actionName: 'Warp', actionKind: 'jump' }],
      },
      graph: {
        flowNodes: [{
          id: 'start',
          type: 'LABEL',
          label: 'start',
          chapter: 'chapter1',
          dialogueCount: 1,
          dialogueLines: ['line 1'],
        }],
        flowEdges: [{
          id: 'e1',
          source: 'start',
          target: 'end',
          kind: 'jump',
          label: 'to end',
        }],
      },
      parseDiagnostics: [{
        code: 'dynamic_target',
        severity: 'warning',
        location: {
          chapter: 'chapter1',
          construct: 'renpy.jump',
          targetExpression: 'target_var',
        },
        message: 'Dynamic renpy.jump target cannot be resolved statically: target_var',
      }],
      privacy: {
        includeFileNames: true,
        includeRawScriptDetails: true,
        includeExtraDiagnostics: true,
      },
    });

    const appMetadata = bundle.app as { errorMsg?: string; errorSummary?: string };
    const firstNode = bundle.graph.nodes[0] as {
      id: string;
      label: string;
      chapter?: string;
      dialogueLines?: string[];
    };
    const firstEdge = bundle.graph.edges[0] as { source: string; target: string; label?: string };
    const firstWarning = (bundle.warnings?.[0] ?? {}) as { chapter?: string; targetExpression?: string; message?: string };
    expect(appMetadata.errorMsg).toBe('specific parse failure');
    expect(appMetadata.errorSummary).toBe(REDACTED_ERROR_SUMMARY);
    expect(firstNode.id).toBe('start');
    expect(firstNode.label).toBe('start');
    expect(firstNode.chapter).toBe('chapter1');
    expect(firstNode.dialogueLines).toEqual(['line 1']);
    expect(firstEdge.source).toBe('start');
    expect(firstEdge.target).toBe('end');
    expect(firstEdge.label).toBe('to end');
    expect(firstWarning.chapter).toBe('chapter1');
    expect(firstWarning.targetExpression).toBe('target_var');
    expect(firstWarning.message).toContain('target_var');
  });

  it('builds new issue url with metadata and bug template', () => {
    const url = buildIssueDraftUrl({
      owner: 'JavaGamer',
      repo: 'RenpyWebFlowchartViewer',
      privacy: DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
      state: {
        phase: 'error',
        dialogueSearchMode: 'auto',
        selectedVariant: 'renpy',
        fileCount: 2,
        warningCount: 1,
      },
    });

    expect(url).toContain('/issues/new?');
    expect(url).toContain('template=bug_report.md');
    const decoded = decodeURIComponent(url).replaceAll('+', ' ');
    expect(decoded).toContain('Parser variant: renpy');
    expect(decoded).toContain('Debug bundle file names included: no');
  });

  it('aliases warning identifiers when extra diagnostics are enabled without raw details', () => {
    const bundle = buildDebugBundle({
      appVersion: 'test',
      state: {
        phase: 'done',
        fileCount: 1,
        importRevision: 1,
        dialogueSearchMode: 'auto',
        errorMsg: '',
        parseProgress: null,
      },
      parser: {
        selectedVariant: 'renpy',
        customScreenActionRules: [],
      },
      graph: {
        flowNodes: [
          {
            id: 'start',
            type: 'LABEL',
            label: 'start',
            chapter: 'ch',
            dialogueCount: 0,
          },
        ],
        flowEdges: [
          {
            id: 'jump_start__missing',
            source: 'start',
            target: 'missing',
            kind: 'jump',
            label: '',
          },
        ],
      },
      parseDiagnostics: [
        {
          code: 'unresolved_target',
          severity: 'warning',
          location: {
            edgeId: 'jump_start__missing',
            sourceId: 'start',
            targetId: 'missing',
          },
          message: 'missing',
        },
      ],
      privacy: {
        includeFileNames: false,
        includeRawScriptDetails: false,
        includeExtraDiagnostics: true,
      },
    });

    const warning = (bundle.warnings?.[0] ?? {}) as {
      edgeId?: string;
      sourceId?: string;
      targetId?: string;
    };
    expect(warning.edgeId).toBe('e1');
    expect(warning.sourceId).toBe('n1');
    expect(warning.targetId).toBe('n_unmapped_2');
  });
});

describe('debug bundle edge cases', () => {
  it('toDebugBundleBlob returns a JSON Blob containing the serialized bundle', () => {
    const bundle = { schemaVersion: 1, foo: 'bar' };
    const blob = toDebugBundleBlob(bundle);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    // Verify the blob encodes the expected JSON.
    return blob.text().then((text) => {
      const parsed = JSON.parse(text) as typeof bundle;
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.foo).toBe('bar');
    });
  });

  it('buildDebugBundle with empty graph and no error produces no errorSummary', () => {
    const bundle = buildDebugBundle({
      appVersion: '1.0',
      state: {
        phase: 'done',
        fileCount: 0,
        importRevision: 0,
        dialogueSearchMode: 'auto',
        errorMsg: '',
        parseProgress: null,
      },
      parser: { selectedVariant: 'renpy', customScreenActionRules: [] },
      graph: { flowNodes: [], flowEdges: [] },
      parseDiagnostics: [],
      privacy: DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
    });

    const app = bundle.app as { errorSummary?: string };
    expect(app.errorSummary).toBeUndefined();
    expect(bundle.graph.nodes).toHaveLength(0);
    expect(bundle.graph.edges).toHaveLength(0);
    expect(bundle.graphSummary.nodeCount).toBe(0);
    expect(bundle.graphSummary.edgeCount).toBe(0);
  });

  it('buildDebugBundle includes schemaVersion and generatedAt in every bundle', () => {
    const before = Date.now();
    const bundle = buildDebugBundle({
      appVersion: '1.0',
      state: {
        phase: 'idle',
        fileCount: 0,
        importRevision: 0,
        dialogueSearchMode: 'auto',
        errorMsg: '',
        parseProgress: null,
      },
      parser: { selectedVariant: 'renpy', customScreenActionRules: [] },
      graph: { flowNodes: [], flowEdges: [] },
      parseDiagnostics: [],
      privacy: DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
    });
    const after = Date.now();
    expect(bundle.schemaVersion).toBe(1);
    const generatedAt = new Date(bundle.generatedAt as string).getTime();
    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(after);
  });

  it('buildDebugBundle aliases parentLabelId in nodes when privacy is off', () => {
    const bundle = buildDebugBundle({
      appVersion: 'test',
      state: {
        phase: 'done',
        fileCount: 1,
        importRevision: 1,
        dialogueSearchMode: 'auto',
        errorMsg: '',
        parseProgress: null,
      },
      parser: { selectedVariant: 'renpy', customScreenActionRules: [] },
      graph: {
        flowNodes: [
          { id: 'start', type: 'LABEL', label: 'start', dialogueCount: 0 },
          { id: 'menu_1', type: 'MENU', label: 'menu_1', dialogueCount: 0, parentLabelId: 'start' },
        ],
        flowEdges: [],
      },
      parseDiagnostics: [],
      privacy: DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
    });

    const menuNode = bundle.graph.nodes.find((n) => (n as { id: string }).id === 'n2') as
      | { id: string; parentLabelId?: string }
      | undefined;
    expect(menuNode?.parentLabelId).toBe('n1');
  });

  it('buildDebugBundle includes parentLabelId verbatim when raw details are opted in', () => {
    const bundle = buildDebugBundle({
      appVersion: 'test',
      state: {
        phase: 'done',
        fileCount: 1,
        importRevision: 1,
        dialogueSearchMode: 'auto',
        errorMsg: '',
        parseProgress: null,
      },
      parser: { selectedVariant: 'renpy', customScreenActionRules: [] },
      graph: {
        flowNodes: [
          { id: 'start', type: 'LABEL', label: 'start', dialogueCount: 0 },
          { id: 'menu_1', type: 'MENU', label: 'menu_1', dialogueCount: 0, parentLabelId: 'start' },
        ],
        flowEdges: [],
      },
      parseDiagnostics: [],
      privacy: { includeFileNames: true, includeRawScriptDetails: true, includeExtraDiagnostics: true },
    });

    const menuNode = bundle.graph.nodes.find((n) => (n as { id: string }).id === 'menu_1') as
      | { id: string; parentLabelId?: string }
      | undefined;
    expect(menuNode?.parentLabelId).toBe('start');
  });

  it('buildIssueDraftUrl reflects all opted-in privacy settings in the metadata body', () => {
    const url = buildIssueDraftUrl({
      owner: 'JavaGamer',
      repo: 'RenpyWebFlowchartViewer',
      privacy: {
        includeFileNames: true,
        includeRawScriptDetails: true,
        includeExtraDiagnostics: true,
      },
      state: {
        phase: 'done',
        dialogueSearchMode: 'full',
        selectedVariant: 'st',
        fileCount: 5,
        warningCount: 2,
      },
    });

    const decoded = decodeURIComponent(url).replaceAll('+', ' ');
    expect(decoded).toContain('Parser variant: st');
    expect(decoded).toContain('Debug bundle file names included: yes');
    expect(decoded).toContain('Debug bundle raw/script details included: yes');
    expect(decoded).toContain('Debug bundle extra diagnostics included: yes');
    expect(decoded).toContain('Imported .rpy file count: 5');
    expect(decoded).toContain('Parser warning count: 2');
  });
});
