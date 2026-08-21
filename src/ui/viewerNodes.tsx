import { memo } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type {
  DecisionNodeType,
  LabelNodeType,
  MenuNodeType,
} from "../domain/index.ts";
import { THEMES } from "./viewerTheme.ts";
import { useViewerStore } from "../application/index.ts";
import {
  Image as ImageIcon,
  Mic as MicIcon,
  Music as MusicIcon,
  Volume2 as Volume2Icon,
} from "lucide-react";
import { cn } from "./utils/cn.ts";
import { renderHighlightedText } from "./viewerText.tsx";
import {
  calculateReadingTimeSeconds,
  formatReadingTime,
} from "./utils/readingTime.ts";

function getTheme(themeName: unknown) {
  if (typeof themeName === "string" && themeName in THEMES) {
    return THEMES[themeName as keyof typeof THEMES];
  }
  return THEMES.violet;
}

export const LabelNodeComponent = memo(
  function LabelNodeComponent({ data }: NodeProps<LabelNodeType>) {
    const themeName = useViewerStore((s) => s.theme);
    const theme = getTheme(themeName);
    const searchInput = useViewerStore((s) => s.searchInput);
    const readingSpeedWpm = useViewerStore((s) => s.readingSpeedWpm);
    const isDark = themeName === "dark";
    const isShadowed = data.isShadowed === true;
    const isOrphan = data.isOrphan === true;
    const isTerminalOutcome = data.isTerminalOutcome === true;
    const showAudioAssetCues = useViewerStore((s) => s.showAudioAssetCues);
    const showPacingHeatmap = useViewerStore((s) => s.showPacingHeatmap);

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

    const layoutDirection = useViewerStore((s) => s.layoutDirection);
    const targetPosition = layoutDirection === "LR"
      ? Position.Left
      : Position.Top;
    const isRouteHighlighted = data.isRouteHighlighted === true;
    const isRouteDimmed = data.isRouteDimmed === true;
    const routeStepIndex = data.routeStepIndex;

    const sourcePosition = layoutDirection === "LR"
      ? Position.Right
      : Position.Bottom;

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
        <Handle type="target" position={targetPosition} />
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
        <Handle type="source" position={sourcePosition} />
      </div>
    );
  },
);

export const MenuNodeComponent = memo(
  function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
    const themeName = useViewerStore((s) => s.theme);
    const theme = getTheme(themeName);
    const searchInput = useViewerStore((s) => s.searchInput);
    const readingSpeedWpm = useViewerStore((s) => s.readingSpeedWpm);
    const layoutDirection = useViewerStore((s) => s.layoutDirection);
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
        <Handle type="target" position={targetPosition} />
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
        <Handle type="source" position={sourcePosition} />
      </div>
    );
  },
);

export const DecisionNodeComponent = memo(
  function DecisionNodeComponent({ data }: NodeProps<DecisionNodeType>) {
    const themeName = useViewerStore((s) => s.theme);
    const theme = getTheme(themeName);
    const searchInput = useViewerStore((s) => s.searchInput);
    const layoutDirection = useViewerStore((s) => s.layoutDirection);
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
    return (
      <div
        className="w-[220px] flex items-center justify-center relative py-2 transition-all duration-200"
        style={{ opacity: isRouteDimmed ? 0.2 : 1 }}
      >
        <Handle type="target" position={targetPosition} />
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
        <Handle type="source" position={sourcePosition} />
      </div>
    );
  },
);
