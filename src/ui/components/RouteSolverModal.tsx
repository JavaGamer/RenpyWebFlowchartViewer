/**
 * src/ui/components/RouteSolverModal.tsx
 *
 * Interactive dialog that solves and displays optimal walkthrough paths to any
 * visual novel story ending or label, allowing one-click canvas highlighting and guide export.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  Award,
  BookOpen,
  Check,
  Compass,
  Copy,
  Download,
  Flag,
  Search,
  Sparkles,
} from "lucide-react";
import {
  downloadWalkthrough,
  exportWalkthroughToMarkdown,
  useAppStore,
  useViewerStore,
} from "../../application/index.ts";
import {
  type HighlightedRoute,
  type RouteSolverHeuristic,
  solveRouteToTarget,
} from "../../domain/index.ts";
import { Modal } from "../primitives/index.ts";
import { cn } from "../utils/cn.ts";

export interface RouteSolverModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTargetNodeId?: string;
  onFocusNode?: (nodeId: string) => void;
}

export function RouteSolverModal({
  isOpen,
  onClose,
  initialTargetNodeId,
  onFocusNode,
}: RouteSolverModalProps) {
  const { flowNodes, flowEdges } = useAppStore(
    useShallow((s) => ({
      flowNodes: s.flowNodes,
      flowEdges: s.flowEdges,
    })),
  );

  const {
    theme,
    readingSpeedWpm,
    setHighlightedRoute,
    setSelectedNodeId,
  } = useViewerStore(
    useShallow((s) => ({
      theme: s.theme,
      readingSpeedWpm: s.readingSpeedWpm,
      setHighlightedRoute: s.setHighlightedRoute,
      setSelectedNodeId: s.setSelectedNodeId,
    })),
  );

  const [targetSearch, setTargetSearch] = useState("");
  const [heuristic, setHeuristic] = useState<RouteSolverHeuristic>(
    "shortest_steps",
  );
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const isDark = theme === "dark";

  // Filter possible target nodes (prefer terminal outcomes, story labels, and decision points)
  const candidateNodes = useMemo(() => {
    return flowNodes.filter((n) => !n.isShadowed && n.type !== "SYNTAX_ERROR");
  }, [flowNodes]);

  const defaultTargetId = useMemo(() => {
    if (initialTargetNodeId) return initialTargetNodeId;
    const firstEnding = candidateNodes.find((n) => n.isTerminalOutcome);
    return firstEnding ? firstEnding.id : (candidateNodes[0]?.id ?? "");
  }, [candidateNodes, initialTargetNodeId]);

  const [prevInitialTarget, setPrevInitialTarget] = useState(
    initialTargetNodeId,
  );
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");

  if (initialTargetNodeId !== prevInitialTarget) {
    setPrevInitialTarget(initialTargetNodeId);
    setSelectedTargetId(initialTargetNodeId || "");
  }

  const effectiveTargetId = selectedTargetId || defaultTargetId;

  const filteredCandidates = useMemo(() => {
    if (!targetSearch.trim()) return candidateNodes;
    const q = targetSearch.toLowerCase();
    return candidateNodes.filter(
      (n) =>
        n.id.toLowerCase().includes(q) ||
        n.label.toLowerCase().includes(q) ||
        (n.chapter && n.chapter.toLowerCase().includes(q)),
    );
  }, [candidateNodes, targetSearch]);

  // Solve route
  const solved = useMemo(() => {
    if (!effectiveTargetId || flowNodes.length === 0) return null;
    return solveRouteToTarget(flowNodes, flowEdges, {
      targetNodeId: effectiveTargetId,
      heuristic,
      readingSpeedWpm,
    });
  }, [flowNodes, flowEdges, effectiveTargetId, heuristic, readingSpeedWpm]);

  const handleHighlightOnCanvas = () => {
    if (!solved || !solved.isReachable) return;

    const highlighted: HighlightedRoute = {
      routeId: `solved_${solved.targetNodeId}`,
      name: `Solved Route to ${solved.targetLabel}`,
      endingLabel: solved.targetLabel,
      nodeIds: solved.nodeIds,
      edgeIds: solved.edgeIds,
      formattedReadingTime: solved.formattedReadingTime,
      totalWords: solved.totalWordCount,
      stepOrderMap: Object.fromEntries(
        solved.nodeIds.map((id, idx) => [id, idx + 1]),
      ),
    };

    setHighlightedRoute(highlighted);
    if (solved.nodeIds.length > 0) {
      setSelectedNodeId(solved.nodeIds[0]!);
      onFocusNode?.(solved.nodeIds[0]!);
    }
    onClose();
  };

  const handleCopyMarkdown = () => {
    if (!solved) return;
    const md = exportWalkthroughToMarkdown(solved);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(md)
        .then(() => {
          setCopied(true);
          if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
          copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
        })
        .catch((err) => {
          console.error("Failed to copy walkthrough to clipboard:", err);
        });
    }
  };

  const flagEntries = solved ? Object.entries(solved.flagsNeeded) : [];

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Automated Route Solver & Walkthrough Generator"
      isDark={isDark}
    >
      <div className="space-y-5 text-slate-800 dark:text-slate-200">
        {/* Top Controls: Target Selection & Heuristics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60">
          {/* Target Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="target-ending-select"
              className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5"
            >
              <Compass size={14} className="text-violet-500" />
              Target Ending or Label
            </label>
            <div className="relative">
              <input
                type="search"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                placeholder="Search endings and labels..."
                aria-label="Search endings and labels"
                className="w-full text-xs pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-visible:ring-2 focus-visible:ring-violet-500"
              />
              <Search
                size={13}
                className="absolute left-2 top-2 text-slate-400"
              />
            </div>
            <select
              id="target-ending-select"
              value={effectiveTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {filteredCandidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.isTerminalOutcome ? "🏆 " : "• "}
                  {n.label} {n.chapter ? `(${n.chapter})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Heuristic Picker */}
          <div className="space-y-1.5">
            <div
              id="heuristic-picker-label"
              className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5"
            >
              <Sparkles size={14} className="text-amber-500" />
              Path Optimization Strategy
            </div>

            <div
              role="radiogroup"
              aria-labelledby="heuristic-picker-label"
              className="grid grid-cols-3 gap-1.5 pt-1"
            >
              <button
                type="button"
                role="radio"
                aria-checked={heuristic === "shortest_steps"}
                onClick={() => setHeuristic("shortest_steps")}
                className={cn(
                  "px-2 py-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer",
                  heuristic === "shortest_steps"
                    ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                    : isDark
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                Shortest
                <span className="block text-[10px] opacity-80">
                  Fewest Steps
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={heuristic === "least_choices"}
                onClick={() => setHeuristic("least_choices")}
                className={cn(
                  "px-2 py-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer",
                  heuristic === "least_choices"
                    ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                    : isDark
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                Direct
                <span className="block text-[10px] opacity-80">
                  Fewest Choices
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={heuristic === "max_dialogue"}
                onClick={() => setHeuristic("max_dialogue")}
                className={cn(
                  "px-2 py-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer",
                  heuristic === "max_dialogue"
                    ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                    : isDark
                    ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                Deep Story
                <span className="block text-[10px] opacity-80">Most Words</span>
              </button>
            </div>
          </div>
        </div>

        {/* Results Area */}
        {solved && solved.isReachable
          ? (
            <div className="space-y-4">
              {/* Metric Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Total Steps
                  </span>
                  <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100">
                    {solved.totalSteps} nodes
                  </span>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Key Choices
                  </span>
                  <span className="text-base font-bold font-mono text-violet-600 dark:text-violet-400">
                    {solved.totalChoices} decisions
                  </span>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Reading Time
                  </span>
                  <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100">
                    {solved.formattedReadingTime}
                  </span>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Story Volume
                  </span>
                  <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100">
                    ~{solved.totalWordCount.toLocaleString()} words
                  </span>
                </div>
              </div>

              {/* Required Condition Flags */}
              {flagEntries.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300 mb-1.5">
                    <Flag size={13} />
                    <span>Required Condition Flags ({flagEntries.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {flagEntries.map(([k, v]) => (
                      <span
                        key={k}
                        className="px-2 py-0.5 rounded font-mono text-[11px] bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 shadow-2xs"
                      >
                        <strong>{k}</strong>: {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Step-by-Step Checklist */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Sequential Decision Steps
                </h4>
                <div className="border rounded-xl divide-y divide-slate-200 dark:divide-slate-800 max-h-60 overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                  {solved.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 text-xs flex items-start gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        #{step.stepIndex}
                      </span>
                      <div className="flex-1 min-w-0">
                        {step.type === "start" && (
                          <div className="font-semibold text-slate-700 dark:text-slate-300">
                            Start game at{" "}
                            <span className="font-mono">{step.nodeLabel}</span>
                          </div>
                        )}
                        {step.type === "choice" && (
                          <div>
                            <span className="text-slate-500">
                              Choice at {step.menuLabel}:
                            </span>
                            <strong className="text-violet-600 dark:text-violet-400">
                              "{step.choiceText ?? "Select option"}"
                            </strong>
                            <span className="text-slate-400 block text-[11px]">
                              → jumps to {step.nodeLabel}
                            </span>
                          </div>
                        )}
                        {step.type === "decision_branch" && (
                          <div>
                            <span className="text-slate-500">
                              Condition branch:
                            </span>
                            <code className="text-amber-600 dark:text-amber-400 font-bold">
                              {step.conditionExpression}
                            </code>
                          </div>
                        )}
                        {step.type === "call" && (
                          <div className="text-slate-600 dark:text-slate-300">
                            Call subroutine{" "}
                            <span className="font-mono">{step.nodeLabel}</span>
                          </div>
                        )}
                        {step.type === "call_return" && (
                          <div className="text-slate-600 dark:text-slate-300">
                            Return to caller{" "}
                            <span className="font-mono">{step.nodeLabel}</span>
                          </div>
                        )}
                        {step.type === "label" && (
                          <div className="text-slate-500 font-mono text-[11px]">
                            Advance to {step.nodeLabel}
                          </div>
                        )}
                        {(step.type === "ending" ||
                          step.nodeId === solved.targetNodeId) && (
                          <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <Award size={13} />
                            Reach Outcome: {step.nodeLabel}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleHighlightOnCanvas}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white transition-colors cursor-pointer shadow-sm focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    <Compass size={14} />
                    Highlight on Flowchart
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyMarkdown}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    {copied
                      ? <Check size={13} className="text-emerald-500" />
                      : <Copy size={13} />}
                    <span>{copied ? "Copied" : "Copy Guide"}</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => downloadWalkthrough(solved, "markdown")}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500"
                    title="Download Markdown Walkthrough"
                  >
                    <Download size={13} />
                    <span>.md</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadWalkthrough(solved, "steam")}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500"
                    title="Download Steam Guide BBCode"
                  >
                    <BookOpen size={13} />
                    <span>Steam</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadWalkthrough(solved, "text")}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-violet-500"
                    title="Download Plain Text Walkthrough"
                  >
                    <Download size={13} />
                    <span>Text</span>
                  </button>
                </div>
              </div>
            </div>
          )
          : (
            <div className="p-6 text-center border rounded-xl border-dashed border-slate-200 dark:border-slate-800 text-slate-500">
              No valid route path found from entry points to{" "}
              <code className="font-mono font-bold text-slate-700 dark:text-slate-300">
                {effectiveTargetId}
              </code>
              . It may be an unreachable orphan node.
            </div>
          )}
      </div>
    </Modal>
  );
}
