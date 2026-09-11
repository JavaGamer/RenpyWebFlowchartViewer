import { Plus, Trash2 } from "lucide-react";
import type {
  ScreenActionKind,
  ScreenActionRule,
} from "../../config/parserRules.ts";
import { cn } from "../utils/cn.ts";

export interface ParserRuleEditorProps {
  rules: ScreenActionRule[];
  onAddRule: () => void;
  onUpdateRule: (index: number, patch: Partial<ScreenActionRule>) => void;
  onRemoveRule: (index: number) => void;
  isOverriding?: (actionName: string) => boolean;
  isDark?: boolean;
  title?: string;
  description?: string;
}

const ALL_SCREEN_ACTION_KINDS: ScreenActionKind[] = [
  "jump",
  "call",
  "show",
  "hide",
  "set_variable",
  "toggle_variable",
  "confirm",
  "null_action",
  "show_menu",
];

export function ParserRuleEditor({
  rules,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  isOverriding,
  isDark = false,
  title,
  description,
}: ParserRuleEditorProps) {
  return (
    <div className="space-y-2">
      {title && (
        <span
          className={cn(
            "font-semibold block text-xs",
            isDark ? "text-slate-200" : "text-gray-800",
          )}
        >
          {title}
        </span>
      )}
      {description && (
        <p
          className={cn(
            "text-[11px] mb-2",
            isDark ? "text-slate-400" : "text-gray-500",
          )}
        >
          {description}
        </p>
      )}

      <div
        className="space-y-2"
        role="group"
        aria-label="Screen action rules editor"
      >
        {rules.length === 0 && (
          <p
            className={cn(
              "text-[11px] italic py-1",
              isDark ? "text-slate-500" : "text-gray-400",
            )}
          >
            No custom screen-action rules defined.
          </p>
        )}

        {rules.map((rule, idx) => {
          const overriding = isOverriding
            ? isOverriding(rule.actionName)
            : false;
          return (
            <div
              key={`rule-editor-row-${idx}`}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                aria-label={`Custom rule action ${idx + 1}`}
                value={rule.actionName}
                onChange={(e) =>
                  onUpdateRule(idx, { actionName: e.target.value })}
                className={cn(
                  "min-w-32 flex-1 rounded-md border px-2 py-1 text-xs font-mono transition-colors duration-200",
                  isDark
                    ? "border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 focus:ring-violet-400"
                    : "border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:ring-violet-500",
                )}
                placeholder="Action name (e.g. Warp, Goto)"
              />
              <select
                aria-label={`Custom rule action type ${idx + 1}`}
                value={rule.actionKind}
                onChange={(e) =>
                  onUpdateRule(idx, {
                    actionKind: e.target.value as ScreenActionKind,
                  })}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors duration-200",
                  isDark
                    ? "border-slate-700 bg-slate-800 text-slate-100 focus:ring-violet-400"
                    : "border-gray-300 bg-white text-gray-900 focus:ring-violet-500",
                )}
              >
                {ALL_SCREEN_ACTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>

              {overriding && (
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
                    isDark
                      ? "bg-amber-950/60 border border-amber-800 text-amber-300"
                      : "bg-amber-100 border border-amber-200 text-amber-800",
                  )}
                  title="Overrides built-in screen-action rule"
                >
                  Overrides default
                </span>
              )}

              <button
                type="button"
                aria-label={`Remove custom rule ${idx + 1}`}
                className={cn(
                  "rounded-md border p-1 text-xs transition-colors duration-200 shrink-0",
                  isDark
                    ? "border-slate-700 bg-slate-800 text-slate-400 hover:text-rose-400 hover:bg-slate-700"
                    : "border-gray-300 bg-white text-gray-500 hover:text-rose-600 hover:bg-gray-50",
                )}
                onClick={() => onRemoveRule(idx)}
                title="Remove rule"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onAddRule}
        className={cn(
          "mt-2 inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors duration-200",
          isDark
            ? "border-violet-800 bg-slate-800/80 text-violet-300 hover:bg-slate-700"
            : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50",
        )}
      >
        <Plus size={12} />
        <span>Add custom rule</span>
      </button>
    </div>
  );
}
