import { memo, useCallback } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  CHAPTER_SUMMARY_HEIGHT,
  type ChapterNodeType,
  type DecisionNodeType,
  getNodeHeight,
  type LabelNodeType,
  type MenuNodeType,
  NODE_HEIGHT_DECISION,
  NODE_HEIGHT_MENU,
} from "../domain/index.ts";
import { THEMES } from "./viewerTheme.ts";
import { useViewerStore } from "../application/index.ts";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FolderArchive,
  Image as ImageIcon,
  Mic as MicIcon,
  Music as MusicIcon,
  Sparkles,
  Volume2 as Volume2Icon,
} from "lucide-react";
import { cn } from "./utils/cn.ts";
import { renderHighlightedText } from "./viewerText.tsx";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "./utils/readingTime.ts";
import { useIsLodMode } from "./hooks/useLodMode.ts";
import { useViewerPresentation } from "./viewerContext.tsx";

function getTheme(themeName: unknown) {
  if (typeof themeName === "string" && themeName in THEMES) {
    return THEMES[themeName as keyof typeof THEMES];
  }
  return THEMES.violet;
}

export const LabelNodeComponent = memo(
  function LabelNodeComponent({ data }: NodeProps<LabelNodeType>) {
    const {
      searchInput,
      readingSpeedWpm,
      layoutDirection,
      showAudioAssetCues,
      showPacingHeatmap,
    } = useViewerPresentation();
    const themeName = data.theme ?? "violet";
    const theme = getTheme(themeName);
    const isDark = themeName === "dark";
    const isShadowed = data.isShadowed === true;
    const isOrphan = data.isOrphan === true;
    const isTerminalOutcome = data.isTerminalOutcome === true;

    const cues = data.audioAssetCues ?? [];
    const sceneCues = cues.filter((c) =>
      c.type === "scene" || c.type === "show" || c.type === "image"
    );
    const playMusicCues = cues.filter((c) =>
      c.type === "play" && c.channel === "music"
    );
    const soundCues = cues.filter((c) =>
      (c.type === "play" || c.type === "queue" || c.type === "stop") &&
      c.channel !== "music" && c.channel !== "voice"
    );
    const voiceCues = cues.filter((c) =>
      c.type === "voice" || c.channel === "voice"
    );
    const musicCues = [
      ...playMusicCues,
      ...cues.filter((c) =>
        (c.type === "queue" || c.type === "stop") && c.channel === "music"
      ),
    ];

    const sceneTooltip = sceneCues.map((c) => c.raw).join("\n");
    const musicTooltip = musicCues.map((c) => c.raw).join("\n");
    const soundTooltip = soundCues.map((c) => c.raw).join("\n");
    const voiceTooltip = voiceCues.map((c) => c.raw).join("\n");

    const wordCount = data.wordCount ?? 0;
    let customBg = theme.labelBg;
    if (showPacingHeatmap && wordCount > 0) {
      if (wordCount > 150) {
        customBg = isDark ? "#450a0a" : "#fee2e2";
      } else if (wordCount >= 50) {
        customBg = isDark ? "#451a03" : "#fef3c7";
      } else {
        customBg = isDark ? "#022c22" : "#d1fadf";
      }
    }

    const targetPosition = layoutDirection === "LR"
      ? Position.Left
      : Position.Top;
    const isRouteHighlighted = data.isRouteHighlighted === true;
    const isRouteDimmed = data.isRouteDimmed === true;
    const routeStepIndex = data.routeStepIndex;

    const sourcePosition = layoutDirection === "LR"
      ? Position.Right
      : Position.Bottom;

    const isLod = useIsLodMode();

    if (isLod) {
      const tooltip = isOrphan
        ? `[Unreachable] Label: ${data.label}`
        : isTerminalOutcome
        ? `[End of Route] Label: ${data.label}`
        : `Label: ${data.label}`;

      const labelHeight = getNodeHeight({
        type: "LABEL",
        isShadowed,
        isTerminalOutcome,
        audioAssetCues: data.audioAssetCues,
      });

      return (
        <div
          className={cn(
            "w-[220px] flex items-center justify-center relative select-none cursor-pointer transition-all duration-200",
            isRouteHighlighted && "scale-[1.02] z-20",
          )}
          style={{ minHeight: `${labelHeight}px` }}
          title={tooltip}
        >
          {/* Target Anchors */}
          <Handle
            id="target-top"
            type="target"
            position={Position.Top}
            className={cn(
              targetPosition === Position.Top
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-bottom"
            type="target"
            position={Position.Bottom}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="target-left"
            type="target"
            position={Position.Left}
            className={cn(
              targetPosition === Position.Left
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-right"
            type="target"
            position={Position.Right}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />

          {/* LOD Pill Body */}
          <div
            className={cn(
              "w-[180px] h-[28px] px-3 rounded-full border-2 shadow-xs flex items-center justify-between overflow-hidden",
              isRouteHighlighted && "ring-2 ring-violet-500 shadow-md",
            )}
            style={{
              borderColor: isRouteHighlighted
                ? (isDark ? "#a78bfa" : "#7c3aed")
                : isOrphan
                ? (isDark ? "#ef4444" : "#f87171")
                : theme.labelBorder,
              backgroundColor: customBg,
              borderStyle: isOrphan || isShadowed ? "dashed" : "solid",
              opacity: isRouteDimmed
                ? 0.2
                : isOrphan
                ? 0.65
                : (isShadowed ? 0.9 : 1),
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: theme.labelTitle }}
              />
              <span
                className="font-mono text-xs font-semibold truncate"
                style={{ color: theme.labelText }}
              >
                {searchInput
                  ? renderHighlightedText(data.label, searchInput)
                  : data.label}
              </span>
            </div>
            {routeStepIndex !== undefined && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-violet-600 text-white shrink-0 shadow-xs"
                title={`Step ${routeStepIndex}`}
              >
                #{routeStepIndex}
              </span>
            )}
          </div>

          {/* Source Anchors */}
          <Handle
            id="source-top"
            type="source"
            position={Position.Top}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-bottom"
            type="source"
            position={Position.Bottom}
            className={cn(
              sourcePosition === Position.Bottom
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="source-left"
            type="source"
            position={Position.Left}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-right"
            type="source"
            position={Position.Right}
            className={cn(
              sourcePosition === Position.Right
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
        </div>
      );
    }

    return (
      <div
        className={cn(
          "px-4 py-3 rounded-xl border-2 shadow-md w-[220px] transition-all duration-200",
          isRouteHighlighted &&
            "ring-2 ring-violet-500 shadow-xl z-20 scale-[1.02]",
        )}
        style={{
          borderColor: isRouteHighlighted
            ? (isDark ? "#a78bfa" : "#7c3aed")
            : isOrphan
            ? (isDark ? "#ef4444" : "#f87171")
            : theme.labelBorder,
          backgroundColor: customBg,
          borderStyle: isOrphan || isShadowed ? "dashed" : "solid",
          opacity: isRouteDimmed
            ? 0.2
            : isOrphan
            ? 0.65
            : (isShadowed ? 0.9 : 1),
        }}
      >
        {/* Target Anchors */}
        <Handle
          id="target-top"
          type="target"
          position={Position.Top}
          className={cn(
            targetPosition === Position.Top
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-bottom"
          type="target"
          position={Position.Bottom}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="target-left"
          type="target"
          position={Position.Left}
          className={cn(
            targetPosition === Position.Left
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-right"
          type="target"
          position={Position.Right}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1">
            <div
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: theme.labelTitle }}
            >
              Label
            </div>
            {routeStepIndex !== undefined && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-violet-600 text-white shadow-xs"
                title={`Step ${routeStepIndex} in highlighted route`}
              >
                #{routeStepIndex}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isOrphan && (
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border",
                  isDark
                    ? "bg-rose-950/60 border-rose-800/80 text-rose-300"
                    : "bg-rose-100 border-transparent text-rose-800",
                )}
                title="This label is unreachable from entry points (dead code)."
              >
                Unreachable
              </span>
            )}
            {isTerminalOutcome && !isOrphan && (
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border",
                  isDark
                    ? "bg-emerald-950/60 border-emerald-800/80 text-emerald-300"
                    : "bg-emerald-100 border-transparent text-emerald-800",
                )}
              >
                End of Route
              </span>
            )}
            {isShadowed && (
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border",
                  isDark
                    ? "bg-amber-950/60 border-amber-800/80 text-amber-300"
                    : "bg-amber-100 border-transparent text-amber-800",
                )}
              >
                Shadowed
              </span>
            )}
            {data.collapsedLabels && data.collapsedLabels.length > 0 && (
              <span
                className={cn(
                  "text-[10px] font-semibold px-1.5 py-0.5 rounded border",
                  isDark
                    ? "bg-slate-800/60 border-slate-700/85 text-slate-300"
                    : "bg-slate-100 border-transparent text-slate-700",
                )}
                title={data.collapsedLabels.join(", ")}
              >
                +{data.collapsedLabels.length} labels
              </span>
            )}
          </div>
        </div>
        <div
          className="font-mono font-bold truncate text-sm"
          style={{ color: theme.labelText, opacity: isShadowed ? 0.8 : 1 }}
        >
          {searchInput
            ? renderHighlightedText(data.label, searchInput)
            : data.label}
        </div>
        {isShadowed && data.shadowOfId && (
          <div className="mt-1 text-[10px]" style={{ color: theme.labelTitle }}>
            Canonical target: {data.shadowOfId}
          </div>
        )}
        {data.dialogueCount > 0 && (
          <div className="mt-1 text-xs" style={{ color: theme.labelTitle }}>
            {data.dialogueCount}{" "}
            dialogue line{data.dialogueCount !== 1 ? "s" : ""}
            {(data.wordCount ?? 0) > 0 && (() => {
              const secs = calculateReadingTimeSeconds(
                data.wordCount ?? 0,
                data.pauseDuration ?? 0,
                readingSpeedWpm,
              );
              return (
                <span
                  title={`~${(data.wordCount ?? 0).toLocaleString()} words`}
                  style={{ opacity: 0.75, cursor: "help" }}
                >
                  {" · "}
                  {formatReadingTime(secs)}
                </span>
              );
            })()}
          </div>
        )}
        {showAudioAssetCues && cues.length > 0 && (
          <div
            className="mt-2 pt-2 border-t flex flex-wrap gap-1.5 justify-start"
            style={{
              borderColor: isDark ? `${theme.labelBorder}33` : "#f3f4f6",
            }}
          >
            {sceneCues.length > 0 && (
              <button
                type="button"
                aria-label={sceneTooltip}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400",
                  isDark
                    ? "bg-blue-950/60 border-blue-800/80 text-blue-300"
                    : "bg-blue-50 border-blue-200 text-blue-700",
                )}
                title={sceneTooltip}
              >
                <ImageIcon size={10} />
                <span>{sceneCues.length}</span>
              </button>
            )}
            {musicCues.length > 0 && (
              <button
                type="button"
                aria-label={musicTooltip}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400",
                  isDark
                    ? "bg-emerald-950/60 border-emerald-800/80 text-emerald-300"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700",
                )}
                title={musicTooltip}
              >
                <MusicIcon size={10} />
                <span>{musicCues.length}</span>
              </button>
            )}
            {soundCues.length > 0 && (
              <button
                type="button"
                aria-label={soundTooltip}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400",
                  isDark
                    ? "bg-amber-950/60 border-amber-900/80 text-amber-300"
                    : "bg-amber-50 border-amber-200 text-amber-700",
                )}
                title={soundTooltip}
              >
                <Volume2Icon size={10} />
                <span>{soundCues.length}</span>
              </button>
            )}
            {voiceCues.length > 0 && (
              <button
                type="button"
                aria-label={voiceTooltip}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-purple-400",
                  isDark
                    ? "bg-purple-950/60 border-purple-800/80 text-purple-300"
                    : "bg-purple-50 border-purple-200 text-purple-700",
                )}
                title={voiceTooltip}
              >
                <MicIcon size={10} />
                <span>{voiceCues.length}</span>
              </button>
            )}
          </div>
        )}
        {/* Source Anchors */}
        <Handle
          id="source-top"
          type="source"
          position={Position.Top}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-bottom"
          type="source"
          position={Position.Bottom}
          className={cn(
            sourcePosition === Position.Bottom
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="source-left"
          type="source"
          position={Position.Left}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-right"
          type="source"
          position={Position.Right}
          className={cn(
            sourcePosition === Position.Right
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
      </div>
    );
  },
);

export const MenuNodeComponent = memo(
  function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
    const { searchInput, readingSpeedWpm, layoutDirection } =
      useViewerPresentation();
    const themeName = data.theme ?? "violet";
    const theme = getTheme(themeName);
    const isDark = themeName === "dark";
    const isRouteHighlighted = data.isRouteHighlighted === true;
    const isRouteDimmed = data.isRouteDimmed === true;
    const routeStepIndex = data.routeStepIndex;

    const targetPosition = layoutDirection === "LR"
      ? Position.Left
      : Position.Top;
    const sourcePosition = layoutDirection === "LR"
      ? Position.Right
      : Position.Bottom;

    const isLod = useIsLodMode();

    if (isLod) {
      return (
        <div
          className={cn(
            "w-[220px] flex items-center justify-center relative select-none cursor-pointer transition-all duration-200",
            isRouteHighlighted && "scale-[1.02] z-20",
          )}
          style={{ minHeight: `${NODE_HEIGHT_MENU}px` }}
          title={`Menu: ${data.label}`}
        >
          {/* Target Anchors */}
          <Handle
            id="target-top"
            type="target"
            position={Position.Top}
            className={cn(
              targetPosition === Position.Top
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-bottom"
            type="target"
            position={Position.Bottom}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="target-left"
            type="target"
            position={Position.Left}
            className={cn(
              targetPosition === Position.Left
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-right"
            type="target"
            position={Position.Right}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />

          {/* LOD Pill Body */}
          <div
            className={cn(
              "w-[180px] h-[28px] px-3 rounded-full border-2 shadow-xs flex items-center justify-between overflow-hidden",
              isRouteHighlighted && "ring-2 ring-violet-500 shadow-md",
            )}
            style={{
              borderColor: isRouteHighlighted
                ? (isDark ? "#a78bfa" : "#7c3aed")
                : theme.menuBorder,
              backgroundColor: theme.menuBg,
              opacity: isRouteDimmed ? 0.2 : 1,
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: theme.menuTitle }}
              />
              <span
                className="font-mono text-xs font-semibold truncate"
                style={{ color: theme.menuText }}
              >
                {searchInput
                  ? renderHighlightedText(data.label, searchInput)
                  : data.label}
              </span>
            </div>
            {routeStepIndex !== undefined && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-violet-600 text-white shrink-0 shadow-xs"
                title={`Step ${routeStepIndex}`}
              >
                #{routeStepIndex}
              </span>
            )}
          </div>

          {/* Source Anchors */}
          <Handle
            id="source-top"
            type="source"
            position={Position.Top}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-bottom"
            type="source"
            position={Position.Bottom}
            className={cn(
              sourcePosition === Position.Bottom
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="source-left"
            type="source"
            position={Position.Left}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-right"
            type="source"
            position={Position.Right}
            className={cn(
              sourcePosition === Position.Right
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
        </div>
      );
    }
    return (
      <div
        className={cn(
          "px-4 py-3 rounded-xl border-2 shadow-md w-[220px] transition-all duration-200",
          isRouteHighlighted &&
            "ring-2 ring-violet-500 shadow-xl z-20 scale-[1.02]",
        )}
        style={{
          borderColor: isRouteHighlighted
            ? (isDark ? "#a78bfa" : "#7c3aed")
            : theme.menuBorder,
          backgroundColor: theme.menuBg,
          opacity: isRouteDimmed ? 0.2 : 1,
        }}
      >
        {/* Target Anchors */}
        <Handle
          id="target-top"
          type="target"
          position={Position.Top}
          className={cn(
            targetPosition === Position.Top
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-bottom"
          type="target"
          position={Position.Bottom}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="target-left"
          type="target"
          position={Position.Left}
          className={cn(
            targetPosition === Position.Left
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-right"
          type="target"
          position={Position.Right}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <div className="flex items-center justify-between gap-2 mb-1">
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: theme.menuTitle }}
          >
            Menu
          </div>
          {routeStepIndex !== undefined && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-violet-600 text-white shadow-xs"
              title={`Step ${routeStepIndex} in highlighted route`}
            >
              #{routeStepIndex}
            </span>
          )}
        </div>
        <div
          className="font-mono font-bold truncate text-sm"
          style={{ color: theme.menuText }}
        >
          {searchInput
            ? renderHighlightedText(data.label, searchInput)
            : data.label}
        </div>
        {data.dialogueCount > 0 && (
          <div className="mt-1 text-xs" style={{ color: theme.menuTitle }}>
            {data.dialogueCount}{" "}
            dialogue line{data.dialogueCount !== 1 ? "s" : ""}
            {(data.wordCount ?? 0) > 0 && (() => {
              const secs = calculateReadingTimeSeconds(
                data.wordCount ?? 0,
                data.pauseDuration ?? 0,
                readingSpeedWpm,
              );
              return (
                <span
                  title={`~${(data.wordCount ?? 0).toLocaleString()} words`}
                  style={{ opacity: 0.75, cursor: "help" }}
                >
                  {" · "}
                  {formatReadingTime(secs)}
                </span>
              );
            })()}
          </div>
        )}
        {/* Source Anchors */}
        <Handle
          id="source-top"
          type="source"
          position={Position.Top}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-bottom"
          type="source"
          position={Position.Bottom}
          className={cn(
            sourcePosition === Position.Bottom
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="source-left"
          type="source"
          position={Position.Left}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-right"
          type="source"
          position={Position.Right}
          className={cn(
            sourcePosition === Position.Right
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
      </div>
    );
  },
);

export const DecisionNodeComponent = memo(
  function DecisionNodeComponent({ data }: NodeProps<DecisionNodeType>) {
    const { searchInput, layoutDirection } = useViewerPresentation();
    const themeName = data.theme ?? "violet";
    const theme = getTheme(themeName);
    const isDark = themeName === "dark";
    const isRouteHighlighted = data.isRouteHighlighted === true;
    const isRouteDimmed = data.isRouteDimmed === true;
    const routeStepIndex = data.routeStepIndex;

    const targetPosition = layoutDirection === "LR"
      ? Position.Left
      : Position.Top;
    const sourcePosition = layoutDirection === "LR"
      ? Position.Right
      : Position.Bottom;
    const expression = data.conditionExpression ?? data.label;

    const isLod = useIsLodMode();

    if (isLod) {
      return (
        <div
          className={cn(
            "w-[220px] flex items-center justify-center relative py-2 transition-all duration-200 select-none cursor-pointer",
            isRouteHighlighted && "scale-[1.02] z-20",
          )}
          style={{
            height: `${NODE_HEIGHT_DECISION}px`,
            opacity: isRouteDimmed ? 0.2 : 1,
          }}
          title={`Decision: ${expression}`}
        >
          {/* Target Anchors */}
          <Handle
            id="target-top"
            type="target"
            position={Position.Top}
            style={{ top: "calc(50% - 14px)", left: "50%" }}
            className={cn(
              targetPosition === Position.Top
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-bottom"
            type="target"
            position={Position.Bottom}
            style={{ bottom: "calc(50% - 14px)", left: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="target-left"
            type="target"
            position={Position.Left}
            style={{ left: "20px", top: "50%" }}
            className={cn(
              targetPosition === Position.Left
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-right"
            type="target"
            position={Position.Right}
            style={{ right: "20px", top: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />

          {/* LOD Pill Body */}
          <div
            className="w-[180px] h-[28px] px-3 rounded-full border-2 shadow-xs flex items-center justify-between overflow-hidden"
            style={{
              borderColor: theme.decisionBorder,
              backgroundColor: theme.decisionBg,
              borderStyle: "solid",
              opacity: isRouteDimmed ? 0.2 : 1,
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: theme.decisionTitle }}
              />
              <span
                className="font-mono text-xs font-semibold truncate"
                style={{ color: theme.decisionText }}
              >
                {renderHighlightedText(expression, searchInput)}
              </span>
            </div>
            {routeStepIndex !== undefined && (
              <span
                className={cn(
                  "text-[9px] font-bold px-1.5 py-0.2 rounded-full shrink-0 shadow-xs",
                  isDark
                    ? "bg-amber-400 text-slate-950"
                    : "bg-amber-600 text-white",
                )}
                title={`Step ${routeStepIndex}`}
              >
                #{routeStepIndex}
              </span>
            )}
          </div>

          {/* Source Anchors */}
          <Handle
            id="source-top"
            type="source"
            position={Position.Top}
            style={{ top: "calc(50% - 14px)", left: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-bottom"
            type="source"
            position={Position.Bottom}
            style={{ bottom: "calc(50% - 14px)", left: "50%" }}
            className={cn(
              sourcePosition === Position.Bottom
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="source-left"
            type="source"
            position={Position.Left}
            style={{ left: "20px", top: "50%" }}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-right"
            type="source"
            position={Position.Right}
            style={{ right: "20px", top: "50%" }}
            className={cn(
              sourcePosition === Position.Right
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
        </div>
      );
    }

    return (
      <div
        className="w-[220px] flex items-center justify-center relative py-2 transition-all duration-200"
        style={{ opacity: isRouteDimmed ? 0.2 : 1 }}
      >
        {/* Target Anchors */}
        <Handle
          id="target-top"
          type="target"
          position={Position.Top}
          style={{ top: "8px", left: "50%" }}
          className={cn(
            targetPosition === Position.Top
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-bottom"
          type="target"
          position={Position.Bottom}
          style={{ bottom: "8px", left: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="target-left"
          type="target"
          position={Position.Left}
          style={{ left: "30px", top: "50%" }}
          className={cn(
            targetPosition === Position.Left
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="target-right"
          type="target"
          position={Position.Right}
          style={{ right: "30px", top: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <div
          className={cn(
            "w-[160px] h-[160px] rotate-45 border-2 shadow-md rounded-xl flex items-center justify-center transition-all duration-200",
            isRouteHighlighted &&
              "ring-2 ring-violet-500 shadow-xl scale-[1.02]",
          )}
          style={{
            borderColor: isRouteHighlighted
              ? (isDark ? "#a78bfa" : "#7c3aed")
              : theme.decisionBorder,
            backgroundColor: theme.decisionBg,
          }}
        >
          <div className="-rotate-45 px-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <div
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: theme.decisionTitle }}
              >
                Decision
              </div>
              {routeStepIndex !== undefined && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-violet-600 text-white shadow-xs"
                  title={`Step ${routeStepIndex} in highlighted route`}
                >
                  #{routeStepIndex}
                </span>
              )}
            </div>
            <div
              className="font-mono text-xs font-semibold break-words"
              style={{ color: theme.decisionText }}
            >
              {searchInput
                ? renderHighlightedText(expression, searchInput)
                : expression}
            </div>
          </div>
        </div>
        {/* Source Anchors */}
        <Handle
          id="source-top"
          type="source"
          position={Position.Top}
          style={{ top: "8px", left: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-bottom"
          type="source"
          position={Position.Bottom}
          style={{ bottom: "8px", left: "50%" }}
          className={cn(
            sourcePosition === Position.Bottom
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
        <Handle
          id="source-left"
          type="source"
          position={Position.Left}
          style={{ left: "30px", top: "50%" }}
          className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
        />
        <Handle
          id="source-right"
          type="source"
          position={Position.Right}
          style={{ right: "30px", top: "50%" }}
          className={cn(
            sourcePosition === Position.Right
              ? ""
              : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
          )}
        />
      </div>
    );
  },
);

export const ChapterNodeComponent = memo(
  function ChapterNodeComponent({ data }: NodeProps<ChapterNodeType>) {
    const { searchInput, readingSpeedWpm, layoutDirection } =
      useViewerPresentation();
    const themeName = data.theme ?? "violet";
    const isDark = themeName === "dark";

    const chapterName = data.chapter || data.label || "Uncategorized";
    const isCollapsed = data.isCollapsed === true;
    const containsActiveRoute = data.containsActiveRoute === true;
    const searchMatchCount = data.chapterSearchMatchCount ?? 0;

    const handleToggleChapter = useCallback(() => {
      useViewerStore.getState().toggleChapter(chapterName);
    }, [chapterName]);

    const totalWords = data.chapterTotalWordCount ?? data.wordCount ?? 0;
    const totalDialogue = data.chapterTotalDialogueCount ??
      data.dialogueCount ?? 0;
    const nodeCount = data.chapterNodeCount ?? 0;
    const pauseSecs = data.chapterTotalPauseDuration ?? data.pauseDuration ?? 0;

    const readingTime = totalWords > 0
      ? formatReadingTime(
        calculateReadingTimeSeconds(totalWords, pauseSecs, readingSpeedWpm),
      )
      : null;

    const targetPosition = layoutDirection === "LR"
      ? Position.Left
      : Position.Top;
    const sourcePosition = layoutDirection === "LR"
      ? Position.Right
      : Position.Bottom;

    const isLod = useIsLodMode();

    // ── 1. Collapsed Summary Card on Canvas ──────────────────────────────────
    if (isCollapsed) {
      if (isLod) {
        return (
          <div
            className={cn(
              "w-[260px] flex items-center justify-center relative select-none cursor-pointer transition-all duration-200",
              containsActiveRoute && "scale-[1.02] z-20",
            )}
            style={{ minHeight: `${CHAPTER_SUMMARY_HEIGHT}px` }}
            onClick={handleToggleChapter}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleToggleChapter();
              }
            }}
            aria-label={`Expand chapter container for ${chapterName}`}
            title={`Collapsed Chapter: ${chapterName} (${nodeCount} labels, ${totalDialogue} lines)`}
          >
            {/* Target Anchors */}
            <Handle
              id="target-top"
              type="target"
              position={Position.Top}
              className={cn(
                targetPosition === Position.Top
                  ? ""
                  : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
              )}
            />
            <Handle
              id="target-bottom"
              type="target"
              position={Position.Bottom}
              className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
            />
            <Handle
              id="target-left"
              type="target"
              position={Position.Left}
              className={cn(
                targetPosition === Position.Left
                  ? ""
                  : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
              )}
            />
            <Handle
              id="target-right"
              type="target"
              position={Position.Right}
              className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
            />

            {/* LOD Pill Body */}
            <div
              className={cn(
                "w-[220px] h-[28px] px-3 rounded-full border-2 shadow-xs flex items-center justify-between overflow-hidden",
                containsActiveRoute && "ring-2 ring-violet-500 shadow-md",
              )}
              style={{
                borderColor: containsActiveRoute
                  ? (isDark ? "#a78bfa" : "#7c3aed")
                  : isDark
                  ? "#475569"
                  : "#94a3b8",
                backgroundColor: isDark ? "#1e293b" : "#f8fafc",
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <FolderArchive
                  size={12}
                  className={isDark ? "text-violet-400" : "text-violet-600"}
                />
                <span
                  className="font-mono text-xs font-semibold truncate"
                  style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                >
                  {searchInput
                    ? renderHighlightedText(chapterName, searchInput)
                    : chapterName}
                </span>
              </div>
              <span
                className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-slate-700 text-slate-200 shrink-0 shadow-xs"
                title={`${nodeCount} labels`}
              >
                {nodeCount}
              </span>
            </div>

            {/* Source Anchors */}
            <Handle
              id="source-top"
              type="source"
              position={Position.Top}
              className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
            />
            <Handle
              id="source-bottom"
              type="source"
              position={Position.Bottom}
              className={cn(
                sourcePosition === Position.Bottom
                  ? ""
                  : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
              )}
            />
            <Handle
              id="source-left"
              type="source"
              position={Position.Left}
              className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
            />
            <Handle
              id="source-right"
              type="source"
              position={Position.Right}
              className={cn(
                sourcePosition === Position.Right
                  ? ""
                  : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
              )}
            />
          </div>
        );
      }

      return (
        <div
          className={cn(
            "p-3.5 rounded-xl border-2 shadow-md w-[260px] transition-all duration-200 cursor-pointer select-none relative",
            containsActiveRoute &&
              "ring-2 ring-violet-500 shadow-xl scale-[1.02] z-20",
          )}
          style={{
            borderColor: containsActiveRoute
              ? (isDark ? "#a78bfa" : "#7c3aed")
              : isDark
              ? "#475569"
              : "#cbd5e1",
            backgroundColor: isDark ? "#1e293b" : "#f8fafc",
          }}
          onClick={handleToggleChapter}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggleChapter();
            }
          }}
          aria-label={`Expand chapter container for ${chapterName}`}
        >
          {/* Target Anchors */}
          <Handle
            id="target-top"
            type="target"
            position={Position.Top}
            className={cn(
              targetPosition === Position.Top
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-bottom"
            type="target"
            position={Position.Bottom}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="target-left"
            type="target"
            position={Position.Left}
            className={cn(
              targetPosition === Position.Left
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="target-right"
            type="target"
            position={Position.Right}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />

          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5">
              <FolderArchive
                size={14}
                className={isDark ? "text-violet-400" : "text-violet-600"}
              />
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: isDark ? "#334155" : "#e2e8f0",
                  color: isDark ? "#94a3b8" : "#475569",
                }}
              >
                Chapter Summary
              </span>
            </div>
            <span
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors",
                isDark
                  ? "bg-slate-800 border-slate-600 text-slate-200"
                  : "bg-white border-gray-300 text-gray-700",
              )}
              aria-hidden="true"
            >
              <ChevronRight size={12} />
              <span>Expand</span>
            </span>
          </div>

          <div
            className="font-mono font-bold text-sm truncate"
            style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
          >
            {searchInput
              ? renderHighlightedText(chapterName, searchInput)
              : chapterName}
          </div>

          <div
            className="mt-1.5 text-xs flex flex-col gap-0.5"
            style={{ color: isDark ? "#94a3b8" : "#64748b" }}
          >
            <div>
              {nodeCount > 0 && (
                <span>
                  {nodeCount} label{nodeCount !== 1 ? "s" : ""}
                </span>
              )}
              {totalDialogue > 0 && (
                <span>
                  {" · "}
                  {totalDialogue} line{totalDialogue !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {totalWords > 0 && (
              <div className="text-[11px] opacity-85">
                ~{totalWords.toLocaleString()} words
                {readingTime && ` · ${readingTime}`}
              </div>
            )}
          </div>

          {searchMatchCount > 0 && (
            <div className="mt-2 pt-1.5 border-t border-slate-700/40 flex items-center gap-1 text-[10px] font-semibold text-amber-400">
              <Sparkles size={11} />
              <span>
                {searchMatchCount}{" "}
                search match{searchMatchCount !== 1 ? "es" : ""} inside
              </span>
            </div>
          )}

          {/* Source Anchors */}
          <Handle
            id="source-top"
            type="source"
            position={Position.Top}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-bottom"
            type="source"
            position={Position.Bottom}
            className={cn(
              sourcePosition === Position.Bottom
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
          <Handle
            id="source-left"
            type="source"
            position={Position.Left}
            className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2"
          />
          <Handle
            id="source-right"
            type="source"
            position={Position.Right}
            className={cn(
              sourcePosition === Position.Right
                ? ""
                : "!opacity-0 !pointer-events-none !border-none !bg-transparent !w-2 !h-2",
            )}
          />
        </div>
      );
    }

    // ── 2. Expanded Container Box around Child Labels ─────────────────────────
    return (
      <div
        className={cn(
          "w-full h-full rounded-2xl border-2 transition-all duration-200 pointer-events-none relative select-none",
          containsActiveRoute && "ring-2 ring-violet-500 shadow-xl",
        )}
        style={{
          borderColor: isDark
            ? "rgba(100, 116, 139, 0.45)"
            : "rgba(203, 213, 225, 0.9)",
          backgroundColor: isDark
            ? "rgba(15, 23, 42, 0.4)"
            : "rgba(248, 250, 252, 0.55)",
          borderStyle: "dashed",
        }}
      >
        {/* Interactive Header Badge Bar */}
        <div className="absolute top-2 left-3 pointer-events-auto flex items-center gap-2 z-10">
          <div
            className={cn(
              "flex items-center gap-2 px-2.5 py-1 rounded-lg border shadow-xs backdrop-blur-md transition-colors",
              isDark
                ? "bg-slate-900/90 border-slate-700 text-slate-200"
                : "bg-white/95 border-slate-200 text-slate-800",
            )}
          >
            <FileCode
              size={13}
              className={isDark ? "text-violet-400" : "text-violet-600"}
            />
            <span className="font-mono font-bold text-xs tracking-tight">
              {searchInput
                ? renderHighlightedText(chapterName, searchInput)
                : chapterName}
            </span>
            {!isLod && (
              <>
                <div
                  className="h-3 w-px mx-0.5"
                  style={{ backgroundColor: isDark ? "#475569" : "#e2e8f0" }}
                />
                <span
                  className="text-[10px] font-medium"
                  style={{ color: isDark ? "#94a3b8" : "#64748b" }}
                >
                  {nodeCount > 0 ? `${nodeCount} nodes` : ""}
                  {totalWords > 0 ? ` · ~${totalWords.toLocaleString()}w` : ""}
                  {readingTime ? ` · ${readingTime}` : ""}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleChapter();
                  }}
                  className={cn(
                    "ml-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer",
                    isDark
                      ? "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200"
                      : "bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-700",
                  )}
                  aria-label={`Collapse chapter container ${chapterName}`}
                  title="Collapse chapter into summary node"
                >
                  <ChevronDown size={11} />
                  <span>Collapse</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
);
