import { type RefObject, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useState } from 'react';
import { Download, Search, ZoomIn, Undo, Redo, SlidersHorizontal } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { DialogueSearchMode } from '../application';
import type { DebugBundlePrivacyOptions } from '../application';
import type { ThemeName } from '../domain';
import { THEMES } from './viewerTheme';
import { ZOOM_PRESETS } from '../config/viewerConfig';
import {
  CONTROL_INPUT_CLASS,
  CONTROL_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
} from './viewerConstants';
import { cn } from './utils/cn';

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
  selectedSearchNodeKinds: Record<'LABEL' | 'MENU' | 'DECISION', boolean>;
  setSelectedSearchNodeKinds: (kinds: Record<'LABEL' | 'MENU' | 'DECISION', boolean>) => void;
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
  const isDark = theme === 'dark';
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const hasActiveFilters = selectedSearchChapter !== "" || !selectedSearchNodeKinds.LABEL || !selectedSearchNodeKinds.MENU || !selectedSearchNodeKinds.DECISION;

  return (
    <Tooltip.Provider>
      <div
        className={cn(
          "px-3 sm:px-4 py-3 border-b shrink-0 transition-colors duration-200",
          isDark
            ? "bg-slate-900 border-slate-800 text-slate-100"
            : "bg-white border-gray-200"
        )}
        role="toolbar"
        aria-label="Viewer controls"
      >
        <div className="flex flex-col gap-3">
        <div className="text-sm" style={{ color: THEMES[theme].subtleText }} aria-live="off">
          {visibleNodeCount} / {totalNodeCount} node{totalNodeCount !== 1 ? 's' : ''} ·{' '}
          {visibleEdgeCount} / {totalEdgeCount} edge{totalEdgeCount !== 1 ? 's' : ''}
        </div>
        <div className="flex flex-wrap items-start gap-2 md:gap-3" role="group" aria-label="Primary controls">
          <div className="flex flex-wrap items-center gap-2 grow" role="group" aria-label="Search and filters">
            <label htmlFor="viewer-search-input" className={cn("text-xs font-medium", isDark ? "text-slate-300" : "text-gray-700")}>Search</label>
            <div className="relative flex items-center min-w-[12rem] grow sm:grow-0 gap-1.5">
              <div className="relative flex items-center grow">
                <Search size={14} className={cn("absolute left-2", isDark ? "text-slate-500" : "text-gray-400")} aria-hidden="true" />
                <input
                  id="viewer-search-input"
                  ref={searchInputRef}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={onSearchInputKeyDown}
                  placeholder="Search labels, dialogue lines, or dialogue count"
                  aria-describedby="viewer-search-help"
                  aria-keyshortcuts="Control+F Meta+F"
                  className={cn(
                    "pl-7 pr-2 w-full sm:w-[16rem] max-w-[90vw]",
                    CONTROL_INPUT_CLASS,
                    isDark
                      ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus-visible:ring-violet-400"
                      : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500"
                  )}
                />
              </div>
              <TooltipWrapper content={showSearchFilters ? "Hide Search Filters" : "Show Search Filters"}>
                <button
                  type="button"
                  onClick={() => setShowSearchFilters(!showSearchFilters)}
                  aria-label="Toggle search filters"
                  aria-expanded={showSearchFilters}
                  className={cn(
                    CONTROL_BUTTON_CLASS,
                    "relative p-2 shrink-0 cursor-pointer transition-all duration-150",
                    showSearchFilters || hasActiveFilters
                      ? isDark
                        ? "bg-violet-950/60 text-violet-300 border-violet-700/80"
                        : "bg-violet-50 text-violet-700 border-violet-200"
                      : isDark
                        ? "bg-slate-800 border-slate-700 text-slate-350 hover:bg-slate-700"
                        : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  {hasActiveFilters && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-500"></span>
                    </span>
                  )}
                </button>
              </TooltipWrapper>
            </div>
            <span id="viewer-search-help" className="sr-only">
              {dialogueLineSearchEnabled
                ? 'Search labels, dialogue lines, or dialogue count.'
                : 'Search labels or dialogue count.'}
            </span>
            <label className={cn("text-xs flex items-center gap-1", isDark ? "text-slate-300" : "text-gray-700")} htmlFor="min-dialogue-input">
              Minimum dialogue lines
              <input
                id="min-dialogue-input"
                type="number"
                min={0}
                value={minDialogue}
                onChange={(e) => setMinDialogue(Number(e.target.value) || 0)}
                aria-label="Minimum dialogue lines"
                className={cn(
                  "w-16",
                  CONTROL_INPUT_CLASS,
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500"
                )}
              />
            </label>
            <label className={cn("text-xs flex items-center gap-1", isDark ? "text-slate-300" : "text-gray-700")} htmlFor="dialogue-search-mode-input">
              Dialogue search mode
              <select
                id="dialogue-search-mode-input"
                value={selectedDialogueSearchMode}
                onChange={(e) => onDialogueSearchModeChange(e.target.value as DialogueSearchMode)}
                aria-label="Dialogue search mode"
                className={cn(
                  CONTROL_INPUT_CLASS,
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500"
                )}
              >
                <option value="auto">Auto (faster on large imports)</option>
                <option value="full">Full dialogue line search</option>
                <option value="countOnly">Performance mode (label/count only)</option>
              </select>
            </label>
            {!dialogueLineSearchEnabled && (
              <span className={cn(
                "text-[11px] border rounded px-2 py-1",
                isDark
                  ? "text-amber-400 bg-amber-950/40 border-amber-900/60"
                  : "text-amber-700 bg-amber-50 border border-amber-200"
              )}>
                Dialogue line search is disabled in performance mode.
              </span>
            )}
          </div>
          <TooltipWrapper content="Fit graph to view (Ctrl/Cmd+L)">
            <button
              type="button"
              onClick={onFitView}
              className={cn(
                CONTROL_BUTTON_CLASS,
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500"
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
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500"
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
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500"
              )}
              aria-label="Redo last action"
              aria-keyshortcuts="Control+Y Meta+Y"
            >
              <Redo size={12} className="inline mr-1" aria-hidden="true" />
              Redo
            </button>
          </TooltipWrapper>
        </div>

        {/* Collapsible search filters */}
        {showSearchFilters && (
          <div className={cn(
            "flex flex-wrap items-center gap-4 p-3 rounded-lg border text-sm transition-all duration-200 animate-fade-in animate-duration-150",
            isDark
              ? "bg-slate-950/40 border-slate-800 text-slate-200"
              : "bg-gray-50 border-gray-150 text-gray-750"
          )}>
            {/* Chapter select */}
            <div className="flex items-center gap-2">
              <label htmlFor="chapter-scope-select" className={cn("text-xs font-bold uppercase tracking-wider", isDark ? "text-slate-500" : "text-gray-400")}>Chapter Scope:</label>
              <select
                id="chapter-scope-select"
                value={selectedSearchChapter}
                onChange={(e) => setSelectedSearchChapter(e.target.value)}
                disabled={uniqueChapters.length === 0}
                className={cn(
                  CONTROL_INPUT_CLASS,
                  "py-1 px-2 text-xs w-[12rem]",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500"
                )}
              >
                <option value="">All Chapters</option>
                {uniqueChapters.map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </div>

            {/* Node Kinds Toggle Chips */}
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-bold uppercase tracking-wider", isDark ? "text-slate-500" : "text-gray-400")}>Match Node Kinds:</span>
              <div className="flex items-center gap-1.5" role="group" aria-label="Search node types">
                {(['LABEL', 'MENU', 'DECISION'] as const).map((kind) => {
                  const isActive = selectedSearchNodeKinds[kind];
                  const labelMap = { LABEL: 'Labels', MENU: 'Menus', DECISION: 'Decisions' };
                  const activeClassMap = {
                    LABEL: isDark ? "bg-violet-950/80 text-violet-300 border-violet-700" : "bg-violet-100 text-violet-800 border-violet-300",
                    MENU: isDark ? "bg-amber-950/80 text-amber-300 border-amber-700" : "bg-amber-100 text-amber-800 border-amber-300",
                    DECISION: isDark ? "bg-emerald-950/80 text-emerald-300 border-emerald-700" : "bg-emerald-100 text-emerald-800 border-emerald-300",
                  };
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        setSelectedSearchNodeKinds({
                          ...selectedSearchNodeKinds,
                          [kind]: !isActive,
                        });
                      }}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-full border transition-all duration-150 cursor-pointer shadow-sm hover:scale-[1.02]",
                        isActive
                          ? activeClassMap[kind]
                          : isDark
                            ? "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-350 hover:border-slate-700"
                            : "bg-white border-gray-200 text-gray-450 hover:text-gray-600 hover:border-gray-300"
                      )}
                    >
                      {labelMap[kind]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Reset button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSearchChapter("");
                  setSelectedSearchNodeKinds({ LABEL: true, MENU: true, DECISION: true });
                }}
                className={cn(
                  "ml-auto text-xs font-semibold px-2 py-1 rounded transition-colors duration-150 cursor-pointer",
                  isDark
                    ? "text-rose-400 hover:bg-rose-950/30"
                    : "text-rose-600 hover:bg-rose-50"
                )}
              >
                Reset Filters
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export controls">
          {isLargeExportTarget && (
            <span className={cn(
              "text-xs border rounded px-2 py-1",
              isDark
                ? "text-amber-400 bg-amber-950/40 border-amber-900/60"
                : "text-amber-700 bg-amber-50 border border-amber-200"
            )}>
              Large graph export: PNG quality reduced for responsiveness
            </span>
          )}
          <TooltipWrapper content="Export flowchart as PNG (Ctrl/Cmd+E)">
            <button
              onClick={onExport}
              aria-label="Export flowchart as PNG"
              aria-keyshortcuts="Control+E Meta+E"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                isDark
                  ? "text-white bg-violet-600 hover:bg-violet-500 focus-visible:ring-violet-400"
                  : "text-white bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500"
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export PNG
            </button>
          </TooltipWrapper>
          <TooltipWrapper content="Export flowchart as SVG">
            <button
              onClick={onExportSvg}
              aria-label="Export flowchart as SVG"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                isDark
                  ? "text-violet-300 border border-violet-850 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-violet-700 border border-violet-300 bg-white hover:bg-violet-50 focus-visible:ring-violet-500"
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export SVG
            </button>
          </TooltipWrapper>
          <TooltipWrapper content="Export graph as JSON">
            <button
              onClick={onExportJson}
              aria-label="Export graph as JSON"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                isDark
                  ? "text-slate-300 border border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500"
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export JSON
            </button>
          </TooltipWrapper>
          <TooltipWrapper content="Export debug bundle for troubleshooting">
            <button
              onClick={() => onExportDebugBundle?.(debugPrivacyOptions)}
              aria-label="Export debug bundle"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                isDark
                  ? "text-amber-300 border border-amber-900/60 bg-amber-950/40 hover:bg-amber-950/80 focus-visible:ring-violet-400"
                  : "text-amber-900 border border-amber-300 bg-amber-50 hover:bg-amber-100 focus-visible:ring-violet-500"
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export Debug Bundle
            </button>
          </TooltipWrapper>
          <TooltipWrapper content="Create a pre-filled GitHub issue with diagnostics">
            <button
              onClick={() => onOpenIssue?.(debugPrivacyOptions)}
              aria-label="Open new GitHub issue"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                isDark
                  ? "text-sky-300 border border-sky-900/60 bg-sky-950/40 hover:bg-sky-950/80 focus-visible:ring-violet-400"
                  : "text-sky-800 border border-sky-300 bg-sky-50 hover:bg-sky-100 focus-visible:ring-violet-500"
              )}
            >
              Open new GitHub issue
            </button>
          </TooltipWrapper>
        </div>
        <div className={cn("flex flex-wrap items-center gap-3 text-[11px]", isDark ? "text-slate-400" : "text-gray-600")} role="group" aria-label="Debug bundle privacy options">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={debugPrivacyOptions.includeFileNames}
              onChange={(event) => onDebugOptionChange({ includeFileNames: event.target.checked })}
              className="rounded text-violet-600 focus:ring-violet-500"
            />
            Include file names (sensitive)
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={debugPrivacyOptions.includeRawScriptDetails}
              onChange={(event) => onDebugOptionChange({ includeRawScriptDetails: event.target.checked })}
              className="rounded text-violet-600 focus:ring-violet-500"
            />
            Include raw/script details (opt-in)
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={debugPrivacyOptions.includeExtraDiagnostics}
              onChange={(event) => onDebugOptionChange({ includeExtraDiagnostics: event.target.checked })}
              className="rounded text-violet-600 focus:ring-violet-500"
            />
            Include extra diagnostics
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => onZoomTo(preset)}
              className={cn(
                CONTROL_BUTTON_CLASS,
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500"
              )}
              aria-label={`Zoom to ${Math.round(preset * 100)} percent`}
            >
              <ZoomIn size={12} className="inline mr-1" aria-hidden="true" />
              {Math.round(preset * 100)}%
            </button>
          ))}
          <span className={cn("text-[11px]", isDark ? "text-slate-500" : "text-gray-500")}>
            Shortcuts: Ctrl/Cmd+F search · Ctrl/Cmd+L fit · Ctrl/Cmd+E export PNG · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo
          </span>
          <button
            type="button"
            onClick={toggleShowAdvancedControls}
            className={cn(
              CONTROL_BUTTON_CLASS,
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500"
            )}
            aria-expanded={showAdvancedControls}
            aria-controls="viewer-advanced-controls"
            aria-label={showAdvancedControls ? 'Hide advanced controls' : 'Show advanced controls'}
          >
            {showAdvancedControls ? 'Hide advanced controls' : 'Show advanced controls'}
          </button>
        </div>
      </div>
    </div>
    </Tooltip.Provider>
  );
}
