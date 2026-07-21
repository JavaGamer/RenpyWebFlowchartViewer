// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { axe } from "vitest-axe";
import * as Tooltip from "@radix-ui/react-tooltip";

import { ExportMenu } from "../../src/ui/components/ExportMenu";
import { UrlImportForm } from "../../src/ui/components/UrlImportForm";
import { UploadProgress } from "../../src/ui/components/UploadProgress";
import Header from "../../src/ui/Header";

afterEach(cleanup);

// Configure strict WCAG 2.2 Level AA rule tags
const wcag22Options = {
  runOnly: {
    type: "tag" as const,
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },
};

describe("Component Accessibility (a11y) - WCAG 2.2 AA Audits", () => {
  it("Header component has zero WCAG 2.2 AA accessibility violations", async () => {
    const { container } = render(
      <Header
        isDark={false}
        toggleTheme={vi.fn()}
        onOpenTelemetry={vi.fn()}
        recentProjects={[]}
        onLoadRecentProject={vi.fn()}
        onClearRecentProjects={vi.fn()}
      />,
    );

    const results = await axe(container, wcag22Options);
    expect(results).toHaveNoViolations();
  });

  it("UrlImportForm component has zero WCAG 2.2 AA accessibility violations", async () => {
    const { container } = render(
      <UrlImportForm
        isDark={false}
        importUrl="https://example.com/script.rpy"
        setImportUrl={vi.fn()}
        isFetchingUrl={false}
        urlError={null}
        handleUrlSubmit={vi.fn()}
      />,
    );

    const results = await axe(container, wcag22Options);
    expect(results).toHaveNoViolations();
  });

  it("UploadProgress component has zero WCAG 2.2 AA accessibility violations", async () => {
    const { container } = render(
      <UploadProgress
        isDark={false}
        phase="parsing"
        fileCount={10}
        doneFiles={3}
        totalFiles={10}
        progressPercent={30}
        currentFile="script.rpy"
        uploadedFiles={[
          {
            id: "script.rpy",
            name: "script.rpy",
            size: 1024,
            relativePath: "script.rpy",
            status: "parsing",
          },
        ]}
        onDrop={vi.fn()}
        onDragOver={vi.fn()}
      />,
    );

    const results = await axe(container, wcag22Options);
    expect(results).toHaveNoViolations();
  });

  it("ExportMenu component has zero WCAG 2.2 AA accessibility violations", async () => {
    const { container } = render(
      <Tooltip.Provider>
        <ExportMenu
          isDark={false}
          isLargeExportTarget={false}
          onExport={vi.fn()}
          onExportSvg={vi.fn()}
          onExportJson={vi.fn()}
          onExportDebugBundle={vi.fn()}
          onOpenIssue={vi.fn()}
          debugPrivacyOptions={{
            includeFileNames: false,
            includeRawScriptDetails: false,
            includeExtraDiagnostics: false,
          }}
          onDebugOptionChange={vi.fn()}
          onZoomTo={vi.fn()}
          showAdvancedControls={false}
          toggleShowAdvancedControls={vi.fn()}
        />
      </Tooltip.Provider>,
    );

    const results = await axe(container, wcag22Options);
    expect(results).toHaveNoViolations();
  });
});
