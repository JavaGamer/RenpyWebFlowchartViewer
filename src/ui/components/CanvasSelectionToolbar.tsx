/**
 * src/ui/components/CanvasSelectionToolbar.tsx
 *
 * Floating contextual action bar rendered over the React Flow canvas
 * when 2 or more nodes are selected or when an isolated subgraph view is active.
 */

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowDownRight,
  ArrowUpLeft,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Layers,
  X,
} from "lucide-react";
import { useAppStore, useViewerStore } from "../../application/index.ts";
import type { FlowEdge } from "../../domain/index.ts";
import { cn } from "../utils/cn.ts";
import saveAs from "file-saver";

export interface CanvasSelectionToolbarProps {
  flowEdges: FlowEdge[];
}

export function CanvasSelectionToolbar({
  flowEdges,
}: CanvasSelectionToolbarProps) {
  const {
    selectedNodeIds,
    isolatedSubgraphNodeIds,
    theme,
    setSelectedNodeIds,
    setIsolatedSubgraphNodeIds,
    clearMultiSelection,
  } = useViewerStore(
    useShallow((s) => ({
      selectedNodeIds: s.selectedNodeIds,
      isolatedSubgraphNodeIds: s.isolatedSubgraphNodeIds,
      theme: s.theme,
      setSelectedNodeIds: s.setSelectedNodeIds,
      setIsolatedSubgraphNodeIds: s.setIsolatedSubgraphNodeIds,
      clearMultiSelection: s.clearMultiSelection,
    })),
  );

  const flowNodes = useAppStore((s) => s.flowNodes);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark = theme === "dark";

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearMultiSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearMultiSelection]);

  const hasSelection = selectedNodeIds.length >= 2;
  const isIsolated = Boolean(
    isolatedSubgraphNodeIds && isolatedSubgraphNodeIds.length > 0,
  );

  if (!hasSelection && !isIsolated) {
    return null;
  }

  const handleIsolate = () => {
    if (isIsolated) {
      setIsolatedSubgraphNodeIds(null);
    } else {
      setIsolatedSubgraphNodeIds([...selectedNodeIds]);
    }
  };

  const handleCopyLabels = () => {
    const selectedSet = new Set(selectedNodeIds);
    const selectedNodes = flowNodes.filter((n) => selectedSet.has(n.id));
    const labelsText = selectedNodes.map((n) => n.label || n.id).join("\n");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(labelsText)
        .then(() => {
          setCopied(true);
          if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
          copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
        })
        .catch((err) => {
          console.error("Failed to copy labels to clipboard:", err);
        });
    }
  };

  const handleSelectDownstream = () => {
    const reachable = new Set<string>(selectedNodeIds);
    const queue = [...selectedNodeIds];
    const outgoingMap = new Map<string, string[]>();

    for (const e of flowEdges) {
      let list = outgoingMap.get(e.source);
      if (!list) {
        list = [];
        outgoingMap.set(e.source, list);
      }
      list.push(e.target);
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const targets = outgoingMap.get(curr) ?? [];
      for (const t of targets) {
        if (!reachable.has(t)) {
          reachable.add(t);
          queue.push(t);
        }
      }
    }

    setSelectedNodeIds(Array.from(reachable));
  };

  const handleSelectUpstream = () => {
    const reachable = new Set<string>(selectedNodeIds);
    const queue = [...selectedNodeIds];
    const incomingMap = new Map<string, string[]>();

    for (const e of flowEdges) {
      let list = incomingMap.get(e.target);
      if (!list) {
        list = [];
        incomingMap.set(e.target, list);
      }
      list.push(e.source);
    }

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const sources = incomingMap.get(curr) ?? [];
      for (const s of sources) {
        if (!reachable.has(s)) {
          reachable.add(s);
          queue.push(s);
        }
      }
    }

    setSelectedNodeIds(Array.from(reachable));
  };

  const handleExportSelectionJson = () => {
    const selectedSet = new Set(selectedNodeIds);
    const selectedNodes = flowNodes.filter((n) => selectedSet.has(n.id));
    const internalEdges = flowEdges.filter(
      (e) => selectedSet.has(e.source) && selectedSet.has(e.target),
    );

    const data = JSON.stringify(
      { nodes: selectedNodes, edges: internalEdges },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    saveAs(blob, "subgraph_selection.json");
  };

  return (
    <aside
      aria-label="Canvas selection actions"
      className={cn(
        "absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center gap-2 sm:gap-3 px-3.5 py-2 rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-200 animate-fade-in",
        isDark
          ? "bg-slate-900/95 border-violet-700/60 text-slate-100 shadow-violet-950/50"
          : "bg-white/95 border-violet-300 text-gray-900 shadow-violet-500/15",
      )}
    >
      <div className="flex items-center gap-1.5 border-r pr-2.5 border-slate-200 dark:border-slate-700">
        <Layers size={14} className="text-violet-500" />
        <span className="text-xs font-bold font-mono">
          {isIsolated
            ? `Isolated (${isolatedSubgraphNodeIds?.length ?? 0} nodes)`
            : `${selectedNodeIds.length} Selected`}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {/* Isolate / Exit Isolation */}
        <button
          type="button"
          onClick={handleIsolate}
          className={cn(
            "flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
            isIsolated
              ? isDark
                ? "bg-amber-950/60 border-amber-700 text-amber-300 hover:bg-amber-900/80"
                : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
              : isDark
              ? "bg-violet-950/60 border-violet-800 text-violet-300 hover:bg-violet-900/80"
              : "bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100",
          )}
          title={isIsolated
            ? "Exit Subgraph Isolation"
            : "Isolate Selected Subgraph"}
        >
          {isIsolated ? <EyeOff size={13} /> : <Eye size={13} />}
          <span>{isIsolated ? "Exit Isolation" : "Isolate"}</span>
        </button>

        {/* Downstream expansion */}
        {!isIsolated && (
          <button
            type="button"
            onClick={handleSelectDownstream}
            className={cn(
              "flex items-center gap-1 text-xs px-2 py-1 rounded-lg border font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100",
            )}
            title="Select all downstream reachable nodes"
          >
            <ArrowDownRight size={13} />
            <span className="hidden sm:inline">+ Downstream</span>
          </button>
        )}

        {/* Upstream expansion */}
        {!isIsolated && (
          <button
            type="button"
            onClick={handleSelectUpstream}
            className={cn(
              "flex items-center gap-1 text-xs px-2 py-1 rounded-lg border font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              isDark
                ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100",
            )}
            title="Select all upstream predecessor nodes"
          >
            <ArrowUpLeft size={13} />
            <span className="hidden sm:inline">+ Upstream</span>
          </button>
        )}

        {/* Copy labels */}
        <button
          type="button"
          onClick={handleCopyLabels}
          className={cn(
            "flex items-center gap-1 text-xs px-2 py-1 rounded-lg border font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
            isDark
              ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100",
          )}
          title="Copy selected label names to clipboard"
        >
          {copied
            ? <Check size={13} className="text-emerald-500" />
            : <Copy size={13} />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
        </button>

        {/* Export JSON */}
        <button
          type="button"
          onClick={handleExportSelectionJson}
          className={cn(
            "flex items-center gap-1 text-xs px-2 py-1 rounded-lg border font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
            isDark
              ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100",
          )}
          title="Download selected subgraph as JSON"
        >
          <Download size={13} />
          <span className="hidden sm:inline">Export</span>
        </button>

        {/* Clear selection */}
        <button
          type="button"
          onClick={clearMultiSelection}
          className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 cursor-pointer"
          aria-label="Clear selection (Esc)"
          title="Clear selection (Esc)"
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}
