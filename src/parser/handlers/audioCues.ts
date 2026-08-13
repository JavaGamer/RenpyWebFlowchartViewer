/**
 * src/parser/handlers/audioCues.ts
 *
 * String parsing functions for extracting media and scene cues from Ren'Py scripts.
 */

function stripQuotes(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripComment(text: string): string {
  let inQuote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuote) {
      if (char === "\\") {
        i++;
      } else if (char === inQuote) {
        inQuote = null;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === "#") {
      return text.slice(0, i).trim();
    }
  }
  return text.trim();
}

export function extractSceneAsset(lineText: string): string | null {
  const match = lineText.match(/^\s*scene\s+(.+)$/);
  if (!match) return null;
  const content = stripComment(match[1]);
  const paramMatch = content.match(
    /^(.*?)\s*\b(?:with|at|behind|onlayer|zorder)\b/i,
  );
  let asset = paramMatch ? paramMatch[1].trim() : content.trim();
  if (asset.endsWith(":")) {
    asset = asset.slice(0, -1).trim();
  }
  return stripQuotes(asset);
}

function splitAudioClause(
  text: string,
  keywords: string[] = [
    "fadein",
    "fadeout",
    "loop",
    "noloop",
    "volume",
    "if",
    "sustain",
  ],
): string {
  let inDoubleQuotes = false;
  let inSingleQuotes = false;
  let inAngleBracket = false;
  let bracketDepth = 0;

  const keywordPattern = new RegExp(`^(?:${keywords.join("|")})\\b`, "i");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === "<" && !inDoubleQuotes && !inSingleQuotes) {
      inAngleBracket = true;
    } else if (char === ">" && inAngleBracket) {
      inAngleBracket = false;
    } else if (char === "[" && !inDoubleQuotes && !inSingleQuotes) {
      bracketDepth++;
    } else if (
      char === "]" && bracketDepth > 0 && !inDoubleQuotes && !inSingleQuotes
    ) {
      bracketDepth--;
    } else if (
      !inDoubleQuotes && !inSingleQuotes && !inAngleBracket &&
      bracketDepth === 0
    ) {
      if (i === 0 || /\s/.test(text[i - 1]!)) {
        const remaining = text.slice(i);
        if (keywordPattern.test(remaining)) {
          return text.slice(0, i).trim();
        }
      }
    }
  }
  return text.trim();
}

export function extractPlayCue(
  lineText: string,
): { channel: string; asset: string } | null {
  const match = lineText.match(/^\s*play\s+(\w+)\s+(.+)$/);
  if (!match) return null;
  const channel = match[1].trim();
  const rest = stripComment(match[2]);
  const asset = splitAudioClause(rest, [
    "fadein",
    "fadeout",
    "loop",
    "noloop",
    "volume",
    "if",
  ]);
  return { channel, asset: stripQuotes(asset) };
}

export function extractStopCue(
  lineText: string,
): { channel: string; asset?: string } | null {
  const match = lineText.match(/^\s*stop\s+(\w+)(?:\s+(.+))?$/);
  if (!match) return null;
  const channel = match[1].trim();
  const rest = stripComment(match[2] ?? "");
  const asset = splitAudioClause(rest, ["fadeout", "if"]);
  return { channel, asset: stripQuotes(asset) || undefined };
}

export function extractQueueCue(
  lineText: string,
): { channel: string; asset: string } | null {
  const match = lineText.match(/^\s*queue\s+(\w+)\s+(.+)$/);
  if (!match) return null;
  const channel = match[1].trim();
  const rest = stripComment(match[2]);
  const asset = splitAudioClause(rest, [
    "fadein",
    "fadeout",
    "loop",
    "noloop",
    "volume",
    "if",
  ]);
  return { channel, asset: stripQuotes(asset) };
}

export function extractVoiceCue(lineText: string): string | null {
  const match = lineText.match(/^\s*voice\s+(.+)$/);
  if (!match) return null;
  const rest = stripComment(match[1]);
  const asset = splitAudioClause(rest, ["sustain", "volume", "if"]);
  return stripQuotes(asset);
}

export function extractShowAsset(lineText: string): string | null {
  const match = lineText.match(/^\s*show\s+(.+)$/);
  if (!match) return null;
  const content = stripComment(match[1]);
  const paramMatch = content.match(
    /^(.*?)\s*\b(?:with|at|behind|onlayer|zorder|as)\b/i,
  );
  let asset = paramMatch ? paramMatch[1].trim() : content.trim();
  if (asset.endsWith(":")) {
    asset = asset.slice(0, -1).trim();
  }
  return stripQuotes(asset);
}

import { extractAtlVisualAssets } from "./atlParser.ts";

export function extractAtlAssetsFromBlock(
  blockText: string,
): Array<{ asset: string; lineNum?: number; raw: string }> {
  return extractAtlVisualAssets(blockText);
}

export function extractImageAsset(
  lineText: string,
): { name: string; target: string } | null {
  const match = lineText.match(/^\s*image\s+([^=:]+)(?:=\s*(.+)|:.*)?$/);
  if (!match) return null;
  const name = match[1]!.trim();
  const rawTarget = match[2] ? stripComment(match[2]).trim() : "";
  const target = stripQuotes(rawTarget);
  return { name, target };
}
