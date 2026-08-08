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

export function extractPlayCue(
  lineText: string,
): { channel: string; asset: string } | null {
  const match = lineText.match(/^\s*play\s+(\w+)\s+(.+)$/);
  if (!match) return null;
  const channel = match[1].trim();
  const rest = stripComment(match[2]);
  const paramMatch = rest.match(
    /^(.*?)\s*\b(?:fadein|fadeout|loop|noloop|volume|if)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return { channel, asset: stripQuotes(asset) };
}

export function extractStopCue(
  lineText: string,
): { channel: string; asset?: string } | null {
  const match = lineText.match(/^\s*stop\s+(\w+)(?:\s+(.+))?$/);
  if (!match) return null;
  const channel = match[1].trim();
  const rest = stripComment(match[2] ?? "");
  const paramMatch = rest.match(/^(.*?)\s*\b(?:fadeout|if)\b/i);
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return { channel, asset: stripQuotes(asset) || undefined };
}

export function extractQueueCue(
  lineText: string,
): { channel: string; asset: string } | null {
  const match = lineText.match(/^\s*queue\s+(\w+)\s+(.+)$/);
  if (!match) return null;
  const channel = match[1].trim();
  const rest = stripComment(match[2]);
  const paramMatch = rest.match(
    /^(.*?)\s*\b(?:fadein|fadeout|loop|noloop|volume|if)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return { channel, asset: stripQuotes(asset) };
}

export function extractVoiceCue(lineText: string): string | null {
  const match = lineText.match(/^\s*voice\s+(.+)$/);
  if (!match) return null;
  const rest = stripComment(match[1]);
  const paramMatch = rest.match(/^(.*?)\s*\b(?:sustain|volume|if)\b/i);
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return stripQuotes(asset);
}
