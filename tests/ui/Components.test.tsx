// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as Tooltip from "@radix-ui/react-tooltip";

afterEach(cleanup);
import { ExportMenu } from "../../src/ui/components/ExportMenu.tsx";
import { UrlImportForm } from "../../src/ui/components/UrlImportForm.tsx";
import { UploadProgress } from "../../src/ui/components/UploadProgress.tsx";

describe("UI Components Unit Tests", () => {
  describe("ExportMenu", () => {
    const defaultProps = {
      isDark: false,
      isLargeExportTarget: false,
      onExport: vi.fn(),
      onExportSvg: vi.fn(),
      onExportJson: vi.fn(),
      onExportDebugBundle: vi.fn(),
      onOpenIssue: vi.fn(),
      debugPrivacyOptions: {
        includeFileNames: false,
        includeRawScriptDetails: false,
        includeExtraDiagnostics: false,
      },
      onDebugOptionChange: vi.fn(),
      onZoomTo: vi.fn(),
      showAdvancedControls: false,
      toggleShowAdvancedControls: vi.fn(),
    };

    it("renders export buttons and triggers callbacks", () => {
      render(
        <Tooltip.Provider>
          <ExportMenu {...defaultProps} />
        </Tooltip.Provider>,
      );

      const exportPngBtn = screen.getByRole("button", {
        name: /Export flowchart as PNG/i,
      });
      expect(exportPngBtn).toBeInTheDocument();
      expect(exportPngBtn).toHaveAttribute(
        "aria-keyshortcuts",
        "Control+E Meta+E",
      );

      fireEvent.click(exportPngBtn);
      expect(defaultProps.onExport).toHaveBeenCalledTimes(1);

      const exportSvgBtn = screen.getByRole("button", {
        name: /Export flowchart as SVG/i,
      });
      expect(exportSvgBtn).toBeInTheDocument();
      fireEvent.click(exportSvgBtn);
      expect(defaultProps.onExportSvg).toHaveBeenCalledTimes(1);

      const exportJsonBtn = screen.getByRole("button", {
        name: /Export graph as JSON/i,
      });
      expect(exportJsonBtn).toBeInTheDocument();
      fireEvent.click(exportJsonBtn);
      expect(defaultProps.onExportJson).toHaveBeenCalledTimes(1);
    });

    it("shows large export target warnings when flag is true", () => {
      render(
        <Tooltip.Provider>
          <ExportMenu {...defaultProps} isLargeExportTarget />
        </Tooltip.Provider>,
      );

      expect(
        screen.getByText(/Large graph export: PNG quality reduced/i),
      ).toBeInTheDocument();
    });

    it("handles checkbox changes for debug options", () => {
      render(
        <Tooltip.Provider>
          <ExportMenu {...defaultProps} />
        </Tooltip.Provider>,
      );

      const fileNamesCheckbox = screen.getByLabelText(
        /Include file names/i,
      ) as HTMLInputElement;
      expect(fileNamesCheckbox.checked).toBe(false);

      fireEvent.click(fileNamesCheckbox);
      expect(defaultProps.onDebugOptionChange).toHaveBeenCalledWith({
        includeFileNames: true,
      });
    });
  });

  describe("UrlImportForm", () => {
    const defaultProps = {
      isDark: false,
      importUrl: "https://example.com/scenario.rpy",
      setImportUrl: vi.fn(),
      isFetchingUrl: false,
      urlError: null,
      handleUrlSubmit: vi.fn(),
    };

    it("renders input, submit actions", () => {
      render(<UrlImportForm {...defaultProps} />);

      const input = screen.getByPlaceholderText(
        /Enter .rpy file, .zip URL, or GitHub repo/i,
      ) as HTMLInputElement;
      expect(input.value).toBe("https://example.com/scenario.rpy");

      fireEvent.change(input, { target: { value: "https://newurl.com" } });
      expect(defaultProps.setImportUrl).toHaveBeenCalledWith(
        "https://newurl.com",
      );

      const submitBtn = screen.getByRole("button", { name: /Import/i });
      fireEvent.click(submitBtn);
      expect(defaultProps.handleUrlSubmit).toHaveBeenCalledTimes(1);
    });

    it("displays error and loading spinner correctly", () => {
      const { rerender } = render(
        <UrlImportForm {...defaultProps} urlError="Failed to fetch URL" />,
      );

      expect(screen.getByText(/Failed to fetch URL/i)).toBeInTheDocument();

      rerender(<UrlImportForm {...defaultProps} isFetchingUrl />);
      expect(screen.getByRole("button", { name: /Loading/i })).toBeDisabled();
    });
  });

  describe("UploadProgress", () => {
    const defaultProps = {
      isDark: false,
      phase: "parsing",
      fileCount: 10,
      doneFiles: 2,
      totalFiles: 10,
      progressPercent: 20,
      currentFile: "script.rpy",
      uploadedFiles: [
        {
          id: "script.rpy",
          name: "script.rpy",
          size: 100,
          relativePath: "script.rpy",
          status: "parsing" as const,
        },
      ],
      onDrop: vi.fn(),
      onDragOver: vi.fn(),
    };

    it("renders file counts and parsing filename progress bar correctly", () => {
      render(<UploadProgress {...defaultProps} />);

      expect(screen.getByText(/Current: script.rpy/i)).toBeInTheDocument();
      expect(screen.getByText(/Parsing 2 \/ 10 \.rpy files/i))
        .toBeInTheDocument();
      expect(screen.getByText(/20% Completed/i)).toBeInTheDocument();
    });
  });
});
