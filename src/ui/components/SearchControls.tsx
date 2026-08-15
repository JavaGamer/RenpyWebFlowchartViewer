import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { DialogueSearchMode } from "../../application/index.ts";
import {
  CONTROL_BUTTON_CLASS,
  CONTROL_INPUT_CLASS,
} from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";
import * as Tooltip from "@radix-ui/react-tooltip";

interface SearchControlsProps {
  isDark: boolean;
  searchInput: string;
  setSearchInput: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  dialogueLineSearchEnabled: boolean;
  minDialogue: number;
  setMinDialogue: (v: number) => void;
  selectedDialogueSearchMode: DialogueSearchMode;
  onDialogueSearchModeChange: (mode: DialogueSearchMode) => void;

  selectedSearchChapter: string;
  setSelectedSearchChapter: (chapter: string) => void;
  selectedSearchNodeKinds: Record<"LABEL" | "MENU" | "DECISION", boolean>;
  setSelectedSearchNodeKinds: (
    kinds: Record<"LABEL" | "MENU" | "DECISION", boolean>,
  ) => void;
  uniqueChapters: string[];
}

export function SearchControls({
  isDark,
  searchInput,
  setSearchInput,
  searchInputRef,
  onSearchInputKeyDown,
  dialogueLineSearchEnabled,
  minDialogue,
  setMinDialogue,
  selectedDialogueSearchMode,
  onDialogueSearchModeChange,
  selectedSearchChapter,
  setSelectedSearchChapter,
  selectedSearchNodeKinds,
  setSelectedSearchNodeKinds,
  uniqueChapters,
}: SearchControlsProps) {
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const hasActiveFilters = selectedSearchChapter !== "" ||
    !selectedSearchNodeKinds.LABEL || !selectedSearchNodeKinds.MENU ||
    !selectedSearchNodeKinds.DECISION;

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 grow"
        role="group"
        aria-label="Search and filters"
      >
        <label
          htmlFor="viewer-search-input"
          className={cn(
            "text-xs font-medium",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
        >
          Search
        </label>
        <div className="relative flex items-center min-w-[12rem] grow sm:grow-0 gap-1.5">
          <div className="relative flex items-center grow">
            <Search
              size={14}
              className={cn(
                "absolute left-2",
                isDark ? "text-slate-500" : "text-gray-400",
              )}
              aria-hidden="true"
            />
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
                CONTROL_INPUT_CLASS,
                "pl-8 pr-2 w-full sm:w-[16rem] max-w-[90vw]",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
              )}
            />
          </div>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
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
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                    : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50",
                )}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                {hasActiveFilters && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75">
                    </span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-500">
                    </span>
                  </span>
                )}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in animate-duration-150"
                sideOffset={5}
              >
                {showSearchFilters
                  ? "Hide Search Filters"
                  : "Show Search Filters"}
                <Tooltip.Arrow className="fill-gray-900" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
        <span id="viewer-search-help" className="sr-only">
          {dialogueLineSearchEnabled
            ? "Search labels, dialogue lines, or dialogue count."
            : "Search labels or dialogue count."}
        </span>
        <label
          className={cn(
            "text-xs flex items-center gap-1",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
          htmlFor="min-dialogue-input"
        >
          Minimum dialogue lines
          <input
            id="min-dialogue-input"
            type="number"
            min={0}
            value={minDialogue}
            onChange={(e) =>
              setMinDialogue(Math.max(0, Number(e.target.value) || 0))}
            aria-label="Minimum dialogue lines"
            className={cn(
              "w-16",
              CONTROL_INPUT_CLASS,
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
            )}
          />
        </label>
        <label
          className={cn(
            "text-xs flex items-center gap-1",
            isDark ? "text-slate-300" : "text-gray-700",
          )}
          htmlFor="dialogue-search-mode-input"
        >
          Dialogue search mode
          <select
            id="dialogue-search-mode-input"
            value={selectedDialogueSearchMode}
            onChange={(e) =>
              onDialogueSearchModeChange(
                e.target.value as DialogueSearchMode,
              )}
            aria-label="Dialogue search mode"
            className={cn(
              CONTROL_INPUT_CLASS,
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
            )}
          >
            <option value="auto">Auto (faster on large imports)</option>
            <option value="full">Full dialogue line search</option>
            <option value="countOnly">
              Performance mode (label/count only)
            </option>
          </select>
        </label>
        {!dialogueLineSearchEnabled && (
          <span
            className={cn(
              "text-[11px] border rounded px-2 py-1",
              isDark
                ? "text-amber-400 bg-amber-950/40 border-amber-900/60"
                : "text-amber-700 bg-amber-50 border border-amber-200",
            )}
          >
            Dialogue line search is disabled in performance mode.
          </span>
        )}
      </div>

      {/* Collapsible search filters */}
      {showSearchFilters && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-4 p-3 rounded-lg border text-sm transition-all duration-200 animate-fade-in animate-duration-150 w-full",
            isDark
              ? "bg-slate-950/40 border-slate-800 text-slate-200"
              : "bg-gray-50 border-gray-200 text-gray-700",
          )}
        >
          {/* Chapter select */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="chapter-scope-select"
              className={cn(
                "text-xs font-bold uppercase tracking-wider",
                isDark ? "text-slate-500" : "text-gray-400",
              )}
            >
              Chapter Scope:
            </label>
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
                  : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
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
            <span
              className={cn(
                "text-xs font-bold uppercase tracking-wider",
                isDark ? "text-slate-500" : "text-gray-400",
              )}
            >
              Match Node Kinds:
            </span>
            <div
              className="flex items-center gap-1.5"
              role="group"
              aria-label="Search node types"
            >
              {(["LABEL", "MENU", "DECISION"] as const).map((kind) => {
                const isActive = selectedSearchNodeKinds[kind];
                const labelMap = {
                  LABEL: "Labels",
                  MENU: "Menus",
                  DECISION: "Decisions",
                };
                const activeClassMap = {
                  LABEL: isDark
                    ? "bg-violet-950/80 text-violet-300 border-violet-700"
                    : "bg-violet-100 text-violet-800 border-violet-300",
                  MENU: isDark
                    ? "bg-amber-950/80 text-amber-300 border-amber-700"
                    : "bg-amber-100 text-amber-800 border-amber-300",
                  DECISION: isDark
                    ? "bg-emerald-950/80 text-emerald-300 border-emerald-700"
                    : "bg-emerald-100 text-emerald-800 border-emerald-300",
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
                        ? "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700"
                        : "bg-white border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300",
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
                setSelectedSearchNodeKinds({
                  LABEL: true,
                  MENU: true,
                  DECISION: true,
                });
              }}
              className={cn(
                "ml-auto text-xs font-semibold px-2 py-1 rounded transition-colors duration-150 cursor-pointer",
                isDark
                  ? "text-rose-400 hover:bg-rose-950/30"
                  : "text-rose-600 hover:bg-rose-50",
              )}
            >
              Reset Filters
            </button>
          )}
        </div>
      )}
    </>
  );
}
