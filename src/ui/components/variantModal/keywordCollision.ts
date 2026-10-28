export const RENPY_CORE_KEYWORDS = [
  "jump",
  "call",
  "return",
  "menu",
  "label",
  "scene",
  "show",
  "hide",
  "play",
  "queue",
  "stop",
  "pause",
  "with",
  "python",
  "init",
  "define",
  "default",
] as const;

export const KEYWORD_COLLISION_REGEXES = RENPY_CORE_KEYWORDS.map((kw) => ({
  keyword: kw,
  regex: new RegExp(`^(?:\\\\s\\*\\\\b|\\^\\\\s\\*|\\^)${kw}\\b`, "i"),
}));

export function checkKeywordCollision(pattern: string): string | null {
  const trimmed = pattern.trim();
  for (const { keyword, regex } of KEYWORD_COLLISION_REGEXES) {
    if (regex.test(trimmed)) {
      return keyword;
    }
  }
  return null;
}
