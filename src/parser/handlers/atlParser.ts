import { unquoteString } from "./python/pythonAstParser.ts";

export interface AtlExtractedAsset {
  asset: string;
  lineNum?: number;
  raw: string;
}

/**
 * Extracts visual asset dependencies (quoted image filenames, displayable strings)
 * from ATL (Animation & Transformation Language) blocks and transform declarations.
 */
export function extractAtlVisualAssets(blockText: string): AtlExtractedAsset[] {
  const assets: AtlExtractedAsset[] = [];
  const lines = blockText.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    // Check for quoted string literal (e.g. "image_frame_1.png")
    const stringMatch =
      /(?:[rR]|[fF]|[uU])?["']([^"'\n]+(?:\.[a-zA-Z0-9]+)?)["']/.exec(line);
    if (stringMatch) {
      const asset = unquoteString(stringMatch[0]);
      if (asset && !assets.some((a) => a.asset === asset)) {
        assets.push({ asset, lineNum: idx + 1, raw: line });
      }
      continue;
    }

    // Check for `contains` or `child` displayable references (e.g. contains "sparkle", child "star.png")
    const containsMatch = /^\s*(?:contains|child)\s+(.+)$/i.exec(line);
    if (containsMatch) {
      const expr = containsMatch[1]!.split("#")[0]!.trim();
      const unquoted = unquoteString(expr);
      if (unquoted && !assets.some((a) => a.asset === unquoted)) {
        assets.push({ asset: unquoted, lineNum: idx + 1, raw: line });
      }
    }
  }

  return assets;
}
