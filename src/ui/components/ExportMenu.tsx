import { Download, ZoomIn } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { cn } from "../utils/cn.ts";
import type { DebugBundlePrivacyOptions } from "../../application/index.ts";
import { ZOOM_PRESETS } from "../../config/viewerConfig.ts";
import {
  CONTROL_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "../viewerConstants.ts";

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
}: ExportMenuProps) {
  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 w-full mt-1"
        role="group"
        aria-label="Export controls"
      >
        {isLargeExportTarget && (
          <span
            className={cn(
              "text-xs border rounded px-2 py-1",
              isDark
                ? "text-amber-400 bg-amber-950/40 border-amber-900/60"
                : "text-amber-700 bg-amber-50 border border-amber-200",
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
                isDark
                  ? "text-white bg-violet-600 hover:bg-violet-500 focus-visible:ring-violet-400"
                  : "text-white bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-500",
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export PNG
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
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
                isDark
                  ? "text-violet-300 border border-violet-800 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-violet-700 border border-violet-300 bg-white hover:bg-violet-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export SVG
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
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
                isDark
                  ? "text-slate-300 border border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export .mmd
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
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
                isDark
                  ? "text-slate-300 border border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export .md
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
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
                isDark
                  ? "text-slate-300 border border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export HTML
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
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
                isDark
                  ? "text-slate-300 border border-slate-700 bg-slate-800 hover:bg-slate-700 focus-visible:ring-violet-400"
                  : "text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-violet-500",
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export JSON
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
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
                isDark
                  ? "text-amber-300 border border-amber-900/60 bg-amber-950/40 hover:bg-amber-950/80 focus-visible:ring-violet-400"
                  : "text-amber-900 border border-amber-300 bg-amber-50 hover:bg-amber-100 focus-visible:ring-violet-500",
              )}
            >
              <Download size={14} aria-hidden="true" />
              Export Debug Bundle
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
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
                isDark
                  ? "text-sky-300 border border-sky-900/60 bg-sky-950/40 hover:bg-sky-950/80 focus-visible:ring-violet-400"
                  : "text-sky-800 border border-sky-300 bg-sky-50 hover:bg-sky-100 focus-visible:ring-violet-500",
              )}
            >
              Open new GitHub issue
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
              sideOffset={5}
            >
              Create a pre-filled GitHub issue with diagnostics
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-3 text-[11px] w-full",
          isDark ? "text-slate-400" : "text-gray-600",
        )}
        role="group"
        aria-label="Debug bundle privacy options"
      >
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={debugPrivacyOptions.includeFileNames}
            onChange={(event) =>
              onDebugOptionChange({
                includeFileNames: event.target.checked,
              })}
            className="rounded text-violet-600 focus:ring-violet-500"
          />
          Include file names (sensitive)
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={debugPrivacyOptions.includeRawScriptDetails}
            onChange={(event) =>
              onDebugOptionChange({
                includeRawScriptDetails: event.target.checked,
              })}
            className="rounded text-violet-600 focus:ring-violet-500"
          />
          Include raw/script details (opt-in)
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={debugPrivacyOptions.includeExtraDiagnostics}
            onChange={(event) =>
              onDebugOptionChange({
                includeExtraDiagnostics: event.target.checked,
              })}
            className="rounded text-violet-600 focus:ring-violet-500"
          />
          Include extra diagnostics
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 w-full">
        {ZOOM_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset}
            onClick={() => onZoomTo(preset)}
            className={cn(
              CONTROL_BUTTON_CLASS,
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-violet-500",
            )}
            aria-label={`Zoom to ${Math.round(preset * 100)} percent`}
          >
            <ZoomIn size={12} className="inline mr-1" aria-hidden="true" />
            {Math.round(preset * 100)}%
          </button>
        ))}
        <span
          className={cn(
            "text-[11px]",
            isDark ? "text-slate-500" : "text-gray-500",
          )}
        >
          Shortcuts: Ctrl/Cmd+F search · Ctrl/Cmd+L fit · Ctrl/Cmd+E export PNG
          · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo
        </span>
        <button
          type="button"
          onClick={toggleShowAdvancedControls}
          className={cn(
            CONTROL_BUTTON_CLASS,
            "ml-auto",
            isDark
              ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 focus-visible:ring-violet-400"
              : "bg-white border-gray-300 text-gray-750 hover:bg-gray-50 focus-visible:ring-violet-500",
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
    </>
  );
}
