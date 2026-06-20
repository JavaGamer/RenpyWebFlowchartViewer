import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Redo, Undo } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { DialogueSearchMode } from "../application/index.ts";
import type { DebugBundlePrivacyOptions } from "../application/index.ts";
import type { ThemeName } from "../domain/index.ts";
import { THEMES } from "./viewerTheme.ts";
import { SearchControls } from "./components/SearchControls.tsx";
import { ExportMenu } from "./components/ExportMenu.tsx";
import { CONTROL_BUTTON_CLASS } from "./viewerConstants.ts";
import { cn } from "./utils/cn.ts";

interface TooltipWrapperProps {
  content: ReactNode;
  children: ReactNode;
}

function TooltipWrapper({ content, children }: TooltipWrapperProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
          sideOffset={5}
        >
          {content}
          <Tooltip.Arrow className="fill-gray-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export interface ViewerToolbarProps {
  theme: ThemeName;
  visibleNodeCount: number;
  totalNodeCount: number;
  visibleEdgeCount: number;
  totalEdgeCount: number;

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

export function ViewerToolbar({
  theme,
  visibleNodeCount,
  totalNodeCount,
  visibleEdgeCount,
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
}: ViewerToolbarProps) {
  const isDark = theme === "dark";
  return (
    <Tooltip.Provider>
      <div
        className={cn(
          "px-3 sm:px-4 py-3 border-b shrink-0 transition-colors duration-200",
          isDark
            ? "bg-slate-900 border-slate-800 text-slate-100"
            : "bg-white border-gray-200",
        )}
        role="toolbar"
        aria-label="Viewer controls"
      >
        <div className="flex flex-col gap-3">
          <div
            className="text-sm"
            style={{ color: THEMES[theme].subtleText }}
            aria-live="off"
          >
            {visibleNodeCount} / {totalNodeCount}{" "}
            node{totalNodeCount !== 1 ? "s" : ""} · {visibleEdgeCount} /{" "}
            {totalEdgeCount} edge{totalEdgeCount !== 1 ? "s" : ""}
          </div>
          <div
            className="flex flex-wrap items-start gap-2 md:gap-3"
            role="group"
            aria-label="Primary controls"
          >
            <SearchControls
              isDark={isDark}
              theme={theme}
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
            <TooltipWrapper content="Fit graph to view (Ctrl/Cmd+L)">
              <button
                type="button"
                onClick={onFitView}
                className={cn(
                  CONTROL_BUTTON_CLASS,
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                )}
                aria-label="Fit graph to view"
                aria-keyshortcuts="Control+L Meta+L"
              >
                Fit view
              </button>
            </TooltipWrapper>
            <TooltipWrapper content="Undo last action (Ctrl/Cmd+Z)">
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndo}
                className={cn(
                  CONTROL_BUTTON_CLASS,
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                )}
                aria-label="Undo last action"
                aria-keyshortcuts="Control+Z Meta+Z"
              >
                <Undo size={12} className="inline mr-1" aria-hidden="true" />
                Undo
              </button>
            </TooltipWrapper>
            <TooltipWrapper content="Redo last action (Ctrl/Cmd+Y)">
              <button
                type="button"
                disabled={!canRedo}
                onClick={onRedo}
                className={cn(
                  CONTROL_BUTTON_CLASS,
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
                )}
                aria-label="Redo last action"
                aria-keyshortcuts="Control+Y Meta+Y"
              >
                <Redo size={12} className="inline mr-1" aria-hidden="true" />
                Redo
              </button>
            </TooltipWrapper>
          </div>

          <ExportMenu
            isDark={isDark}
            isLargeExportTarget={isLargeExportTarget}
            onExport={onExport}
            onExportSvg={onExportSvg}
            onExportJson={onExportJson}
            onExportDebugBundle={onExportDebugBundle}
            onOpenIssue={onOpenIssue}
            debugPrivacyOptions={debugPrivacyOptions}
            onDebugOptionChange={onDebugOptionChange}
            onZoomTo={onZoomTo}
            showAdvancedControls={showAdvancedControls}
            toggleShowAdvancedControls={toggleShowAdvancedControls}
          />
        </div>
      </div>
    </Tooltip.Provider>
  );
}
