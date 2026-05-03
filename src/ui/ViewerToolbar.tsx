import type { RefObject, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Download, Search, ZoomIn } from 'lucide-react';
import type { DialogueSearchMode } from '../application';
import type { DebugBundlePrivacyOptions } from '../application';
import type { ThemeName } from './viewerTypes';
import { THEMES } from './viewerTheme';
import { ZOOM_PRESETS } from '../config/viewerConfig';
import {
  CONTROL_INPUT_CLASS,
  CONTROL_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
} from './viewerConstants';

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
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;
  setStandaloneDialogueSearchMode: (mode: DialogueSearchMode) => void;

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
  setStandaloneDialogueSearchMode,
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
}: ViewerToolbarProps) {
  return (
    <div className="px-3 sm:px-4 py-3 border-b border-gray-200 bg-white shrink-0" role="toolbar" aria-label="Viewer controls">
      <div className="flex flex-col gap-3">
        <div className="text-sm" style={{ color: THEMES[theme].subtleText }} aria-live="off">
          {visibleNodeCount} / {totalNodeCount} node{totalNodeCount !== 1 ? 's' : ''} ·{' '}
          {visibleEdgeCount} / {totalEdgeCount} edge{totalEdgeCount !== 1 ? 's' : ''}
        </div>
        <div className="flex flex-wrap items-start gap-2 md:gap-3" role="group" aria-label="Primary controls">
          <div className="flex flex-wrap items-center gap-2 grow" role="group" aria-label="Search and filters">
            <label htmlFor="viewer-search-input" className="text-xs font-medium text-gray-700">Search</label>
            <div className="relative flex items-center min-w-[12rem] grow sm:grow-0">
              <Search size={14} className="absolute left-2 text-gray-400" aria-hidden="true" />
              <input
                id="viewer-search-input"
                ref={searchInputRef}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={onSearchInputKeyDown}
                placeholder="Search labels, dialogue lines, or dialogue count"
                aria-describedby="viewer-search-help"
                className={`pl-7 pr-2 w-full sm:w-[16rem] max-w-[90vw] ${CONTROL_INPUT_CLASS}`}
              />
            </div>
            <span id="viewer-search-help" className="sr-only">
              {dialogueLineSearchEnabled
                ? 'Search labels, dialogue lines, or dialogue count.'
                : 'Search labels or dialogue count.'}
            </span>
            <label className="text-xs flex items-center gap-1" htmlFor="min-dialogue-input">
              Minimum dialogue lines
              <input
                id="min-dialogue-input"
                type="number"
                min={0}
                value={minDialogue}
                onChange={(e) => setMinDialogue(Number(e.target.value) || 0)}
                aria-label="Minimum dialogue lines"
                className={`w-16 ${CONTROL_INPUT_CLASS}`}
              />
            </label>
            <label className="text-xs flex items-center gap-1" htmlFor="dialogue-search-mode-input">
              Dialogue search mode
              <select
                id="dialogue-search-mode-input"
                value={selectedDialogueSearchMode}
                onChange={(e) => {
                  const mode = e.target.value as DialogueSearchMode;
                  if (onDialogueSearchModeChange) {
                    onDialogueSearchModeChange(mode);
                    return;
                  }
                  setStandaloneDialogueSearchMode(mode);
                }}
                aria-label="Dialogue search mode"
                className={CONTROL_INPUT_CLASS}
              >
                <option value="auto">Auto (faster on large imports)</option>
                <option value="full">Full dialogue line search</option>
                <option value="countOnly">Performance mode (label/count only)</option>
              </select>
            </label>
            {!dialogueLineSearchEnabled && (
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Dialogue line search is disabled in performance mode.
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onFitView}
            className={CONTROL_BUTTON_CLASS}
            aria-label="Fit graph to view"
          >
            Fit view
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export controls">
          {isLargeExportTarget && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Large graph export: PNG quality reduced for responsiveness
            </span>
          )}
          <button
            onClick={onExport}
            aria-label="Export flowchart as PNG"
            className={`${PRIMARY_BUTTON_CLASS} text-white bg-violet-600 hover:bg-violet-700`}
          >
            <Download size={14} aria-hidden="true" />
            Export PNG
          </button>
          <button
            onClick={onExportSvg}
            aria-label="Export flowchart as SVG"
            className={`${PRIMARY_BUTTON_CLASS} text-violet-700 border border-violet-300 bg-white hover:bg-violet-50`}
          >
            <Download size={14} aria-hidden="true" />
            Export SVG
          </button>
          <button
            onClick={onExportJson}
            aria-label="Export graph as JSON"
            className={`${PRIMARY_BUTTON_CLASS} text-gray-700 border border-gray-300 bg-white hover:bg-gray-50`}
          >
            <Download size={14} aria-hidden="true" />
            Export JSON
          </button>
          <button
            onClick={() => onExportDebugBundle?.(debugPrivacyOptions)}
            aria-label="Export debug bundle"
            className={`${PRIMARY_BUTTON_CLASS} text-amber-900 border border-amber-300 bg-amber-50 hover:bg-amber-100`}
          >
            <Download size={14} aria-hidden="true" />
            Export Debug Bundle
          </button>
          <button
            onClick={() => onOpenIssue?.(debugPrivacyOptions)}
            aria-label="Open new GitHub issue"
            className={`${PRIMARY_BUTTON_CLASS} text-sky-800 border border-sky-300 bg-sky-50 hover:bg-sky-100`}
          >
            Open new GitHub issue
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600" role="group" aria-label="Debug bundle privacy options">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={debugPrivacyOptions.includeFileNames}
              onChange={(event) => onDebugOptionChange({ includeFileNames: event.target.checked })}
            />
            Include file names (sensitive)
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={debugPrivacyOptions.includeRawScriptDetails}
              onChange={(event) => onDebugOptionChange({ includeRawScriptDetails: event.target.checked })}
            />
            Include raw/script details (opt-in)
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={debugPrivacyOptions.includeExtraDiagnostics}
              onChange={(event) => onDebugOptionChange({ includeExtraDiagnostics: event.target.checked })}
            />
            Include extra diagnostics
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => onZoomTo(preset)}
              className={CONTROL_BUTTON_CLASS}
              aria-label={`Zoom to ${Math.round(preset * 100)} percent`}
            >
              <ZoomIn size={12} className="inline mr-1" aria-hidden="true" />
              {Math.round(preset * 100)}%
            </button>
          ))}
          <span className="text-[11px] text-gray-500">
            Shortcuts: Ctrl/Cmd+F search · Ctrl/Cmd+L fit · Ctrl/Cmd+E export PNG
          </span>
          <button
            type="button"
            onClick={toggleShowAdvancedControls}
            className={CONTROL_BUTTON_CLASS}
            aria-expanded={showAdvancedControls}
            aria-controls="viewer-advanced-controls"
            aria-label={showAdvancedControls ? 'Hide advanced controls' : 'Show advanced controls'}
          >
            {showAdvancedControls ? 'Hide advanced controls' : 'Show advanced controls'}
          </button>
        </div>
      </div>
    </div>
  );
}
