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

export function extractSceneAsset(lineText: string): string | null {
  const match = lineText.match(/^\s*scene\s+(.+)$/);
  if (!match) return null;
  let content = match[1].trim();
  if (content.includes("#")) {
    content = content.split("#")[0].trim();
  }
  const paramMatch = content.match(
    /^(.*?)\s*\b(?:with|at|behind|onlayer|zorder)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : content.trim();
  return stripQuotes(asset);
}

export function extractShowAsset(lineText: string): string | null {
  const match = lineText.match(/^\s*show\s+(.+)$/);
  if (!match) return null;
  let content = match[1].trim();
  if (content.includes("#")) {
    content = content.split("#")[0].trim();
  }
  const paramMatch = content.match(
    /^(.*?)\s*\b(?:with|at|behind|onlayer|zorder|as)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : content.trim();
  return stripQuotes(asset);
}

export function extractPlayCue(
  lineText: string,
): { channel: string; asset: string } | null {
  const match = lineText.match(/^\s*play\s+(\w+)\s+(.+)$/);
  if (!match) return null;
  const channel = match[1].trim();
  let rest = match[2].trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
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
  let rest = (match[2] ?? "").trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
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
  let rest = match[2].trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
  const paramMatch = rest.match(
    /^(.*?)\s*\b(?:fadein|fadeout|loop|noloop|volume|if)\b/i,
  );
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return { channel, asset: stripQuotes(asset) };
}

export function extractVoiceCue(lineText: string): string | null {
  const match = lineText.match(/^\s*voice\s+(.+)$/);
  if (!match) return null;
  let rest = match[1].trim();
  if (rest.includes("#")) {
    rest = rest.split("#")[0].trim();
  }
  const paramMatch = rest.match(/^(.*?)\s*\b(?:sustain|volume|if)\b/i);
  const asset = paramMatch ? paramMatch[1].trim() : rest.trim();
  return stripQuotes(asset);
}
