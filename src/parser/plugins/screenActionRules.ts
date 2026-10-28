import type { ScreenActionKind, ScreenActionRule } from "./types.ts";

export const VALID_SCREEN_ACTION_KINDS = new Set<ScreenActionKind>([
  "jump",
  "call",
  "show",
  "hide",
  "set_variable",
  "toggle_variable",
  "confirm",
  "null_action",
  "show_menu",
]);

export function normalizeScreenActionRule(
  rule: ScreenActionRule,
): ScreenActionRule | null {
  const actionName = rule.actionName.trim();
  if (!actionName) return null;
  if (!VALID_SCREEN_ACTION_KINDS.has(rule.actionKind)) return null;
  return { actionName, actionKind: rule.actionKind };
}

export const RENPY_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  { actionName: "Jump", actionKind: "jump" },
  { actionName: "Call", actionKind: "call" },
  { actionName: "Show", actionKind: "show" },
  { actionName: "Hide", actionKind: "hide" },
  { actionName: "ShowMenu", actionKind: "show_menu" },
  { actionName: "SetVariable", actionKind: "set_variable" },
  { actionName: "ToggleVariable", actionKind: "toggle_variable" },
  { actionName: "Confirm", actionKind: "confirm" },
  { actionName: "NullAction", actionKind: "null_action" },
];

export const RENPY8_EXTENDED_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  ...RENPY_DEFAULT_SCREEN_ACTION_RULES,
  { actionName: "Start", actionKind: "jump" },
  { actionName: "Replay", actionKind: "call" },
  { actionName: "EndReplay", actionKind: "jump" },
  { actionName: "MainMenu", actionKind: "jump" },
  { actionName: "ToggleScreen", actionKind: "show" },
  { actionName: "ShowTransient", actionKind: "show" },
  { actionName: "SetField", actionKind: "set_variable" },
  { actionName: "ToggleField", actionKind: "toggle_variable" },
  { actionName: "SetDict", actionKind: "set_variable" },
  { actionName: "ToggleDict", actionKind: "toggle_variable" },
  { actionName: "SetScreenVariable", actionKind: "set_variable" },
  { actionName: "ToggleScreenVariable", actionKind: "toggle_variable" },
  { actionName: "SetLocalVariable", actionKind: "set_variable" },
  { actionName: "ToggleLocalVariable", actionKind: "toggle_variable" },
];

export const ST_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  { actionName: "timedchoice", actionKind: "call" },
  { actionName: "gameover", actionKind: "jump" },
  { actionName: "title", actionKind: "jump" },
  { actionName: "placeholder", actionKind: "jump" },
  { actionName: "routename", actionKind: "jump" },
];

export const DDLC_DEFAULT_SCREEN_ACTION_RULES: ScreenActionRule[] = [
  ...RENPY_DEFAULT_SCREEN_ACTION_RULES,
  { actionName: "MainMenu", actionKind: "jump" },
  { actionName: "Quit", actionKind: "null_action" },
  { actionName: "Start", actionKind: "jump" },
  { actionName: "showpoem", actionKind: "call" },
  { actionName: "poemgame", actionKind: "call" },
];
