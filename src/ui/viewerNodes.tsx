import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DecisionNodeType, LabelNodeType, MenuNodeType } from '../flowchartTransforms';
import { THEMES } from './viewerTheme';

function getTheme(themeName: unknown) {
  if (typeof themeName === 'string' && themeName in THEMES) {
    return THEMES[themeName as keyof typeof THEMES];
  }
  return THEMES.violet;
}

export function LabelNodeComponent({ data }: NodeProps<LabelNodeType>) {
  const theme = getTheme(data.theme);
  const isShadowed = data.isShadowed === true;
  const isTerminalOutcome = data.isTerminalOutcome === true;
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
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function MenuNodeComponent({ data }: NodeProps<MenuNodeType>) {
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
}

export function DecisionNodeComponent({ data }: NodeProps<DecisionNodeType>) {
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
}
