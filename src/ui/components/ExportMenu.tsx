import { Download, ZoomIn } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "../utils/cn.ts";
import type {
  DebugBundlePrivacyOptions,
  DialogueSearchMode,
} from "../../application/index.ts";
import { ZOOM_PRESETS } from "../../config/viewerConfig.ts";
import { PRIMARY_BUTTON_CLASS } from "../viewerConstants.ts";

interface ExportMenuProps {
  isDark: boolean;
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
  onZoomTo: (preset: number) => void;
  showAdvancedControls: boolean;
  toggleShowAdvancedControls: () => void;

  dialogueLineSearchEnabled?: boolean;
  minDialogue?: number;
  setMinDialogue?: (v: number) => void;
  selectedDialogueSearchMode?: DialogueSearchMode;
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;
}

export function ExportMenu({
  isDark,
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
  onZoomTo,
  showAdvancedControls,
  toggleShowAdvancedControls,
  dialogueLineSearchEnabled = true,
  minDialogue,
  setMinDialogue,
  selectedDialogueSearchMode,
  onDialogueSearchModeChange,
}: ExportMenuProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Row 1: Export Actions */}
      <div
        className="flex flex-wrap items-center gap-1.5 w-full"
        role="group"
        aria-label="Export controls"
      >
        {isLargeExportTarget && (
          <span
            className={cn(
              "text-[11px] border rounded px-2 py-0.5",
              isDark
                ? "text-amber-400 bg-amber-950/40 border-amber-900/60"
                : "text-amber-700 bg-amber-50 border-amber-200",
            )}
          >
            Large graph export: PNG quality reduced for responsiveness
          </span>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={onExport}
              aria-label="Export flowchart as PNG"
              aria-keyshortcuts="Control+E Meta+E"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-semibold rounded justify-center leading-none cursor-pointer",
                isDark
                  ? "text-white bg-violet-600 hover:bg-violet-500 focus-visible:ring-violet-400"
                  : "text-white bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500",
              )}
            >
              <Download size={13} aria-hidden="true" />
              Export PNG
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Export flowchart as PNG (Ctrl/Cmd+E)
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={onExportSvg}
              aria-label="Export flowchart as SVG"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-medium rounded border justify-center leading-none cursor-pointer",
                isDark
                  ? "text-violet-300 border-violet-800 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-violet-700 border-violet-300 bg-white hover:bg-violet-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={13} aria-hidden="true" />
              Export SVG
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Export flowchart as SVG
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={onExportMermaid}
              aria-label="Export Mermaid diagram"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-medium rounded border justify-center leading-none cursor-pointer",
                isDark
                  ? "text-slate-300 border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={13} aria-hidden="true" />
              Export .mmd
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Export as Mermaid diagram
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={onExportStoryboard}
              aria-label="Export narrative storyboard"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-medium rounded border justify-center leading-none cursor-pointer",
                isDark
                  ? "text-slate-300 border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={13} aria-hidden="true" />
              Export .md
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Export narrative storyboard
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={onExportHtmlBundle}
              aria-label="Export offline interactive HTML bundle"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-medium rounded border justify-center leading-none cursor-pointer",
                isDark
                  ? "text-slate-300 border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={13} aria-hidden="true" />
              Export HTML
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Export offline interactive HTML bundle
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={onExportJson}
              aria-label="Export graph as JSON"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-medium rounded border justify-center leading-none cursor-pointer",
                isDark
                  ? "text-slate-300 border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={13} aria-hidden="true" />
              Export JSON
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Export graph as JSON
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={() => onExportDebugBundle?.(debugPrivacyOptions)}
              aria-label="Export debug bundle"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-medium rounded border justify-center leading-none cursor-pointer",
                isDark
                  ? "text-amber-300 border-amber-900/60 bg-amber-950/40 hover:bg-amber-950/80 focus-visible:ring-violet-400"
                  : "text-amber-900 border-amber-300 bg-amber-50 hover:bg-amber-100 focus-visible:ring-violet-500",
              )}
            >
              <Download size={13} aria-hidden="true" />
              Export Debug Bundle
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Export debug bundle for troubleshooting
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={() => onOpenIssue?.(debugPrivacyOptions)}
              aria-label="Open new GitHub issue"
              className={cn(
                PRIMARY_BUTTON_CLASS,
                "h-7 px-2.5 py-0 text-xs font-medium rounded border justify-center leading-none cursor-pointer",
                isDark
                  ? "text-sky-300 border-sky-900/60 bg-sky-950/40 hover:bg-sky-950/80 focus-visible:ring-violet-400"
                  : "text-sky-800 border-sky-300 bg-sky-50 hover:bg-sky-100 focus-visible:ring-violet-500",
              )}
            >
              Open new GitHub issue
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              Create a pre-filled GitHub issue with diagnostics
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>

      {/* Row 2: Graph Filters, Diagnostics Options, Zoom presets, Shortcuts */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 w-full pt-1.5 border-t border-slate-700/20 dark:border-slate-800 text-xs">
        {/* Left: Filters & Privacy options */}
        <div className="flex flex-wrap items-center gap-3">
          {minDialogue !== undefined && setMinDialogue && (
            <label
              className={cn(
                "text-xs flex items-center gap-1.5",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
              htmlFor="min-dialogue-input"
            >
              <span className="text-[11px] font-medium">Min dialogue:</span>
              <input
                id="min-dialogue-input"
                type="number"
                min={0}
                value={minDialogue}
                onChange={(e) => {
                  const val = e.target.value;
                  setMinDialogue(
                    val === "" ? 0 : Math.max(0, parseInt(val, 10) || 0),
                  );
                }}
                aria-label="Minimum dialogue lines"
                className={cn(
                  "w-12 h-6 px-1 text-center font-mono text-xs rounded border transition-colors",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-1 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-900 focus-visible:ring-1 focus-visible:ring-violet-500",
                )}
              />
            </label>
          )}

          {selectedDialogueSearchMode && onDialogueSearchModeChange && (
            <label
              className={cn(
                "text-xs flex items-center gap-1.5",
                isDark ? "text-slate-300" : "text-gray-700",
              )}
              htmlFor="dialogue-search-mode-input"
            >
              <span className="text-[11px] font-medium">Mode:</span>
              <select
                id="dialogue-search-mode-input"
                value={selectedDialogueSearchMode}
                onChange={(e) =>
                  onDialogueSearchModeChange(
                    e.target.value as DialogueSearchMode,
                  )}
                aria-label="Dialogue search mode"
                style={{ colorScheme: isDark ? "dark" : "light" }}
                className={cn(
                  "h-6 text-xs px-1.5 rounded border transition-colors cursor-pointer",
                  isDark
                    ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-1 focus-visible:ring-violet-400"
                    : "bg-white border-gray-300 text-gray-900 focus-visible:ring-1 focus-visible:ring-violet-500",
                )}
              >
                <option
                  value="auto"
                  className={isDark
                    ? "bg-slate-900 text-slate-100"
                    : "bg-white text-gray-900"}
                >
                  Auto
                </option>
                <option
                  value="full"
                  className={isDark
                    ? "bg-slate-900 text-slate-100"
                    : "bg-white text-gray-900"}
                >
                  Full text
                </option>
                <option
                  value="countOnly"
                  className={isDark
                    ? "bg-slate-900 text-slate-100"
                    : "bg-white text-gray-900"}
                >
                  Count only
                </option>
              </select>
            </label>
          )}

          {!dialogueLineSearchEnabled && (
            <span
              className={cn(
                "text-[10px] border rounded px-1.5 py-0.5 whitespace-nowrap",
                isDark
                  ? "text-amber-400 bg-amber-950/40 border-amber-900/60"
                  : "text-amber-700 bg-amber-50 border-amber-200",
              )}
            >
              Dialogue line search is disabled in performance mode
            </span>
          )}

          <span
            className={cn(
              "hidden sm:inline font-light",
              isDark ? "text-slate-700" : "text-gray-300",
            )}
          >
            |
          </span>

          <div
            className={cn(
              "flex flex-wrap items-center gap-3 text-[11px]",
              isDark ? "text-slate-400" : "text-gray-600",
            )}
            role="group"
            aria-label="Debug bundle privacy options"
          >
            <label
              className={cn(
                "inline-flex items-center gap-1.5 cursor-pointer transition-colors",
                isDark ? "hover:text-slate-200" : "hover:text-gray-900",
              )}
            >
              <input
                type="checkbox"
                checked={debugPrivacyOptions.includeFileNames}
                onChange={(event) =>
                  onDebugOptionChange({
                    includeFileNames: event.target.checked,
                  })}
                className="rounded text-violet-600 focus:ring-violet-500 cursor-pointer"
              />
              Include file names (sensitive)
            </label>
            <label
              className={cn(
                "inline-flex items-center gap-1.5 cursor-pointer transition-colors",
                isDark ? "hover:text-slate-200" : "hover:text-gray-900",
              )}
            >
              <input
                type="checkbox"
                checked={debugPrivacyOptions.includeRawScriptDetails}
                onChange={(event) =>
                  onDebugOptionChange({
                    includeRawScriptDetails: event.target.checked,
                  })}
                className="rounded text-violet-600 focus:ring-violet-500 cursor-pointer"
              />
              Include raw/script details (opt-in)
            </label>
            <label
              className={cn(
                "inline-flex items-center gap-1.5 cursor-pointer transition-colors",
                isDark ? "hover:text-slate-200" : "hover:text-gray-900",
              )}
            >
              <input
                type="checkbox"
                checked={debugPrivacyOptions.includeExtraDiagnostics}
                onChange={(event) =>
                  onDebugOptionChange({
                    includeExtraDiagnostics: event.target.checked,
                  })}
                className="rounded text-violet-600 focus:ring-violet-500 cursor-pointer"
              />
              Include extra diagnostics
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {ZOOM_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              onClick={() => onZoomTo(preset)}
              className={cn(
                "h-6 px-2 text-[11px] font-medium rounded border inline-flex items-center justify-center gap-1 transition-colors leading-none focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
              aria-label={`Zoom to ${Math.round(preset * 100)} percent`}
            >
              <ZoomIn size={11} aria-hidden="true" className="shrink-0" />
              <span>{Math.round(preset * 100)}%</span>
            </button>
          ))}
          <span
            className={cn(
              "hidden xl:inline text-[11px] leading-none",
              isDark ? "text-slate-500" : "text-gray-500",
            )}
          >
            Shortcuts: Ctrl/Cmd+F search · Ctrl/Cmd+B sidebar · Ctrl/Cmd+I
            inspector · Ctrl/Cmd+L fit · Ctrl/Cmd+E export · Ctrl/Cmd+Z undo
          </span>
          <button
            type="button"
            onClick={toggleShowAdvancedControls}
            className={cn(
              "h-6 px-2.5 text-[11px] font-medium rounded border inline-flex items-center justify-center transition-colors leading-none focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ml-1 cursor-pointer",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
            )}
            aria-expanded={showAdvancedControls}
            aria-controls="viewer-advanced-controls"
            aria-label={showAdvancedControls
              ? "Hide advanced controls"
              : "Show advanced controls"}
          >
            {showAdvancedControls
              ? "Hide advanced controls"
              : "Show advanced controls"}
          </button>
        </div>
      </div>
    </div>
  );
}
