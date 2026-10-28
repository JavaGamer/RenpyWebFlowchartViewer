import { THEMES } from "../viewerTheme.ts";

export function getTheme(themeName: unknown) {
  if (typeof themeName === "string" && themeName in THEMES) {
    return THEMES[themeName as keyof typeof THEMES];
  }
  return THEMES.violet;
}
