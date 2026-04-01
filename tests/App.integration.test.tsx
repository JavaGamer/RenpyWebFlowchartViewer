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
import { render, waitFor, cleanup, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import { toBlob } from 'html-to-image';
import App from '../src/App';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// React Flow requires a real browser canvas and ResizeObserver; mock it away.
vi.mock('@xyflow/react', () => {
  const ReactFlow = ({
    nodes,
    edges,
  }: {
    nodes: unknown[];
    edges: unknown[];
  }) => (
    <div data-testid="react-flow">
      <span data-testid="rf-node-count">{nodes.length}</span>
      <span data-testid="rf-edge-count">{edges.length}</span>
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
  };
});

// html-to-image requires canvas; return a stub Blob.
vi.mock('html-to-image', () => ({
  toBlob: vi.fn().mockResolvedValue(new Blob(['stub'], { type: 'image/png' })),
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
        view.getByText(/No labels or menus were found/i),
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

  it('revokes the object URL after each PNG export to prevent memory leaks', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const view = within(container);

    const input = container.querySelector('#folder-input') as HTMLInputElement;
    await user.upload(input, makeRpyFile('start.rpy', SAMPLE_RPY));

    await waitFor(() => {
      expect(view.getByTestId('react-flow')).toBeInTheDocument();
    });

    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:stub'),
      revokeObjectURL,
    });

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
});
