import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DecisionNodeType, LabelNodeType, MenuNodeType } from '../domain';
import { THEMES } from './viewerTheme';
import { useViewerStore } from '../application';
import { Image as ImageIcon, Music as MusicIcon, Volume2 as Volume2Icon, Mic as MicIcon } from 'lucide-react';

function getTheme(themeName: unknown) {
  if (typeof themeName === 'string' && themeName in THEMES) {
    return THEMES[themeName as keyof typeof THEMES];
  }
  return THEMES.violet;
}

export const LabelNodeComponent = memo(function LabelNodeComponent({ data }: NodeProps<LabelNodeType>) {
  const theme = getTheme(data.theme);
  const isShadowed = data.isShadowed === true;
  const isTerminalOutcome = data.isTerminalOutcome === true;
  const showAudioAssetCues = useViewerStore((s) => s.showAudioAssetCues);

  const cues = data.audioAssetCues ?? [];
  const sceneCues = cues.filter((c) => c.type === 'scene');
  const playMusicCues = cues.filter((c) => c.type === 'play' && c.channel === 'music');
  const soundCues = cues.filter((c) => (c.type === 'play' || c.type === 'queue' || c.type === 'stop') && c.channel !== 'music' && c.channel !== 'voice');
  const voiceCues = cues.filter((c) => c.type === 'voice' || c.channel === 'voice');
  const musicCues = [...playMusicCues, ...cues.filter((c) => (c.type === 'queue' || c.type === 'stop') && c.channel === 'music')];

  const sceneTooltip = sceneCues.map((c) => c.raw).join('\n');
  const musicTooltip = musicCues.map((c) => c.raw).join('\n');
  const soundTooltip = soundCues.map((c) => c.raw).join('\n');
  const voiceTooltip = voiceCues.map((c) => c.raw).join('\n');

  return (
    <div
      className="px-4 py-3 rounded-xl border-2 shadow-md w-[220px]"
      style={{
        borderColor: theme.labelBorder,
        backgroundColor: theme.labelBg,
        borderStyle: isShadowed ? 'dashed' : 'solid',
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
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
              End of Route
            </span>
          )}
          {isShadowed && (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              Shadowed
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
          {data.dialogueCount} dialogue line{data.dialogueCount !== 1 ? 's' : ''}
        </div>
      )}
      {showAudioAssetCues && cues.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-1.5 justify-start">
          {sceneCues.length > 0 && (
            <div
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-blue-50 border-blue-200 text-blue-700 cursor-help"
              title={sceneTooltip}
            >
              <ImageIcon size={10} />
              <span>{sceneCues.length}</span>
            </div>
          )}
          {musicCues.length > 0 && (
            <div
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-200 text-emerald-700 cursor-help"
              title={musicTooltip}
            >
              <MusicIcon size={10} />
              <span>{musicCues.length}</span>
            </div>
          )}
          {soundCues.length > 0 && (
            <div
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700 cursor-help"
              title={soundTooltip}
            >
              <Volume2Icon size={10} />
              <span>{soundCues.length}</span>
            </div>
          )}
          {voiceCues.length > 0 && (
            <div
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700 cursor-help"
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
});

export const MenuNodeComponent = memo(function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
  const theme = getTheme(data.theme);
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
      <div className="font-mono font-bold truncate text-sm" style={{ color: theme.menuText }}>
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

export const DecisionNodeComponent = memo(function DecisionNodeComponent({ data }: NodeProps<DecisionNodeType>) {
  const theme = getTheme(data.theme);
  const expression = data.conditionExpression ?? data.label;
  return (
    <div className="w-[220px] flex items-center justify-center relative py-2">
      <Handle type="target" position={Position.Top} />
      <div
        className="w-[160px] h-[160px] rotate-45 border-2 shadow-md rounded-xl flex items-center justify-center"
        style={{ borderColor: theme.decisionBorder, backgroundColor: theme.decisionBg }}
      >
        <div className="-rotate-45 px-4 text-center">
          <div
            className="text-[10px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: theme.decisionTitle }}
          >
            Decision
          </div>
          <div className="font-mono text-xs font-semibold break-words" style={{ color: theme.decisionText }}>
            {expression}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
