/**
 * src/ui/UtilityHeader.tsx
 *
 * Compact 38px developer utility toolbar for the Ren'Py Web Flowchart Viewer.
 * Replaces the multi-row toolbar with a unified IDE-style header containing:
 * - Brand & project breadcrumb stats
 * - Left/Right sidebar toggles
 * - Instant Ctrl+F search input
 * - Re-layout & Fit graph controls
 * - Undo / Redo
 * - Consolidated Export dropdown
 * - Theme selector & Telemetry stats
 * - Reset / Upload folder button
 */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  lazy,
  type RefObject,
  Suspense,
  useState,
} from "react";
import {
  Activity,
  FolderOpen,
  PanelLeft,
  PanelRight,
  Redo,
  RotateCcw,
  Undo,
} from "lucide-react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Tooltip } from "./primitives/index.ts";
import {
  type DebugBundlePrivacyOptions,
  type DialogueSearchMode,
  useAppStore,
  useViewerStore,
} from "../application/index.ts";
import type { ThemeName } from "../domain/index.ts";
import { ExportMenu } from "./components/ExportMenu.tsx";
import { SearchControls } from "./components/SearchControls.tsx";
import { getParserVariantPlugin } from "../config/parserRules.ts";
import { cn } from "./utils/cn.ts";

const TelemetryModal = lazy(() => import("./TelemetryModal.tsx"));

export interface UtilityHeaderProps {
  theme: ThemeName;
  visibleNodeCount: number;
  totalNodeCount: number;
  visibleEdgeCount: number;
  totalEdgeCount: number;
  totalWordCount: number;
  totalPauseDuration: number;
  visibleWordCount: number;
  visiblePauseDuration: number;
  readingSpeedWpm: number;

  searchInput: string;
  setSearchInput: (v: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  dialogueLineSearchEnabled: boolean;
  minDialogue: number;
  setMinDialogue: (v: number) => void;
  selectedDialogueSearchMode: DialogueSearchMode;
  onDialogueSearchModeChange: (mode: DialogueSearchMode) => void;

  isLargeExportTarget: boolean;
  onExport: () => void;
  onExportSvg: () => void;
  onExportJson: () => void;
  onExportMermaid: () => void;
  onExportStoryboard: () => void;
  onExportHtmlBundle: () => void;
  onExportDebugBundle?: (opts: DebugBundlePrivacyOptions) => void;
  onOpenIssue?: (opts: DebugBundlePrivacyOptions) => void;
  debugPrivacyOptions: DebugBundlePrivacyOptions;
  onDebugOptionChange: (patch: Partial<DebugBundlePrivacyOptions>) => void;

  onFitView: () => void;
  onZoomTo: (preset: number) => void;

  showAdvancedControls: boolean;
  toggleShowAdvancedControls: () => void;

  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;

  selectedSearchChapter: string;
  setSelectedSearchChapter: (chapter: string) => void;
  selectedSearchNodeKinds: Record<"LABEL" | "MENU" | "DECISION", boolean>;
  setSelectedSearchNodeKinds: (
    kinds: Record<"LABEL" | "MENU" | "DECISION", boolean>,
  ) => void;
  uniqueChapters: string[];
}

export function UtilityHeader({
  theme,
  totalNodeCount,
  totalEdgeCount,
  searchInput,
  setSearchInput,
  searchInputRef,
  onSearchInputKeyDown,
  dialogueLineSearchEnabled,
  minDialogue,
  setMinDialogue,
  selectedDialogueSearchMode,
  onDialogueSearchModeChange,
  isLargeExportTarget,
  onExport,
  onExportSvg,
  onExportJson,
  onExportMermaid,
  onExportStoryboard,
  onExportHtmlBundle,
  onExportDebugBundle,
  onOpenIssue,
  debugPrivacyOptions,
  onDebugOptionChange,
  onFitView,
  onZoomTo,
  showAdvancedControls,
  toggleShowAdvancedControls,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  selectedSearchChapter,
  setSelectedSearchChapter,
  selectedSearchNodeKinds,
  setSelectedSearchNodeKinds,
  uniqueChapters,
}: UtilityHeaderProps) {
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const isDark = theme === "dark";

  const setTheme = useViewerStore((s) => s.setTheme);
  const isLeftSidebarOpen = useViewerStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useViewerStore((s) => s.toggleLeftSidebar);
  const isRightDockOpen = useViewerStore((s) => s.isRightDockOpen);
  const toggleRightDock = useViewerStore((s) => s.toggleRightDock);

  const fileCount = useAppStore((s) => s.fileCount);
  const parsedVariant = useAppStore((s) => s.parsedVariant);
  const isVariantAutoDetected = useAppStore((s) => s.isVariantAutoDetected);
  const variantDetectionResult = useAppStore((s) => s.variantDetectionResult);
  const reset = useAppStore((s) => s.reset);

  const displayVariantName = parsedVariant
    ? getParserVariantPlugin(parsedVariant).label
    : null;

  return (
    <RadixTooltip.Provider>
      <header
        className={cn(
          "shrink-0 border-b z-30 transition-colors duration-200 select-none flex flex-col",
          isDark
            ? "bg-slate-900 border-slate-800 text-slate-100"
            : "bg-white border-gray-200 text-gray-900 shadow-xs",
        )}
        role="toolbar"
        aria-label="Viewer controls"
      >
        {/* Tier 1: Main Utility Header Bar */}
        <div className="h-10 px-3 flex items-center justify-between gap-3 min-w-0">
          {/* Left Section: Brand, Sidebar Toggles & Project Breadcrumb */}
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            {/* Toggle Left Sidebar */}
            <Tooltip content="Toggle files and chapter filters (Ctrl+B)">
              <button
                type="button"
                onClick={toggleLeftSidebar}
                className={cn(
                  "p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 cursor-pointer",
                  isLeftSidebarOpen
                    ? (isDark
                      ? "bg-slate-800 text-violet-400"
                      : "bg-violet-50 text-violet-600")
                    : (isDark
                      ? "text-slate-400 hover:bg-slate-800"
                      : "text-gray-500 hover:bg-gray-100"),
                )}
                aria-label="Toggle left sidebar"
                aria-expanded={isLeftSidebarOpen}
                aria-keyshortcuts="Control+B Meta+B"
              >
                <PanelLeft size={16} aria-hidden="true" />
              </button>
            </Tooltip>

            {/* Brand Link / Title */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center text-white shrink-0">
                <FolderOpen size={13} />
              </div>
              <h1 className="text-xs font-bold tracking-tight hidden md:inline truncate">
                Ren'Py Web Flowchart Viewer
              </h1>
            </div>

            <span
              className={cn(
                "hidden lg:inline font-light",
                isDark ? "text-slate-700" : "text-gray-300",
              )}
            >
              |
            </span>

            {/* Project Summary Breadcrumb */}
            <div className="flex items-center gap-1.5 min-w-0 text-xs truncate">
              <span
                className={cn(
                  "px-2 py-0.5 rounded font-mono text-[11px] font-medium border truncate max-w-[220px] 2xl:max-w-none",
                  isDark
                    ? "bg-slate-800/80 border-slate-700 text-slate-300"
                    : "bg-gray-50 border-gray-200 text-gray-700",
                )}
              >
                <span className="hidden sm:inline">
                  Parsed {fileCount} .rpy file{fileCount !== 1 ? "s" : ""}{" "}
                  →{" "}
                </span>
                {totalNodeCount} nodes, {totalEdgeCount} edges
              </span>

              {/* Auto-detected Variant Badge */}
              {displayVariantName && (
                <button
                  type="button"
                  data-testid="variant-indicator-badge"
                  onClick={() =>
                    useViewerStore.getState().setShowAdvancedControls(true)}
                  className={cn(
                    "hidden xl:inline-flex items-center gap-1 text-[11px] font-medium rounded px-2 py-0.5 border cursor-pointer transition-colors truncate max-w-[200px] 2xl:max-w-none",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                      : "bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100",
                  )}
                  title={isVariantAutoDetected
                    ? `Variant was auto-detected (${displayVariantName}${
                      variantDetectionResult?.confidence != null
                        ? ` • ${variantDetectionResult.confidence}% confidence`
                        : ""
                    }). Click to view or change settings.`
                    : `Configured variant: ${displayVariantName}. Click to view or change settings.`}
                >
                  <span className="truncate">
                    Variant: {displayVariantName}
                  </span>
                  {isVariantAutoDetected && (
                    <span className="opacity-75 font-normal shrink-0">
                      (auto-detected)
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Center Section: Quick Search Bar */}
          <div className="flex-1 max-w-md mx-3 flex justify-center min-w-0 relative">
            <SearchControls
              isDark={isDark}
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              searchInputRef={searchInputRef}
              onSearchInputKeyDown={onSearchInputKeyDown}
              dialogueLineSearchEnabled={dialogueLineSearchEnabled}
              minDialogue={minDialogue}
              setMinDialogue={setMinDialogue}
              selectedDialogueSearchMode={selectedDialogueSearchMode}
              onDialogueSearchModeChange={onDialogueSearchModeChange}
              selectedSearchChapter={selectedSearchChapter}
              setSelectedSearchChapter={setSelectedSearchChapter}
              selectedSearchNodeKinds={selectedSearchNodeKinds}
              setSelectedSearchNodeKinds={setSelectedSearchNodeKinds}
              uniqueChapters={uniqueChapters}
            />
          </div>

          {/* Right Section: Canvas Controls, Theme, Dock Toggle */}
          <div
            className="flex items-center gap-1.5 shrink-0"
            role="group"
            aria-label="Primary controls"
          >
            {/* Fit View Button */}
            <Tooltip content="Fit graph to view (Ctrl/Cmd+L)">
              <button
                type="button"
                onClick={onFitView}
                className={cn(
                  "h-7 px-2.5 rounded border text-xs font-medium flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 cursor-pointer",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                )}
                aria-label="Fit graph to view"
                aria-keyshortcuts="Control+L Meta+L"
              >
                Fit
              </button>
            </Tooltip>

            {/* Undo / Redo */}
            <div className="hidden sm:flex items-center gap-0.5">
              <Tooltip content="Undo last action (Ctrl/Cmd+Z)">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={onUndo}
                  className={cn(
                    "h-7 w-7 rounded border text-xs flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                  )}
                  aria-label="Undo last action"
                  aria-keyshortcuts="Control+Z Meta+Z"
                >
                  <Undo size={12} aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content="Redo last action (Ctrl/Cmd+Y)">
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={onRedo}
                  className={cn(
                    "h-7 w-7 rounded border text-xs flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
                  )}
                  aria-label="Redo last action"
                  aria-keyshortcuts="Control+Y Meta+Y"
                >
                  <Redo size={12} aria-hidden="true" />
                </button>
              </Tooltip>
            </div>

            {/* Theme Selector */}
            <label htmlFor="header-theme-select" className="sr-only">
              Theme
            </label>
            <select
              id="header-theme-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeName)}
              style={{ colorScheme: isDark ? "dark" : "light" }}
              className={cn(
                "h-7 rounded border px-2 text-xs font-medium cursor-pointer transition-colors focus:outline-none focus:ring-1",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white hover:border-slate-600 focus:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-800 hover:bg-gray-100 hover:text-gray-900 hover:border-gray-400 focus:ring-violet-500",
              )}
            >
              <option
                value="violet"
                className={isDark
                  ? "bg-slate-900 text-slate-100"
                  : "bg-white text-gray-900"}
              >
                Default
              </option>
              <option
                value="dark"
                className={isDark
                  ? "bg-slate-900 text-slate-100"
                  : "bg-white text-gray-900"}
              >
                Dark
              </option>
              <option
                value="highContrast"
                className={isDark
                  ? "bg-slate-900 text-slate-100"
                  : "bg-white text-gray-900"}
              >
                High Contrast
              </option>
              <option
                value="colorblind"
                className={isDark
                  ? "bg-slate-900 text-slate-100"
                  : "bg-white text-gray-900"}
              >
                Colorblind Safe
              </option>
            </select>

            {/* Telemetry Button */}
            <button
              type="button"
              onClick={() => setTelemetryOpen(true)}
              className={cn(
                "h-7 w-7 rounded border text-xs flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 cursor-pointer",
                isDark
                  ? "border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  : "border-gray-300 text-gray-400 hover:bg-gray-100 hover:text-gray-700",
              )}
              aria-label="Performance stats"
              title="Performance stats"
            >
              <Activity size={13} />
            </button>

            {/* Reset / Upload Another Folder */}
            <Tooltip content="Upload a different folder">
              <button
                type="button"
                onClick={reset}
                className={cn(
                  "h-7 px-2 rounded border text-xs flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-1 cursor-pointer",
                  isDark
                    ? "border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                )}
                aria-label="Upload a different folder"
              >
                <RotateCcw size={13} aria-hidden="true" />
                <span className="hidden 2xl:inline text-xs">
                  Upload folder
                </span>
              </button>
            </Tooltip>

            {/* Toggle Right Dock (Inspector / Settings) */}
            <Tooltip content="Toggle inspector dock (Ctrl+I)">
              <button
                type="button"
                onClick={toggleRightDock}
                className={cn(
                  "p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 cursor-pointer",
                  isRightDockOpen
                    ? (isDark
                      ? "bg-slate-800 text-violet-400"
                      : "bg-violet-50 text-violet-600")
                    : (isDark
                      ? "text-slate-400 hover:bg-slate-800"
                      : "text-gray-500 hover:bg-gray-100"),
                )}
                aria-label="Toggle right dock"
                aria-expanded={isRightDockOpen}
                aria-keyshortcuts="Control+I Meta+I"
              >
                <PanelRight size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Tier 2: Actions & Export Tool Strip */}
        <div
          className={cn(
            "px-3 py-1.5 border-t flex flex-col gap-1.5 text-xs",
            isDark
              ? "bg-slate-900/60 border-slate-800/80"
              : "bg-gray-50/80 border-gray-100",
          )}
        >
          <ExportMenu
            isDark={isDark}
            isLargeExportTarget={isLargeExportTarget}
            onExport={onExport}
            onExportSvg={onExportSvg}
            onExportJson={onExportJson}
            onExportMermaid={onExportMermaid}
            onExportStoryboard={onExportStoryboard}
            onExportHtmlBundle={onExportHtmlBundle}
            onExportDebugBundle={onExportDebugBundle}
            onOpenIssue={onOpenIssue}
            debugPrivacyOptions={debugPrivacyOptions}
            onDebugOptionChange={onDebugOptionChange}
            onZoomTo={onZoomTo}
            showAdvancedControls={showAdvancedControls}
            toggleShowAdvancedControls={toggleShowAdvancedControls}
            dialogueLineSearchEnabled={dialogueLineSearchEnabled}
            minDialogue={minDialogue}
            setMinDialogue={setMinDialogue}
            selectedDialogueSearchMode={selectedDialogueSearchMode}
            onDialogueSearchModeChange={onDialogueSearchModeChange}
          />
        </div>
        {/* Accessible Guidance text preserved for integration tests */}
        <span className="sr-only">
          Upload a Ren'Py project folder to visualize script structure, search
          dialogue, and export flowcharts
        </span>
      </header>

      {telemetryOpen && (
        <Suspense fallback={null}>
          <TelemetryModal
            open={telemetryOpen}
            onClose={() => setTelemetryOpen(false)}
          />
        </Suspense>
      )}
    </RadixTooltip.Provider>
  );
}
