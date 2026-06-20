import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useViewerStore } from "../../application/index.ts";
import { useShallow } from "zustand/react/shallow";
import { cn } from "../utils/cn.ts";
import { ViewerAdvancedControls } from "../ViewerAdvancedControls.tsx";
import type { CanvasNode } from "../../domain/index.ts";

interface AdvancedControlsModalProps {
  relayout: () => void;
  focusTargetNode: CanvasNode | undefined;
  onFocusSelectedNode: () => void;
  largeGraphMode: boolean;
  largeGraphModeStatusText: string;
  labels: string[];
  chapters: string[];
  collapsedLabelCount: number;
  visibleSubgraphLabels: string[];
  visibleLabelSubgraphToggles: string[];
  shouldShowAllLabelSubgraphToggles: boolean;
  setAllVisibleSubgraphLabelsCollapsed: (collapsed: boolean) => void;
  discoveredFlags: string[];
}

export function AdvancedControlsModal({
  relayout,
  focusTargetNode,
  onFocusSelectedNode,
  largeGraphMode,
  largeGraphModeStatusText,
  labels,
  chapters,
  collapsedLabelCount,
  visibleSubgraphLabels,
  visibleLabelSubgraphToggles,
  shouldShowAllLabelSubgraphToggles,
  setAllVisibleSubgraphLabelsCollapsed,
  discoveredFlags,
}: AdvancedControlsModalProps) {
  const { showAdvancedControls, setShowAdvancedControls, theme } =
    useViewerStore(
      useShallow((s) => ({
        showAdvancedControls: s.showAdvancedControls,
        setShowAdvancedControls: s.setShowAdvancedControls,
        theme: s.theme,
      })),
    );
  const isDark = theme === "dark";

  return (
    <Dialog.Root
      open={showAdvancedControls}
      onOpenChange={setShowAdvancedControls}
      modal={false}
    >
      <Dialog.Portal>
        {/* Radix does not render Dialog.Overlay in non-modal mode — use a plain div instead */}
        <div
          className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 animate-fade-in"
          aria-hidden="true"
        />
        <Dialog.Content
          className={cn(
            "fixed right-0 top-0 bottom-0 w-full max-w-md shadow-2xl z-50 flex flex-col focus:outline-none animate-slide-in transition-colors duration-200",
            isDark
              ? "bg-slate-900 border-l border-slate-800 text-slate-100"
              : "bg-white text-gray-900",
          )}
          aria-modal="true"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div
            className={cn(
              "flex items-center justify-between px-6 py-4 border-b shrink-0 transition-colors duration-200",
              isDark
                ? "border-slate-800 bg-slate-850"
                : "border-gray-100 bg-gray-50/50",
            )}
          >
            <div>
              <Dialog.Title
                className={cn(
                  "text-base font-semibold",
                  isDark ? "text-slate-100" : "text-gray-900",
                )}
              >
                Advanced Settings
              </Dialog.Title>
              <Dialog.Description
                className={cn(
                  "text-xs mt-0.5",
                  isDark ? "text-slate-400" : "text-gray-500",
                )}
              >
                Configure graph layouts, filters, themes, and path simulations.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  "rounded-full p-1.5 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500",
                  isDark
                    ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    : "text-gray-400 hover:bg-gray-100 hover:text-gray-700",
                )}
                aria-label="Close advanced controls"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </Dialog.Close>
          </div>
          <div
            className={cn(
              "flex-1 overflow-y-auto px-6 py-4",
              isDark ? "bg-slate-900" : "bg-white",
            )}
          >
            <ViewerAdvancedControls
              onRelayout={relayout}
              focusTargetNode={focusTargetNode}
              onFocusSelectedNode={onFocusSelectedNode}
              largeGraphMode={largeGraphMode}
              largeGraphModeStatusText={largeGraphModeStatusText}
              labels={labels}
              chapters={chapters}
              collapsedLabelCount={collapsedLabelCount}
              visibleSubgraphLabels={visibleSubgraphLabels}
              visibleLabelSubgraphToggles={visibleLabelSubgraphToggles}
              shouldShowAllLabelSubgraphToggles={shouldShowAllLabelSubgraphToggles}
              setAllVisibleSubgraphLabelsCollapsed={setAllVisibleSubgraphLabelsCollapsed}
              discoveredFlags={discoveredFlags}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
