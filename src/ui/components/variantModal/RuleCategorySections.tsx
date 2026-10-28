import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import type {
  EndingType,
  MutationOperator,
  SerializableBranchStatementRule,
  SerializableChoiceDirectiveRule,
  SerializableEndingClassificationRule,
  SerializableVariableMutationRule,
} from "../../../config/parserRules.ts";
import { cn } from "../../utils/cn.ts";
import { checkKeywordCollision } from "./keywordCollision.ts";

export interface BranchRulesSectionProps {
  branchStatements: SerializableBranchStatementRule[];
  onAdd: () => void;
  onInsertTemplate: (
    template: "keyword" | "python_jump" | "python_call" | "dynamic",
  ) => void;
  onUpdate: (
    index: number,
    patch: Partial<SerializableBranchStatementRule>,
  ) => void;
  onRemove: (index: number) => void;
  isDark?: boolean;
}

export function BranchRulesSection({
  branchStatements,
  onAdd,
  onInsertTemplate,
  onUpdate,
  onRemove,
  isDark = false,
}: BranchRulesSectionProps) {
  return (
    <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div>
          <span className="font-semibold block">
            Custom Branch Statements (CDS / Macros)
          </span>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Regular expressions that match custom branch commands (e.g.
            &apos;warp&apos;, &apos;goto&apos;) and capture target labels.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
            isDark
              ? "border-violet-800 bg-slate-800 text-violet-300 hover:bg-slate-700"
              : "border-violet-300 bg-white text-violet-700 hover:bg-violet-50",
          )}
        >
          <Plus size={11} />
          <span>Add Rule</span>
        </button>
      </div>

      {/* Pattern Builder Templates */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border bg-gray-50/80 dark:bg-slate-800/40 dark:border-slate-800 mb-2">
        <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400">
          Pattern Builder Templates:
        </span>
        <button
          type="button"
          onClick={() => onInsertTemplate("keyword")}
          className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          + Warp / Goto Keyword
        </button>
        <button
          type="button"
          onClick={() => onInsertTemplate("python_jump")}
          className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          + renpy.jump()
        </button>
        <button
          type="button"
          onClick={() => onInsertTemplate("python_call")}
          className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          + Subroutine Call
        </button>
        <button
          type="button"
          onClick={() => onInsertTemplate("dynamic")}
          className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          + Dynamic Jump
        </button>
      </div>

      <div className="space-y-2">
        {branchStatements.length === 0 && (
          <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
            No custom branch statements defined.
          </p>
        )}

        {branchStatements.map((b, idx) => {
          const collision = checkKeywordCollision(b.pattern);
          return (
            <div
              key={`branch-stmt-${idx}`}
              className="flex flex-col gap-1.5 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Branch pattern ${idx + 1}`}
                  value={b.pattern}
                  onChange={(e) =>
                    onUpdate(idx, {
                      pattern: e.target.value,
                    })}
                  placeholder="Regex: ^\\s*warp\\s+([A-Za-z0-9_]+)"
                  className={cn(
                    "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                    isDark
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-gray-300 text-gray-900",
                  )}
                />
                <select
                  aria-label={`Branch kind ${idx + 1}`}
                  value={b.branchKind}
                  onChange={(e) =>
                    onUpdate(idx, {
                      branchKind: e.target.value as "jump" | "call",
                    })}
                  className={cn(
                    "rounded border px-2 py-1 text-xs",
                    isDark
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-gray-300 text-gray-900",
                  )}
                >
                  <option value="jump">jump</option>
                  <option value="call">call</option>
                </select>
                <label
                  htmlFor={`branch-target-group-${idx}`}
                  className="flex items-center gap-1 text-[11px]"
                >
                  <span>Grp:</span>
                  <input
                    id={`branch-target-group-${idx}`}
                    aria-label={`Branch target group ${idx + 1}`}
                    type="number"
                    min={1}
                    max={9}
                    value={b.targetGroup ?? 1}
                    onChange={(e) =>
                      onUpdate(idx, {
                        targetGroup: parseInt(e.target.value, 10) || 1,
                      })}
                    className={cn(
                      "w-12 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                      isDark
                        ? "bg-slate-900 border-slate-700 text-slate-100"
                        : "bg-white border-gray-300 text-gray-900",
                    )}
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Remove branch statement ${idx + 1}`}
                  onClick={() => onRemove(idx)}
                  className="p-1 text-gray-400 hover:text-rose-500"
                  title="Remove branch statement"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {collision && (
                <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>
                    Notice: Pattern matches core Ren&apos;Py keyword
                    &apos;{collision}&apos;. Ensure this does not
                    unintentionally shadow native syntax.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ChoiceDirectivesSectionProps {
  choiceDirectives: SerializableChoiceDirectiveRule[];
  onAdd: () => void;
  onUpdate: (
    index: number,
    patch: Partial<SerializableChoiceDirectiveRule>,
  ) => void;
  onRemove: (index: number) => void;
  isDark?: boolean;
}

export function ChoiceDirectivesSection({
  choiceDirectives,
  onAdd,
  onUpdate,
  onRemove,
  isDark = false,
}: ChoiceDirectivesSectionProps) {
  return (
    <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div>
          <span className="font-semibold block">
            Timed & Custom Choice Directives
          </span>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Special choice directives (e.g. timedchoice, timed_menu) that
            present choices with optional timer expiration targets.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
            isDark
              ? "border-amber-800 bg-slate-800 text-amber-300 hover:bg-slate-700"
              : "border-amber-300 bg-white text-amber-700 hover:bg-amber-50",
          )}
        >
          <Plus size={11} />
          <span>Add Directive</span>
        </button>
      </div>

      <div className="space-y-2">
        {choiceDirectives.length === 0 && (
          <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
            No custom choice directives defined.
          </p>
        )}
        {choiceDirectives.map((c, idx) => (
          <div
            key={`choice-dir-${idx}`}
            className="flex flex-col gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                placeholder={"Trigger Regex (e.g. ^\\s*custom_timer\\s*\\(\\s*([0-9.]+)\\s*,\\s*['\"]([A-Za-z0-9_]+)['\"]\\s*\\))"}
                value={c.pattern}
                onChange={(e) =>
                  onUpdate(idx, {
                    pattern: e.target.value,
                  })}
                className={cn(
                  "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                  isDark
                    ? "bg-slate-900 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="p-1 text-gray-400 hover:text-rose-500"
                title="Remove directive"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-gray-500 dark:text-slate-400">
                Target Group:
              </span>
              <input
                type="number"
                min={1}
                value={c.targetGroup ?? 1}
                onChange={(e) =>
                  onUpdate(idx, {
                    targetGroup: parseInt(e.target.value, 10) || 1,
                  })}
                className={cn(
                  "w-14 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                  isDark
                    ? "bg-slate-900 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
              <span className="text-gray-500 dark:text-slate-400">
                Duration Group:
              </span>
              <input
                type="number"
                min={0}
                value={c.durationGroup ?? ""}
                onChange={(e) =>
                  onUpdate(idx, {
                    durationGroup: e.target.value
                      ? parseInt(e.target.value, 10)
                      : undefined,
                  })}
                placeholder="opt"
                className={cn(
                  "w-14 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                  isDark
                    ? "bg-slate-900 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.isTimeout ?? true}
                  onChange={(e) =>
                    onUpdate(idx, {
                      isTimeout: e.target.checked,
                    })}
                  className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-gray-600 dark:text-slate-300">
                  Timeout Edge
                </span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface VariableMutationsSectionProps {
  variableMutations: SerializableVariableMutationRule[];
  onAdd: () => void;
  onUpdate: (
    index: number,
    patch: Partial<SerializableVariableMutationRule>,
  ) => void;
  onRemove: (index: number) => void;
  isDark?: boolean;
}

export function VariableMutationsSection({
  variableMutations,
  onAdd,
  onUpdate,
  onRemove,
  isDark = false,
}: VariableMutationsSectionProps) {
  return (
    <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div>
          <span className="font-semibold block">
            Custom Variable Mutation Macros
          </span>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Statements that alter state/variables (e.g. gain_karma 5,
            flag_toggle).
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
            isDark
              ? "border-cyan-800 bg-slate-800 text-cyan-300 hover:bg-slate-700"
              : "border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50",
          )}
        >
          <Plus size={11} />
          <span>Add Mutation</span>
        </button>
      </div>

      <div className="space-y-2">
        {variableMutations.length === 0 && (
          <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
            No custom variable mutations defined.
          </p>
        )}

        {variableMutations.map((m, idx) => (
          <div
            key={`var-mut-${idx}`}
            className="flex flex-col gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                placeholder="Regex (e.g. ^\s*gain_affinity\s+([A-Za-z0-9_]+)\s+(\d+))"
                value={m.pattern}
                onChange={(e) =>
                  onUpdate(idx, {
                    pattern: e.target.value,
                  })}
                className={cn(
                  "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                  isDark
                    ? "bg-slate-900 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="p-1 text-gray-400 hover:text-rose-500"
                title="Remove mutation"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-gray-500 dark:text-slate-400">
                Target Var:
              </span>
              <input
                placeholder="e.g. affinity"
                value={m.variableName ?? ""}
                onChange={(e) =>
                  onUpdate(idx, {
                    variableName: e.target.value,
                  })}
                className={cn(
                  "w-28 rounded border px-2 py-0.5 text-xs font-mono",
                  isDark
                    ? "bg-slate-900 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
              <span className="text-gray-500 dark:text-slate-400">
                Operator:
              </span>
              <select
                value={m.operator ?? "="}
                onChange={(e) =>
                  onUpdate(idx, {
                    operator: e.target.value as MutationOperator,
                  })}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs font-mono",
                  isDark
                    ? "bg-slate-900 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              >
                <option value="=">= (assign)</option>
                <option value="+=">+= (add)</option>
                <option value="-=">-= (subtract)</option>
                <option value="*=">*= (multiply)</option>
                <option value="/=">/= (divide)</option>
                <option value="%=">%= (modulo)</option>
              </select>
              <span className="text-gray-500 dark:text-slate-400">
                Value Group:
              </span>
              <input
                type="number"
                min={0}
                placeholder="e.g. 2"
                value={m.valueGroup ?? ""}
                onChange={(e) =>
                  onUpdate(idx, {
                    valueGroup: e.target.value
                      ? parseInt(e.target.value, 10)
                      : undefined,
                  })}
                className={cn(
                  "w-14 rounded border px-1.5 py-0.5 text-xs text-center font-mono",
                  isDark
                    ? "bg-slate-900 border-slate-700 text-slate-100"
                    : "bg-white border-gray-300 text-gray-900",
                )}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface EndingRulesSectionProps {
  endingRules: SerializableEndingClassificationRule[];
  onAdd: () => void;
  onUpdate: (
    index: number,
    patch: Partial<SerializableEndingClassificationRule>,
  ) => void;
  onRemove: (index: number) => void;
  isDark?: boolean;
}

export function EndingRulesSection({
  endingRules,
  onAdd,
  onUpdate,
  onRemove,
  isDark = false,
}: EndingRulesSectionProps) {
  return (
    <div className="pt-2 border-t border-gray-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div>
          <span className="font-semibold block">
            Ending Classification Rules
          </span>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Explicitly tag endpoints as Good, Bad, True, Normal, Dead End, or
            Custom endings based on label naming or patterns.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors",
            isDark
              ? "border-emerald-800 bg-slate-800 text-emerald-300 hover:bg-slate-700"
              : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50",
          )}
        >
          <Plus size={11} />
          <span>Add Ending Rule</span>
        </button>
      </div>

      <div className="space-y-2">
        {endingRules.length === 0 && (
          <p className="text-[11px] italic text-gray-400 dark:text-slate-500 py-1">
            No ending classification rules defined.
          </p>
        )}

        {endingRules.map((r, idx) => (
          <div
            key={`ending-rule-${idx}`}
            className="flex flex-wrap items-center gap-2 p-2 rounded-lg border bg-gray-50 dark:bg-slate-800/60 dark:border-slate-700 text-[11px]"
          >
            <select
              value={r.endingType}
              onChange={(e) =>
                onUpdate(idx, {
                  endingType: e.target.value as EndingType,
                })}
              className={cn(
                "rounded border px-2 py-1 text-xs font-semibold",
                isDark
                  ? "bg-slate-900 border-slate-700 text-slate-100"
                  : "bg-white border-gray-300 text-gray-900",
              )}
            >
              <option value="good">Good Ending</option>
              <option value="bad">Bad Ending</option>
              <option value="true">True Ending</option>
              <option value="normal">Normal Ending</option>
              <option value="dead_end">Dead End</option>
              <option value="custom">Custom Ending</option>
            </select>
            <input
              placeholder="Regex Pattern (e.g. _good$|_happy$)"
              value={r.pattern}
              onChange={(e) =>
                onUpdate(idx, {
                  pattern: e.target.value,
                })}
              className={cn(
                "flex-1 min-w-44 rounded border px-2 py-1 text-xs font-mono",
                isDark
                  ? "bg-slate-900 border-slate-700 text-slate-100"
                  : "bg-white border-gray-300 text-gray-900",
              )}
            />
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className="p-1 text-gray-400 hover:text-rose-500"
              title="Remove ending rule"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
