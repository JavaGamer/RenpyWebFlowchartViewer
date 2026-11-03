import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { DialogueSearchMode } from "../../application/index.ts";
import { CONTROL_INPUT_CLASS } from "../viewerConstants.ts";
import { cn } from "../utils/cn.ts";
import * as Tooltip from "@radix-ui/react-tooltip";

interface SearchControlsProps {
  isDark: boolean;
  searchInput: string;
  setSearchInput: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  dialogueLineSearchEnabled: boolean;
  minDialogue?: number;
  setMinDialogue?: (v: number) => void;
  selectedDialogueSearchMode?: DialogueSearchMode;
  onDialogueSearchModeChange?: (mode: DialogueSearchMode) => void;

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
  selectedSearchChapter,
  setSelectedSearchChapter,
  selectedSearchNodeKinds,
  setSelectedSearchNodeKinds,
  uniqueChapters,
}: SearchControlsProps) {
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const hasActiveFilters = selectedSearchChapter !== "" ||
    !selectedSearchNodeKinds.LABEL || !selectedSearchNodeKinds.MENU ||
    !selectedSearchNodeKinds.DECISION;

  useEffect(() => {
    if (!showSearchFilters) return;

    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setShowSearchFilters(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSearchFilters(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSearchFilters]);

  return (
    <>
      <div
        className="flex items-center gap-1.5 w-full max-w-md"
        role="group"
        aria-label="Search and filters"
      >
        <label
          htmlFor="viewer-search-input"
          className="sr-only"
        >
          Search
        </label>
        <div className="relative flex-1 flex items-center min-w-0">
          <Search
            size={13}
            className={cn(
              "absolute left-2.5 pointer-events-none",
              isDark ? "text-slate-500" : "text-gray-400",
            )}
            aria-hidden="true"
          />
          <input
            id="viewer-search-input"
            ref={searchInputRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (showSearchFilters) {
                  e.preventDefault();
                  setShowSearchFilters(false);
                  return;
                }
                if (searchInput.length > 0) {
                  e.preventDefault();
                  setSearchInput("");
                  return;
                }
              }
              onSearchInputKeyDown(e);
            }}
            placeholder="Search labels, dialogue lines, or dialogue count"
            aria-describedby="viewer-search-help"
            aria-keyshortcuts="Control+F Meta+F"
            className={cn(
              "pl-8 w-full h-7 text-xs rounded border transition-colors",
              searchInput.length > 0 ? "pr-7" : "pr-3",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500 focus-visible:ring-1 focus-visible:ring-violet-400"
                : "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus-visible:ring-1 focus-visible:ring-violet-500",
            )}
          />
          {searchInput.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                searchInputRef.current?.focus();
              }}
              className={cn(
                "absolute right-2 p-0.5 rounded-full transition-colors cursor-pointer",
                isDark
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100",
              )}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              ref={buttonRef}
              type="button"
              onClick={() => setShowSearchFilters(!showSearchFilters)}
              aria-label="Toggle search filters"
              aria-expanded={showSearchFilters}
              className={cn(
                "h-7 w-7 rounded border text-xs flex items-center justify-center shrink-0 cursor-pointer transition-all duration-150 relative",
                showSearchFilters || hasActiveFilters
                  ? isDark
                    ? "bg-violet-950/60 text-violet-300 border-violet-700/80"
                    : "bg-violet-50 text-violet-700 border-violet-200"
                  : isDark
                  ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50",
              )}
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
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
              className="z-50 select-none rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white leading-none shadow-md animate-fade-in"
              sideOffset={5}
            >
              {showSearchFilters
                ? "Hide Search Filters"
                : "Show Search Filters"}
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <span id="viewer-search-help" className="sr-only">
          {dialogueLineSearchEnabled
            ? "Search labels, dialogue lines, or dialogue count."
            : "Search labels or dialogue count."}
        </span>
      </div>

      {/* Collapsible search filters popover */}
      {showSearchFilters && (
        <div
          ref={popoverRef}
          role="region"
          aria-label="Search filter options"
          className={cn(
            "absolute top-full mt-2 left-1/2 -translate-x-1/2 w-[90vw] max-w-xl p-3 rounded-lg border shadow-xl z-50 flex flex-wrap items-center gap-3 text-xs animate-fade-in",
            isDark
              ? "bg-slate-900 border-slate-700 text-slate-200 shadow-slate-950/80"
              : "bg-white border-gray-200 text-gray-800 shadow-gray-400/30",
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
              style={{ colorScheme: isDark ? "dark" : "light" }}
              className={cn(
                CONTROL_INPUT_CLASS,
                "py-1 px-2 text-xs w-[12rem] cursor-pointer disabled:cursor-not-allowed",
                isDark
                  ? "bg-slate-800 border-slate-700 text-slate-100 focus-visible:ring-violet-400"
                  : "bg-white border-gray-300 text-gray-900 focus-visible:ring-violet-500",
              )}
            >
              <option
                value=""
                className={isDark
                  ? "bg-slate-900 text-slate-100"
                  : "bg-white text-gray-900"}
              >
                All Chapters
              </option>
              {uniqueChapters.map((ch) => (
                <option
                  key={ch}
                  value={ch}
                  className={isDark
                    ? "bg-slate-900 text-slate-100"
                    : "bg-white text-gray-900"}
                >
                  {ch}
                </option>
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
                    aria-pressed={isActive}
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
