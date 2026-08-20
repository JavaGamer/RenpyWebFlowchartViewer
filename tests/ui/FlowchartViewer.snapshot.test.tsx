// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Tokenizer } from "@renpy/ast/out/tokenizer/tokenizer";
import FlowchartViewer from "../../src/ui/FlowchartViewer";
import { parseRenpyFiles } from "../../src/parser/parser";

function loadFixture(name: string): string {
  const fixturesDir = resolve(import.meta.dirname, "../fixtures");
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

async function renderParsedGraph(script: string) {
  const parsed = await parseRenpyFiles([{
    name: "graph.rpy",
    content: script,
  }]);
  const { findByTestId } = render(
    <FlowchartViewer flowNodes={parsed.nodes} flowEdges={parsed.edges} />,
  );
  const el = await findByTestId("rendered-graph");
  return el.textContent;
}

import { useViewerStore } from "../../src/application/viewerStore.ts";
import { useAppStore } from "../../src/application/appStore.ts";

describe("FlowchartViewer rendered graph snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Tokenizer.clearTokenCache();
    globalThis.localStorage.clear();
    useViewerStore.setState(useViewerStore.getInitialState());
    useAppStore.setState(useAppStore.getInitialState());
  });

  afterEach(() => {
    cleanup();
  });

  it("matches snapshot for a linear graph", async () => {
    const script = [
      "label start:",
      '    "Welcome"',
      "",
      "label second:",
      '    e "Hi"',
      "",
    ].join("\n");

    await expect(renderParsedGraph(script)).resolves.toMatchSnapshot();
  });

  it("matches snapshot for branching menu graph", async () => {
    const script = [
      "label choice:",
      "    menu:",
      '        "Option A":',
      "            jump end_a",
      '        "Option B":',
      "            jump end_b",
      "",
      "label end_a:",
      '    "done a"',
      "",
      "label end_b:",
      '    "done b"',
      "",
    ].join("\n");

    await expect(renderParsedGraph(script)).resolves.toMatchSnapshot();
  });

  it("matches snapshot for cyclic jumps fixture graph", async () => {
    const fixtureScript = loadFixture("cyclic-jumps.rpy");
    await expect(renderParsedGraph(fixtureScript)).resolves.toMatchSnapshot();
  });
});
