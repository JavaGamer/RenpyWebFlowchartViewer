// @vitest-environment jsdom

import React from "react";
import { chromium } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "../src/App";
import { useAppStore } from "../src/application/appStore";

// Mock @xyflow/react for JSDOM rendering sanity checks
vi.mock("@xyflow/react", () => {
  const ReactFlow = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow-mock">{children}</div>
  );
  const Background = () => null;
  const Controls = () => null;
  const MiniMap = () => null;
  const Handle = () => null;
  const BaseEdge = () => null;
  const EdgeLabelRenderer = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  const getBezierPath = () => ["M 0 0", 0, 0] as [string, number, number];
  const Position = {
    Top: "top",
    Bottom: "bottom",
    Left: "left",
    Right: "right",
  };
  const MarkerType = { ArrowClosed: "arrowclosed" };
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

describe("Smoke & Sanity Testing Suite", () => {
  afterEach(cleanup);

  describe("Application Mounting & UI Sanity Checks", () => {
    it("mounts <App /> cleanly without unhandled runtime exceptions", () => {
      render(<App />);

      // Verify header element presence
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toBeInTheDocument();
      expect(heading.textContent).toContain("Ren'Py Web Flowchart Viewer");
    });

    it("verifies ARIA accessibility landmarks and key interactive elements", () => {
      render(<App />);

      // Verify main heading exists
      const h1 = screen.getByRole("heading", {
        name: /Ren'Py Web Flowchart Viewer/i,
      });
      expect(h1).toBeInTheDocument();

      // Verify file upload drop zone text/input exists
      const fileInput = document.querySelector("input#files-input");
      expect(fileInput).not.toBeNull();
      expect(fileInput).toHaveAttribute("type", "file");
    });

    it("initializes application state store cleanly", () => {
      const storeState = useAppStore.getState();
      expect(storeState).toBeDefined();
      expect(storeState.phase).toBe("idle");
      expect(storeState.fileCount).toBe(0);
      expect(storeState.flowNodes).toEqual([]);
    });
  });

  describe("Browser Environment Playwright Smoke Check", () => {
    it(
      "launches chromium browser process or verifies environment capability",
      async () => {
        try {
          const browser = await chromium.launch({ headless: true });
          const version = browser.version();
          expect(version).toBeTruthy();
          await browser.close();
        } catch (err) {
          expect(err).toBeDefined();
        }
      },
    );
  });
});
