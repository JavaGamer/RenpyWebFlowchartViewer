import { describe, expect, it } from 'vitest';
import {
  buildDebugBundle,
  buildIssueDraftUrl,
  DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
} from '../src/application';

describe('debug bundle privacy defaults', () => {
  it('redacts file names and raw script details by default', () => {
    const bundle = buildDebugBundle({
      appVersion: 'test',
      state: {
        phase: 'error',
        fileCount: 1,
        importRevision: 0,
        dialogueSearchMode: 'auto',
        errorMsg: 'failed',
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
      parseWarnings: [{
        code: 'dynamic_target',
        chapter: 'secret-file',
        construct: 'renpy.call',
        targetExpression: 'secret_target',
        message: 'Dynamic renpy.call target cannot be resolved statically: secret_target',
      }],
      privacy: DEFAULT_DEBUG_BUNDLE_PRIVACY_OPTIONS,
    });

    const progress = bundle.app.parseProgress as { currentFile?: string } | null;
    expect(progress).not.toBeNull();
    expect(progress?.currentFile).toBeUndefined();
    const firstNode = bundle.graph.nodes[0] as { chapter?: string; dialogueLines?: string[] };
    expect(firstNode.chapter).toBeUndefined();
    expect(firstNode.dialogueLines).toBeUndefined();
    const firstEdge = bundle.graph.edges[0] as { label?: string };
    expect(firstEdge.label).toBeUndefined();
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
        errorMsg: '',
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
      parseWarnings: [{
        code: 'dynamic_target',
        chapter: 'chapter1',
        construct: 'renpy.jump',
        targetExpression: 'target_var',
        message: 'Dynamic renpy.jump target cannot be resolved statically: target_var',
      }],
      privacy: {
        includeFileNames: true,
        includeRawScriptDetails: true,
        includeExtraDiagnostics: true,
      },
    });

    const firstNode = bundle.graph.nodes[0] as { chapter?: string; dialogueLines?: string[] };
    const firstEdge = bundle.graph.edges[0] as { label?: string };
    const firstWarning = (bundle.warnings?.[0] ?? {}) as { chapter?: string; targetExpression?: string; message?: string };
    expect(firstNode.chapter).toBe('chapter1');
    expect(firstNode.dialogueLines).toEqual(['line 1']);
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
});
