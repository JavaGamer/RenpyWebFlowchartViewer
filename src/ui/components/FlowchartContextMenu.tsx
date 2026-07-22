import React from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  Focus,
  Play,
  Target,
  Copy,
  Filter,
  Maximize2,
  RotateCcw,
  LayoutGrid,
} from 'lucide-react';
import type { NodeData } from '../../domain/index.ts';

export interface FlowchartContextMenuProps {
  children: React.ReactNode;
  nodeData?: NodeData;
  nodeId?: string;
  onOpenChange?: (open: boolean) => void;
  onFocusNode?: (nodeId: string) => void;
  onSetPathStart?: (nodeId: string) => void;
  onSetPathTarget?: (nodeId: string) => void;
  onCopyScriptPath?: (nodeData: NodeData, nodeId: string) => void;
  onFilterSubgraph?: (chapter: string) => void;
  onFitView?: () => void;
  onToggleLayoutDir?: () => void;
  onResetSession?: () => void;
}

export const FlowchartContextMenu: React.FC<FlowchartContextMenuProps> = ({
  children,
  nodeData,
  nodeId,
  onOpenChange,
  onFocusNode,
  onSetPathStart,
  onSetPathTarget,
  onCopyScriptPath,
  onFilterSubgraph,
  onFitView,
  onToggleLayoutDir,
  onResetSession,
}) => {
  const currentId = nodeId || '';

  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label="Flowchart context menu"
          className="z-50 min-w-[200px] overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-md text-slate-200 text-xs animate-in fade-in-80 duration-150"
        >
          {nodeData && currentId ? (
            /* Context menu options when right-clicking a Node */
            <>
              <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase truncate max-w-[240px]">
                Node: {nodeData.label || 'Unnamed Label'}
              </div>
              <ContextMenu.Separator className="my-1 h-px bg-slate-800" />
              
              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300 outline-none transition-colors"
                onSelect={() => onFocusNode?.(currentId)}
              >
                <Focus className="h-3.5 w-3.5 text-cyan-400" />
                <span>Center & Focus Node</span>
              </ContextMenu.Item>

              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-emerald-500/20 hover:text-emerald-300 outline-none transition-colors"
                onSelect={() => onSetPathStart?.(currentId)}
              >
                <Play className="h-3.5 w-3.5 text-emerald-400" />
                <span>Set as Path Start</span>
              </ContextMenu.Item>

              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-amber-500/20 hover:text-amber-300 outline-none transition-colors"
                onSelect={() => onSetPathTarget?.(currentId)}
              >
                <Target className="h-3.5 w-3.5 text-amber-400" />
                <span>Set as Path Target</span>
              </ContextMenu.Item>

              <ContextMenu.Separator className="my-1 h-px bg-slate-800" />

              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-slate-800 hover:text-slate-100 outline-none transition-colors"
                onSelect={() => onCopyScriptPath?.(nodeData, currentId)}
              >
                <Copy className="h-3.5 w-3.5 text-slate-400" />
                <span>Copy Script File & Line</span>
              </ContextMenu.Item>

              {nodeData.chapter && (
                <ContextMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-purple-500/20 hover:text-purple-300 outline-none transition-colors"
                  onSelect={() => onFilterSubgraph?.(nodeData.chapter!)}
                >
                  <Filter className="h-3.5 w-3.5 text-purple-400" />
                  <span>Filter Chapter Subgraph</span>
                </ContextMenu.Item>
              )}
            </>
          ) : (
            /* Context menu options when right-clicking Canvas Background */
            <>
              <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Canvas Controls
              </div>
              <ContextMenu.Separator className="my-1 h-px bg-slate-800" />

              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300 outline-none transition-colors"
                onSelect={() => onFitView?.()}
              >
                <Maximize2 className="h-3.5 w-3.5 text-cyan-400" />
                <span>Fit Graph to Screen</span>
              </ContextMenu.Item>

              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-slate-800 hover:text-slate-100 outline-none transition-colors"
                onSelect={() => onToggleLayoutDir?.()}
              >
                <LayoutGrid className="h-3.5 w-3.5 text-indigo-400" />
                <span>Toggle Layout (TB / LR)</span>
              </ContextMenu.Item>

              <ContextMenu.Separator className="my-1 h-px bg-slate-800" />

              <ContextMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 outline-none transition-colors"
                onSelect={() => onResetSession?.()}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Viewer Session</span>
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};
