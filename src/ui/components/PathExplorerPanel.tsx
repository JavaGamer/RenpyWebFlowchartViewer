import { cn } from "../utils/cn.ts";
import type {
  CanvasEdge,
  CanvasNode,
  NodeData,
  PathResult,
} from "../../domain/index.ts";
import { AlertCircle, Route, X } from "lucide-react";

interface PathExplorerPanelProps {
  pathResult: PathResult | null;
  pathStartNodeId: string | null;
  pathTargetNodeId: string | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  onClearPath: () => void;
  onSelectNode: (nodeId: string) => void;
  isDark: boolean;
}

export function PathExplorerPanel({
  pathResult,
  pathStartNodeId,
  pathTargetNodeId,
  nodes,
  onClearPath,
  onSelectNode,
  isDark,
}: PathExplorerPanelProps) {
  if (!pathStartNodeId && !pathTargetNodeId) {
    return null;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const startNode = pathStartNodeId ? nodeMap.get(pathStartNodeId) : null;
  const targetNode = pathTargetNodeId ? nodeMap.get(pathTargetNodeId) : null;

  return (
    <div
      className={cn(
        "flex flex-col border-t mt-4 pt-4 transition-colors",
        isDark ? "border-slate-800" : "border-gray-200",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Route
            size={16}
            className={isDark ? "text-violet-400" : "text-violet-600"}
          />
          Path Explorer
        </div>
        <button
          onClick={onClearPath}
          className={cn(
            "p-1 rounded hover:bg-black/5 transition-colors",
            isDark && "hover:bg-white/10 text-slate-400 hover:text-slate-200",
          )}
          title="Clear Path"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2 mb-4 text-xs">
        <div className="flex items-start gap-2">
          <div className="w-12 text-gray-500 font-semibold shrink-0">
            Start:
          </div>
          <div
            className="font-mono truncate"
            title={startNode
              ? (startNode.data as NodeData).label
              : pathStartNodeId ?? ""}
          >
            {startNode
              ? (startNode.data as NodeData).label
              : (pathStartNodeId || "Not selected")}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="w-12 text-gray-500 font-semibold shrink-0">
            Target:
          </div>
          <div
            className="font-mono truncate"
            title={targetNode
              ? (targetNode.data as NodeData).label
              : pathTargetNodeId ?? ""}
          >
            {targetNode
              ? (targetNode.data as NodeData).label
              : (pathTargetNodeId || "Not selected")}
          </div>
        </div>
      </div>

      {!pathStartNodeId || !pathTargetNodeId
        ? (
          <div
            className={cn(
              "text-xs p-3 rounded text-center italic",
              isDark
                ? "bg-slate-800/50 text-slate-400"
                : "bg-gray-50 text-gray-500",
            )}
          >
            Select both a start and target node to find a path.
          </div>
        )
        : !pathResult || !pathResult.reachable
        ? (
          <div
            className={cn(
              "text-xs p-3 rounded flex items-start gap-2",
              isDark
                ? "bg-amber-950/40 text-amber-200 border border-amber-900/50"
                : "bg-amber-50 text-amber-800 border border-amber-200",
            )}
          >
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <div>
              No path found between these nodes. They may be in disconnected
              parts of the graph, or conditions may prevent reaching the target.
            </div>
          </div>
        )
        : (
          <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0 max-h-[30vh]">
            <div className="text-[11px] font-semibold text-gray-500 mb-2">
              {pathResult.pathEdges.length} steps
            </div>
            <div className="space-y-3 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
              {pathResult.pathNodes.map((nodeId, index) => {
                const n = nodeMap.get(nodeId);
                const label = n ? (n.data as NodeData).label : nodeId;
                const isStart = index === 0;
                const isEnd = index === pathResult.pathNodes.length - 1;

                return (
                  <div
                    key={`${nodeId}-${index}`}
                    className="relative flex items-start gap-3"
                  >
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 z-10",
                        isStart
                          ? (isDark
                            ? "bg-emerald-950 border-emerald-500 text-emerald-400"
                            : "bg-emerald-50 border-emerald-500 text-emerald-600")
                          : isEnd
                          ? (isDark
                            ? "bg-rose-950 border-rose-500 text-rose-400"
                            : "bg-rose-50 border-rose-500 text-rose-600")
                          : (isDark
                            ? "bg-slate-900 border-slate-600 text-slate-400"
                            : "bg-white border-gray-300 text-gray-500"),
                      )}
                    >
                      {isStart ? "S" : isEnd ? "T" : index}
                    </div>
                    <button
                      onClick={() => onSelectNode(nodeId)}
                      className={cn(
                        "text-xs p-2 rounded text-left border flex-1 transition-colors group hover:shadow-sm",
                        isDark
                          ? "bg-slate-800/50 border-slate-700 hover:bg-slate-800 hover:border-slate-600 text-slate-200"
                          : "bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-800",
                      )}
                    >
                      <div className="font-mono break-all">{label}</div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );
}
