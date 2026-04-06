// @vitest-environment jsdom
/**
 * tests/App.integration.test.tsx
 *
 * UI integration tests for the upload → parse → render pipeline.
 *
 * Heavy browser-only dependencies (React Flow, html-to-image) are mocked so
 * the tests remain fast and deterministic in jsdom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, within, act, fireEvent, createEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import { toBlob, toSvg } from 'html-to-image';
import App from '../src/App';
import * as parser from '../src/parser';
import * as infrastructure from '../src/infrastructure';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// React Flow requires a real browser canvas and ResizeObserver; mock it away.
vi.mock('@xyflow/react', () => {
  const ReactFlow = ({
    nodes,
    edges,
    children,
  }: {
    nodes: Array<{ hidden?: boolean }>;
    edges: unknown[];
    children?: React.ReactNode;
  }) => (
    <div data-testid="react-flow">
      <span data-testid="rf-node-count">{nodes.filter((n) => !n.hidden).length}</span>
      <span data-testid="rf-edge-count">{edges.length}</span>
      {children}
    </div>
  );
  const Background = () => null;
  const Controls = () => null;
  const MiniMap = () => null;
  const Handle = () => null;
  const BaseEdge = () => null;
  const EdgeLabelRenderer = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const getBezierPath = () => ['M 0 0', 0, 0] as [string, number, number];
  const Position = { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' };
  const MarkerType = { ArrowClosed: 'arrowclosed' };
  const useNodesState = (initial: unknown[]) => {
    const [nodes, setNodes] = React.useState(initial);
    return [nodes, setNodes, vi.fn()] as const;
  };
  const useEdgesState = (initial: unknown[]) => {
    const [edges, setEdges] = React.useState(initial);
    return [edges, setEdges, vi.fn()] as const;
  };

  return {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Handle,
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    Position,
    MarkerType,
    useNodesState,
    useEdgesState,
  };
});

// html-to-image requires canvas; return a stub Blob.
vi.mock('../src/infrastructure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infrastructure')>();
  return {
    ...actual,
    parseRenpyFilesInWorker: vi.fn(async ({ files }: { files: Array<{ name: string; content: string }> }) => parser.parseRenpyFiles(files)),
  };
});

vi.mock('html-to-image', () => ({
  toBlob: vi.fn().mockResolvedValue(new Blob(['stub'], { type: 'image/png' })),
  toSvg: vi.fn().mockResolvedValue('data:image/svg+xml;base64,c3R1Yg=='),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a File whose content is read back by FileReader in jsdom.
 * The App only checks the filename extension (not the MIME type) when
 * deciding whether a file is a .rpy script, so 'text/plain' is fine here.
 */
function makeRpyFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

/** Sample .rpy script with two labels, dialogue lines, and a jump. */
const SAMPLE_RPY = [
  'label start:',
  '    "Welcome to the game."',
  '    jump second',
  '',
  'label second:',
  '    e "Hello!"',
  '',
].join('\n');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('App – upload → parse → render integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @renpy/ast's Tokenizer has a static module-level cache keyed by document URI +
    // version. Since parse() always uses the same URI ("file://my.rpy") and version
    // (0), the cache must be cleared between tests to avoid stale results.
    Tokenizer.clearTokenCache();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('happy path: uploading a .rpy file shows parsed stats and the flowchart', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    // The upload area must be visible before any file is chosen.
    expect(
      view.getByText(/Drop your Ren'Py project folder here/i),
    ).toBeInTheDocument();

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    expect(input).not.toBeNull();

    await user.upload(input, makeRpyFile('start.rpy', SAMPLE_RPY));

    // After parsing the stats bar must show file/node/edge counts.
    await waitFor(() => {
      expect(view.getByText(/Parsed/i)).toBeInTheDocument();
    });

    // Stats bar must report 1 file processed.
    const statsText = view.getByText(/Parsed/i).closest('span')?.textContent ?? '';
    expect(statsText).toMatch(/1\s*\.rpy\s*file/i);

    // The FlowchartViewer (mocked ReactFlow) must be mounted.
    expect(view.getByTestId('react-flow')).toBeInTheDocument();

    // The mocked ReactFlow must have received the parsed nodes and edges.
    const nodeCount = parseInt(
      view.getByTestId('rf-node-count').textContent ?? '',
      10,
    );
    const edgeCount = parseInt(
      view.getByTestId('rf-edge-count').textContent ?? '',
      10,
    );
    expect(nodeCount).toBeGreaterThan(0);
    expect(edgeCount).toBeGreaterThanOrEqual(0);
  });

  it('shows an error when the uploaded files contain no .rpy extension', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, new File(['irrelevant'], 'readme.txt', { type: 'text/plain' }));

    await waitFor(() => {
      expect(
        view.getByText(/No \.rpy files found/i),
      ).toBeInTheDocument();
    });
  });

  it('rejects oversized .rpy files with a clear message', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    const oversizedScript = 'a'.repeat(2 * 1024 * 1024 + 1);
    await user.upload(input, makeRpyFile('huge.rpy', oversizedScript));

    await waitFor(() => {
      expect(view.getByText(/huge\.rpy/i)).toBeInTheDocument();
      expect(view.getByText(/too large to import/i)).toBeInTheDocument();
      expect(view.getByText(/smaller than 2 MiB \(about 2 MB\)/i)).toBeInTheDocument();
    });
  });

  it('shows an empty-graph warning when the .rpy file has no labels or menus', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    // A valid .rpy file with only comments — parser produces no nodes.
    const emptyScript = '# just a comment\n';
    await user.upload(input, makeRpyFile('empty.rpy', emptyScript));

    await waitFor(() => {
      expect(
        view.getByText(/No labels or menus were found\. Make sure the folder contains/i),
      ).toBeInTheDocument();
    });
  });

  it('allows uploading a different folder after a successful parse', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('start.rpy', SAMPLE_RPY));

    // Wait for flowchart to appear.
    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    // Click the "Upload a different folder" button to reset state.
    const resetBtn = view.getByRole('button', { name: /Upload a different folder/i });
    await user.click(resetBtn);

    // The upload area must be visible again.
    await waitFor(() => {
      expect(
        view.getByText(/Drop your Ren'Py project folder here/i),
      ).toBeInTheDocument();
    });
  });

  it('shows a file-read error message when FileReader fails', async () => {
    const user = userEvent.setup();

    // Replace the global FileReader with one that always fires onerror.
    const OriginalFileReader = globalThis.FileReader;
    class FailingFileReader {
      onload: unknown = null;
      onerror: ((e: ProgressEvent) => void) | null = null;
      result: null = null;
      readAsText() {
        Promise.resolve().then(() => this.onerror?.(new ProgressEvent('error')));
      }
    }
    vi.stubGlobal('FileReader', FailingFileReader);

    try {
      const { container } = render(<App />);
      const view = within(container);

      const input = container.querySelector('#folder-input') as HTMLInputElement;
      await user.upload(input, makeRpyFile('broken.rpy', 'label start:'));

      await waitFor(() => {
        expect(view.getByText(/Could not read "broken\.rpy"/i)).toBeInTheDocument();
      });
    } finally {
      vi.stubGlobal('FileReader', OriginalFileReader);
    }
  });

  it('shows an actionable parse error message when the parser throws', async () => {
    const user = userEvent.setup();

    vi.spyOn(infrastructure, 'parseRenpyFilesInWorker').mockRejectedValueOnce(
      new Error('Unexpected token at line 3'),
    );

    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('start.rpy', SAMPLE_RPY));

    await waitFor(() => {
      expect(
        view.getByText(/Failed to parse Ren'Py scripts.*Unexpected token at line 3/is),
      ).toBeInTheDocument();
      expect(
        view.getByText(/Ensure your \.rpy files contain valid Ren'Py syntax/i),
      ).toBeInTheDocument();
      expect(view.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    });
  });

  it('shows a non-Error file read failure using fallback stringification', async () => {
    const user = userEvent.setup();

    const OriginalFileReader = globalThis.FileReader;
    class ThrowingFileReader {
      readAsText() {
        throw { toString: () => 'non-error read failure' };
      }
    }
    vi.stubGlobal('FileReader', ThrowingFileReader);

    try {
      const { container } = render(<App />);
      const view = within(container);
      const input = container.querySelector('#folder-input') as HTMLInputElement;
      await user.upload(input, makeRpyFile('broken.rpy', 'label start:'));

      await waitFor(() => {
        expect(
          view.getByText(/An unexpected error occurred while reading files:/i),
        ).toBeInTheDocument();
        expect(view.getByText(/non-error read failure/i)).toBeInTheDocument();
      });
    } finally {
      vi.stubGlobal('FileReader', OriginalFileReader);
    }
  });

  it('revokes the object URL after each PNG export to prevent memory leaks', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('start.rpy', SAMPLE_RPY));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const originalURL = globalThis.URL;
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:stub'),
      revokeObjectURL,
    });

    try {
      const exportBtn = view.getByRole('button', { name: /Export flowchart as PNG/i });

      // First export
      await act(async () => {
        await user.click(exportBtn);
      });
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:stub');

      // Second export -- revokeObjectURL must be called again, not accumulated
      await act(async () => {
        await user.click(exportBtn);
      });
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
      expect(toBlob).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal('URL', originalURL);
    }
  });

  it('exports SVG and JSON formats successfully', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('start.rpy', SAMPLE_RPY));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const originalURL = globalThis.URL;
    const createObjectURL = vi.fn().mockReturnValue('blob:json');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });

    try {
      const exportSvgBtn = view.getByRole('button', { name: /Export flowchart as SVG/i });
      await act(async () => {
        await user.click(exportSvgBtn);
      });
      expect(toSvg).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledTimes(0);

      const exportJsonBtn = view.getByRole('button', { name: /Export graph as JSON/i });
      await act(async () => {
        await user.click(exportJsonBtn);
      });
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:json');
      const jsonBlob = createObjectURL.mock.calls[0]?.[0];
      expect(jsonBlob).toBeInstanceOf(Blob);
      const exportedJson = JSON.parse(await (jsonBlob as Blob).text()) as {
        nodes: Array<{ role?: string }>;
        edges: Array<{ kind?: string }>;
      };
      expect(exportedJson.nodes.some((n) => typeof n.role === 'string')).toBe(true);
      expect(exportedJson.edges.some((e) => typeof e.kind === 'string')).toBe(true);
    } finally {
      vi.stubGlobal('URL', originalURL);
    }
  });

  it('shows call-return edges only when the show call returns toggle is enabled', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    const scriptWithCallReturn = [
      'label main:',
      '    call helper',
      '',
      'label helper:',
      '    "in helper"',
      '    return',
      '',
    ].join('\n');
    await user.upload(input, makeRpyFile('calls.rpy', scriptWithCallReturn));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const edgeCountWithoutReturns = parseInt(
      view.getByTestId('rf-edge-count').textContent ?? '0',
      10,
    );
    expect(edgeCountWithoutReturns).toBe(2);

    const toggle = view.getByRole('checkbox', { name: /Show call returns/i });
    await user.click(toggle);

    await waitFor(() => {
      const edgeCountWithReturns = parseInt(
        view.getByTestId('rf-edge-count').textContent ?? '0',
        10,
      );
      expect(edgeCountWithReturns).toBe(3);
    });
  });

  it('file upload input has an accessible label', () => {
    const { container } = render(<App />);
    const input = container.querySelector('#folder-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute('aria-label', 'Select Ren\'Py project folder');
  });

  it('drop zone has an accessible label', () => {
    const { container } = render(<App />);
    const label = container.querySelector('label[for="folder-input"]') as HTMLLabelElement;
    expect(label).not.toBeNull();
    expect(label).toHaveAttribute('aria-label', 'Upload Ren\'Py project folder');
  });

  it('shows idle import limits guidance in live status region', () => {
    const { container } = render(<App />);
    const view = within(container);
    expect(
      view.getByText(/Ready to import up to 300 \.rpy files \(25 MiB total\)/i),
    ).toBeInTheDocument();
  });

  it('renders a skip link and persistent upload guidance text', () => {
    const { container } = render(<App />);
    const view = within(container);

    expect(view.getByRole('link', { name: /Skip to flowchart/i })).toHaveAttribute('href', '#flowchart-main');
    expect(
      view.getByText(/Upload a Ren'Py project folder to visualize its script structure/i),
    ).toBeInTheDocument();
  });

  it('filters visible nodes via search and supports chapter collapse controls', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('chapter1.rpy', SAMPLE_RPY));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const initialCount = parseInt(view.getByTestId('rf-node-count').textContent ?? '0', 10);
    const searchInput = view.getByRole('textbox', {
      name: /Search/i,
    });
    await user.type(searchInput, 'second');

    await waitFor(() => {
      const filteredCount = parseInt(view.getByTestId('rf-node-count').textContent ?? '0', 10);
      expect(filteredCount).toBeLessThan(initialCount);
    });

    await user.clear(searchInput);
    const chapterToggle = view.getByRole('button', { name: /Collapse chapter chapter1/i });
    await user.click(chapterToggle);

    await waitFor(() => {
      expect(view.getByTestId('rf-node-count')).toHaveTextContent('0');
    });
  });

  it('supports selecting high-contrast and colorblind-safe themes', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('theme.rpy', SAMPLE_RPY));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const themeSelect = view.getByRole('combobox', { name: /Color theme/i });
    await user.selectOptions(themeSelect, 'highContrast');
    expect(themeSelect).toHaveValue('highContrast');
    await user.selectOptions(themeSelect, 'colorblind');
    expect(themeSelect).toHaveValue('colorblind');
  });



  it('shows and applies edge-type visibility filters', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    const script = [
      'label start:',
      '    call helper',
      '    jump end',
      '',
      'label helper:',
      '    "in helper"',
      '    return',
      '',
      'label end:',
      '    "done"',
      '',
    ].join('\n');

    await user.upload(input, makeRpyFile('filters.rpy', script));
    await waitFor(() => expect(view.getByTestId('react-flow')).toBeInTheDocument());

    const before = parseInt(view.getByTestId('rf-edge-count').textContent ?? '0', 10);
    expect(before).toBeGreaterThanOrEqual(3);

    await user.click(view.getByRole('checkbox', { name: /Show jump edges/i }));

    await waitFor(() => {
      const after = parseInt(view.getByTestId('rf-edge-count').textContent ?? '0', 10);
      expect(after).toBeLessThan(before);
    });
  });

  it('shows upload limits feedback for excessive file count and total size', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);
    const input = container.querySelector('#folder-input') as HTMLInputElement;

    const manyFiles = Array.from({ length: 301 }, (_, i) =>
      makeRpyFile(`f${i}.rpy`, 'label a:\n    "x"\n'),
    );
    await user.upload(input, manyFiles);
    await waitFor(() => {
      expect(view.getByText(/Too many \.rpy files selected/i)).toBeInTheDocument();
    });

    const twelveMiB = 'a'.repeat(12 * 1024 * 1024);
    await user.upload(input, [
      makeRpyFile('a.rpy', twelveMiB),
      makeRpyFile('b.rpy', twelveMiB),
      makeRpyFile('c.rpy', twelveMiB),
    ]);

    await waitFor(() => {
      expect(view.getByText(/exceeds the 25 MiB import limit/i)).toBeInTheDocument();
    });
  });

  it('exposes parser progress updates and supports cancel parsing action', async () => {
    const user = userEvent.setup();
    const parseSpy = vi.spyOn(infrastructure, 'parseRenpyFilesInWorker').mockImplementationOnce(
      async ({ onProgress, signal }) => {
        onProgress?.({ doneFiles: 1, totalFiles: 2, currentFile: 'one.rpy' });
        await new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Parsing cancelled', 'AbortError')),
            { once: true },
          );
        });
      },
    );

    const { container } = render(<App />);
    const view = within(container);
    const input = container.querySelector('#folder-input') as HTMLInputElement;

    const uploadPromise = user.upload(input, [
      makeRpyFile('one.rpy', 'label one:\n    "x"\n'),
      makeRpyFile('two.rpy', 'label two:\n    "y"\n'),
    ]);

    await waitFor(() => {
      expect(view.getByText(/Parsing 1 \/ 2/i)).toBeInTheDocument();
      expect(view.getByText(/Current: one\.rpy/i)).toBeInTheDocument();
    });

    await user.click(view.getByRole('button', { name: /Cancel parsing/i }));
    await uploadPromise;

    await waitFor(() => {
      expect(view.getByText(/Parsing was cancelled/i)).toBeInTheDocument();
    });
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('supports drag-and-drop upload and handles dragover default prevention', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const dropZone = container.querySelector('label[for="folder-input"]') as HTMLLabelElement;
    const dragOverEvent = createEvent.dragOver(dropZone);
    fireEvent(dropZone, dragOverEvent);
    expect(dragOverEvent.defaultPrevented).toBe(true);

    const file = makeRpyFile('drop.rpy', SAMPLE_RPY);
    const dropEvent = createEvent.drop(dropZone, { dataTransfer: { files: [file] } });
    fireEvent(dropZone, dropEvent);
    expect(dropEvent.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const exportBtn = view.getByRole('button', { name: /Export flowchart as PNG/i });
    await user.click(exportBtn);
  });

  it('ignores stale cancellation/error from a superseded parse run', async () => {
    const user = userEvent.setup();
    const parseSpy = vi.spyOn(infrastructure, 'parseRenpyFilesInWorker');
    parseSpy.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Parsing cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    parseSpy.mockResolvedValueOnce({
      nodes: [{ id: 'new', type: 'LABEL', label: 'new', dialogueCount: 1 }],
      edges: [],
    });

    const { container } = render(<App />);
    const view = within(container);
    const input = container.querySelector('#folder-input') as HTMLInputElement;

    await user.upload(input, makeRpyFile('slow.rpy', 'label slow:\n    "x"\n'));
    await user.upload(input, makeRpyFile('new.rpy', 'label new:\n    "y"\n'));

    await waitFor(() => {
      expect(view.getByText(/Parsed/i)).toBeInTheDocument();
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    expect(view.queryByText(/Parsing was cancelled/i)).not.toBeInTheDocument();
    expect(parseSpy).toHaveBeenCalledTimes(2);
  });

  it('supports minimum dialogue filter, layout switching, zoom controls, and collapse by label', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    const scriptWithMenu = [
      'label start:',
      '    menu:',
      '        "Go":',
      '            jump end',
      '',
      'label end:',
      '    "done"',
      '',
    ].join('\n');
    await user.upload(input, makeRpyFile('chapter2.rpy', scriptWithMenu));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const minDialogueInput = view.getByRole('spinbutton', { name: /Minimum dialogue lines/i });
    await user.clear(minDialogueInput);
    await user.type(minDialogueInput, '2');
    await waitFor(() => {
      expect(view.getByTestId('rf-node-count')).toHaveTextContent('0');
    });

    await user.clear(minDialogueInput);
    await user.type(minDialogueInput, '1');
    await waitFor(() => {
      const count = parseInt(view.getByTestId('rf-node-count').textContent ?? '0', 10);
      expect(count).toBeGreaterThan(0);
    });

    const layoutSelect = view.getByRole('combobox', { name: /Auto layout direction/i });
    await user.selectOptions(layoutSelect, 'LR');
    expect(layoutSelect).toHaveValue('LR');

    const relayoutBtn = view.getByRole('button', { name: /Re-run auto layout/i });
    await user.click(relayoutBtn);

    const zoomBtn = view.getByRole('button', { name: /Zoom to 100 percent/i });
    await user.click(zoomBtn);

    await user.clear(minDialogueInput);
    await user.type(minDialogueInput, '0');
    await waitFor(() => {
      const count = parseInt(view.getByTestId('rf-node-count').textContent ?? '0', 10);
      expect(count).toBeGreaterThanOrEqual(2);
    });

    const beforeCollapse = parseInt(view.getByTestId('rf-node-count').textContent ?? '0', 10);
    const collapseLabel = view.getByRole('button', { name: /Collapse label start/i });
    await user.click(collapseLabel);
    await waitFor(() => {
      const count = parseInt(view.getByTestId('rf-node-count').textContent ?? '0', 10);
      expect(count).toBeLessThan(beforeCollapse);
    });
  });

  it('handles PNG and SVG export failures without crashing', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(toBlob).mockRejectedValueOnce(new Error('png export failed'));
    vi.mocked(toSvg).mockRejectedValueOnce(new Error('svg export failed'));

    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('export-fail.rpy', SAMPLE_RPY));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    await act(async () => {
      await user.click(view.getByRole('button', { name: /Export flowchart as PNG/i }));
    });
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Export failed:', expect.anything());
    });

    await act(async () => {
      await user.click(view.getByRole('button', { name: /Export flowchart as SVG/i }));
    });
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('SVG export failed:', expect.anything());
    });
  });
});
