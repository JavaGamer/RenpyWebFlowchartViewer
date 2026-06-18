import { memo } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { DecisionNodeType, LabelNodeType, MenuNodeType } from "../domain/index.ts";
import { THEMES } from "./viewerTheme.ts";
import { useViewerStore } from "../application/index.ts";
import {
  Image as ImageIcon,
  Mic as MicIcon,
  Music as MusicIcon,
  Volume2 as Volume2Icon,
} from "lucide-react";
import { cn } from "./utils/cn.ts";

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
    const isDark = themeName === "dark";
    const isShadowed = data.isShadowed === true;
    const isTerminalOutcome = data.isTerminalOutcome === true;
    const showAudioAssetCues = useViewerStore((s) => s.showAudioAssetCues);

    const cues = data.audioAssetCues ?? [];
    const sceneCues = cues.filter((c) => c.type === "scene");
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

    return (
      <div
        className="px-4 py-3 rounded-xl border-2 shadow-md w-[220px]"
        style={{
          borderColor: theme.labelBorder,
          backgroundColor: theme.labelBg,
          borderStyle: isShadowed ? "dashed" : "solid",
          opacity: isShadowed ? 0.9 : 1,
        }}
      >
        <Handle type="target" position={Position.Top} />
        <div className="flex items-center justify-between gap-2 mb-1">
          <div
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: theme.labelTitle }}
          >
            Label
          </div>
          <div className="flex items-center gap-1">
            {isTerminalOutcome && (
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
          {data.label}
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
              <div
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help",
                  isDark
                    ? "bg-blue-950/60 border-blue-800/80 text-blue-300"
                    : "bg-blue-50 border-blue-200 text-blue-700",
                )}
                title={sceneTooltip}
              >
                <ImageIcon size={10} />
                <span>{sceneCues.length}</span>
              </div>
            )}
            {musicCues.length > 0 && (
              <div
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help",
                  isDark
                    ? "bg-emerald-950/60 border-emerald-800/80 text-emerald-300"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700",
                )}
                title={musicTooltip}
              >
                <MusicIcon size={10} />
                <span>{musicCues.length}</span>
              </div>
            )}
            {soundCues.length > 0 && (
              <div
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help",
                  isDark
                    ? "bg-amber-950/60 border-amber-900/80 text-amber-300"
                    : "bg-amber-50 border-amber-200 text-amber-700",
                )}
                title={soundTooltip}
              >
                <Volume2Icon size={10} />
                <span>{soundCues.length}</span>
              </div>
            )}
            {voiceCues.length > 0 && (
              <div
                className={cn(
                  "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-help",
                  isDark
                    ? "bg-purple-950/60 border-purple-800/80 text-purple-300"
                    : "bg-purple-50 border-purple-200 text-purple-700",
                )}
                title={voiceTooltip}
              >
                <MicIcon size={10} />
                <span>{voiceCues.length}</span>
              </div>
            )}
          </div>
        )}
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  },
);

export const MenuNodeComponent = memo(
  function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
    const themeName = useViewerStore((s) => s.theme);
    const theme = getTheme(themeName);
    return (
      <div
        className="px-4 py-3 rounded-xl border-2 shadow-md w-[220px]"
        style={{ borderColor: theme.menuBorder, backgroundColor: theme.menuBg }}
      >
        <Handle type="target" position={Position.Top} />
        <div
          className="text-xs font-semibold uppercase tracking-widest mb-1"
          style={{ color: theme.menuTitle }}
        >
          Menu
        </div>
        <div
          className="font-mono font-bold truncate text-sm"
          style={{ color: theme.menuText }}
        >
          {data.label}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  },
);

export const DecisionNodeComponent = memo(
  function DecisionNodeComponent({ data }: NodeProps<DecisionNodeType>) {
    const themeName = useViewerStore((s) => s.theme);
    const theme = getTheme(themeName);
    const expression = data.conditionExpression ?? data.label;
    return (
      <div className="w-[220px] flex items-center justify-center relative py-2">
        <Handle type="target" position={Position.Top} />
        <div
          className="w-[160px] h-[160px] rotate-45 border-2 shadow-md rounded-xl flex items-center justify-center"
          style={{
            borderColor: theme.decisionBorder,
            backgroundColor: theme.decisionBg,
          }}
        >
          <div className="-rotate-45 px-4 text-center">
            <div
              className="text-[10px] font-semibold uppercase tracking-widest mb-1"
              style={{ color: theme.decisionTitle }}
            >
              Decision
            </div>
            <div
              className="font-mono text-xs font-semibold break-words"
              style={{ color: theme.decisionText }}
            >
              {expression}
            </div>
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  },
);
