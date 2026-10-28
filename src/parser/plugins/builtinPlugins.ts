import type { ParserVariantPlugin } from "./types.ts";
import {
  DDLC_DEFAULT_SCREEN_ACTION_RULES,
  RENPY8_EXTENDED_SCREEN_ACTION_RULES,
  RENPY_DEFAULT_SCREEN_ACTION_RULES,
  ST_DEFAULT_SCREEN_ACTION_RULES,
} from "./screenActionRules.ts";

export const ST_PLACEHOLDER_REGEX = /^\s*placeholder(?:\s+wip)?\s*(?:#.*)?$/i;
export const DDLC_TERMINAL_REGEX =
  /^\s*(?:call\s+(?:endgame|gameover)|\$\s*delete_character\b)/i;

export const BUILTIN_PARSER_VARIANT_PLUGINS: readonly ParserVariantPlugin[] = [
  {
    id: "renpy",
    label: "Ren'Py",
    description: "Standard Ren'Py statement and screen-action flow handling.",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
  },
  {
    id: "renpy8",
    label: "Ren'Py 8.x",
    description:
      "Modern Ren'Py 8.x syntax with Python 3 statements, match/case branching, layered images, and extended screen actions.",
    defaultScreenActionRules: [...RENPY8_EXTENDED_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "camera",
      "matrixcolor",
      "gl_color",
      "transform",
      "layeredimage",
      "pause",
      "window",
      "frame",
      "voice",
    ],
    stagingRegex:
      /^(?:camera|matrixcolor|gl_color|transform|layeredimage|pause|window|frame|voice)\s+[A-Za-z_]/i,
    detectionSignatures: [
      /^\s*match\s+[A-Za-z0-9_().]+(?:\s+as\s+[A-Za-z0-9_]+)?\s*:/m,
      /renpy\.version_tuple\s*(?:>=|==|>)\s*\(\s*8\b/,
      /config\.renpy_version\s*=\s*['"]8\./,
      /^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*:[^)]*\)\s*->\s*[A-Za-z_]:/m,
    ],
  },
  {
    id: "st",
    label: "ST",
    description:
      "Extended variant with timed choices, placeholder WIP endpoints, and custom staging directives.",
    defaultScreenActionRules: [
      ...RENPY_DEFAULT_SCREEN_ACTION_RULES,
      ...ST_DEFAULT_SCREEN_ACTION_RULES,
    ],
    stagingKeywords: [
      "swap",
      "morph",
      "clone",
      "body",
      "exspirit",
      "possess",
      "scry",
      "resetstate",
    ],
    stagingRegex:
      /^(?:(?:swap|morph|clone|body|exspirit|possess|scry)\s+[A-Za-z_]|resetstate\b)/i,
    terminalStatements: [
      {
        pattern: ST_PLACEHOLDER_REGEX,
        isTerminalOutcome: true,
        labelHasExplicitExit: true,
      },
    ],
    detectionSignatures: [
      /^\s*(?:\$\s*)?timedchoice\b/im,
      new RegExp(ST_PLACEHOLDER_REGEX.source, "im"),
      /^\s*(?:swap|morph|clone|body|exspirit|possess|scry)\s+[A-Za-z_][A-Za-z0-9_]*/im,
    ],
  },
  {
    id: "ddlc",
    label: "DDLC / DDLC Mods",
    description:
      "Doki Doki Literature Club and DDLC modding framework syntax, poem mini-game calls, console manipulation, and glitch staging.",
    defaultScreenActionRules: [...DDLC_DEFAULT_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "updateconsole",
      "hideconsole",
      "tear",
      "noise",
      "vignette",
      "wipe",
      "s_kill",
      "y_kill",
      "glitch",
    ],
    stagingRegex:
      /^(?:updateconsole|hideconsole|tear|noise|vignette|wipe|s_kill|y_kill|glitch)\b/i,
    terminalStatements: [
      {
        pattern: DDLC_TERMINAL_REGEX,
        isTerminalOutcome: true,
        labelHasExplicitExit: true,
      },
    ],
    detectionSignatures: [
      /^\s*(?:default|define|\$)\s+persistent\.playthrough\b/im,
      /^\s*define\s+audio\.t1\s*=/im,
      /^\s*call\s+updateconsole\b/im,
      /^\s*(?:call\s+poemgame\b|\$\s*mas_wordlist\b|\bMASPoemWordList\b)/im,
      /^\s*\$\s*delete_character\s*\(/im,
    ],
    detectionFilePatterns: [
      /\bscript-ch[0-9]+\.rpy$/i,
      /\bscript-ex[0-9]+\.rpy$/i,
    ],
  },
  {
    id: "mas",
    label: "Monika After Story",
    description:
      "Monika After Story framework with affection tracking, event topics, poem minigame, and custom MAS directives.",
    baseVariant: "ddlc",
    defaultScreenActionRules: [
      ...DDLC_DEFAULT_SCREEN_ACTION_RULES,
      { actionName: "mas_show_poem", actionKind: "call" },
      { actionName: "mas_display_ver", actionKind: "show" },
      { actionName: "mas_open_url", actionKind: "null_action" },
      { actionName: "mas_dialogue", actionKind: "call" },
    ],
    stagingKeywords: [
      "updateconsole",
      "hideconsole",
      "tear",
      "noise",
      "vignette",
      "wipe",
      "s_kill",
      "y_kill",
      "glitch",
      "m_talk",
      "m_idle",
      "mas_reaction",
      "mas_mood",
      "mas_drop_mood",
    ],
    stagingRegex:
      /^(?:updateconsole|hideconsole|tear|noise|vignette|wipe|s_kill|y_kill|glitch|m_talk|m_idle|mas_reaction|mas_mood|mas_drop_mood)\b/i,
    terminalStatements: [
      {
        pattern: DDLC_TERMINAL_REGEX,
        isTerminalOutcome: true,
        labelHasExplicitExit: true,
      },
    ],
    utilityLabelPatterns: [
      /^_mas_/i,
      /^mas_idle_/i,
      /^mas_topic_/i,
      /^mas_o31_/i,
    ],
    variableMutations: [
      {
        pattern: /^\s*\$\s*mas_gainAffection\(\s*([0-9.-]+)\s*\)/i,
        variableName: "mas_affection",
        valueGroup: 1,
        operator: "+=",
        constantValue: 1,
      },
      {
        pattern: /^\s*\$\s*mas_loseAffection\(\s*([0-9.-]+)\s*\)/i,
        variableName: "mas_affection",
        valueGroup: 1,
        operator: "-=",
        constantValue: 1,
      },
    ],
    detectionSignatures: [
      /\bMASPoemWordList\b/i,
      /mas_register_submod\b/i,
      /init\s+5\s+python\s+in\s+mas_/i,
      /\$\s*mas_display_ver\b/i,
      /define\s+mas_affection\b/i,
    ],
    detectionFilePatterns: [
      /\bmas_[A-Za-z0-9_-]+\.rpy$/i,
      /\bsubmods\/.*\.rpy$/i,
    ],
  },
  {
    id: "renpy7",
    label: "Ren'Py 7.x Legacy",
    description:
      "Legacy Ren'Py 7 syntax with Python 2 runtime conventions and Screen Language 1 compatibility.",
    baseVariant: "renpy",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "camera",
      "show",
      "hide",
      "pause",
      "window",
      "frame",
      "with",
      "nvl",
    ],
    stagingRegex:
      /^(?:camera|show|hide|pause|window|frame|with|nvl)\s+[A-Za-z_]/i,
    detectionSignatures: [
      /config\.renpy_version\s*=\s*['"]7\./i,
      /renpy\.version_tuple\s*(?:>=|==|>)\s*\(\s*7\b/i,
      /^\s*init\s+-?[0-9]*\s*python\s*:/m,
    ],
  },
  {
    id: "nvl",
    label: "NVL / Kinetic Novel",
    description:
      "NVL-mode and linear kinetic visual novels with nvl clear/show staging and chapter-focused progression.",
    baseVariant: "renpy",
    defaultScreenActionRules: [...RENPY_DEFAULT_SCREEN_ACTION_RULES],
    stagingKeywords: [
      "nvl",
      "nvl_clear",
      "nvl_show",
      "nvl_window",
      "page",
      "p",
    ],
    stagingRegex: /^(?:nvl|nvl_clear|nvl_show|nvl_window|page|p)\b/i,
    detectionSignatures: [
      /define\s+[A-Za-z0-9_]+\s*=\s*Character\([^)]*kind\s*=\s*nvl/i,
      /^\s*nvl\s+clear\b/im,
      /^\s*nvl\s+show\b/im,
    ],
    detectionFilePatterns: [
      /\bscreens_nvl\.rpy$/i,
      /\bnvl_screens\.rpy$/i,
    ],
  },
] as const;
