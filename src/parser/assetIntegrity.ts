/**
 * src/parser/assetIntegrity.ts
 *
 * Cross-references audio cues and visual statements against project media files.
 * Emits `missing_asset` warnings when referenced assets cannot be found.
 */

import type { ParseGraphState, ParseOptions } from "./pipelineTypes.ts";
import { addParseDiagnostic } from "./diagnostics.ts";

const COLOR_HEX_REGEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const BUILTIN_DISPLAYABLES = new Set<string>([
  "black",
  "white",
  "none",
  "transparent",
]);

function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^game\//i, "")
    .trim();
}

function stripAudioTags(asset: string): string {
  // Strip chained Ren'Py audio tags like `<silence 0.5><loop 1.0>audio/bgm.ogg`
  return asset.replace(/^(?:<[^>]+>\s*)+/, "").trim();
}

export function isBuiltinOrColor(asset: string): boolean {
  let trimmed = asset.trim();
  if (trimmed.startsWith("expression ")) {
    trimmed = trimmed.slice(11).trim();
  }
  if (COLOR_HEX_REGEX.test(trimmed)) return true;
  if (BUILTIN_DISPLAYABLES.has(trimmed.toLowerCase())) return true;
  if (
    trimmed.startsWith("Solid(") ||
    trimmed.startsWith("Composite(") ||
    trimmed.startsWith("Transform(") ||
    trimmed.startsWith("Frame(")
  ) {
    return true;
  }
  return false;
}

export function buildProjectMediaIndex(
  projectMediaFiles: NonNullable<ParseOptions["projectMediaFiles"]>,
): {
  exactPaths: Set<string>;
  lowerPaths: Set<string>;
  lowerFilenames: Set<string>;
  lowerStems: Set<string>;
  imageTags: Map<string, string>;
  audioNames: Map<string, string>;
} {
  const exactPaths = new Set<string>();
  const lowerPaths = new Set<string>();
  const lowerFilenames = new Set<string>();
  const lowerStems = new Set<string>();
  const imageTags = new Map<string, string>();
  const audioNames = new Map<string, string>();

  const rawEntries: string[] = [];
  if (projectMediaFiles instanceof Set) {
    for (const f of projectMediaFiles) rawEntries.push(f);
  } else if (Array.isArray(projectMediaFiles)) {
    for (const item of projectMediaFiles) {
      if (typeof item === "string") {
        rawEntries.push(item);
      } else if (item && typeof item.relativePath === "string") {
        rawEntries.push(item.relativePath);
      } else if (item && typeof item.fileName === "string") {
        rawEntries.push(item.fileName);
      }
    }
  }

  for (const raw of rawEntries) {
    const normalized = normalizePath(raw);
    if (!normalized) continue;
    exactPaths.add(normalized);

    const lower = normalized.toLowerCase();
    lowerPaths.add(lower);

    const parts = lower.split("/");
    const fileName = parts[parts.length - 1]!;
    lowerFilenames.add(fileName);

    const dotIndex = fileName.lastIndexOf(".");
    const stem = dotIndex !== -1 ? fileName.slice(0, dotIndex) : fileName;
    lowerStems.add(stem);

    const relStem = dotIndex !== -1
      ? lower.slice(0, lower.lastIndexOf("."))
      : lower;
    lowerStems.add(relStem);

    // Audio namespace: files in audio/ (e.g. audio/explode.ogg -> audio.explode & explode)
    if (lower.startsWith("audio/")) {
      audioNames.set(stem, normalized);
      audioNames.set(`audio.${stem}`, normalized);
      const subPath = lower.slice("audio/".length);
      const subStem = dotIndex !== -1
        ? subPath.slice(0, subPath.lastIndexOf("."))
        : subPath;
      audioNames.set(subStem, normalized);
      audioNames.set(`audio.${subStem}`, normalized);
    }

    // Ren'Py image tag auto-discovery: files in images/
    // e.g. images/bg room.png -> "bg room"
    // e.g. images/bg_room.jpg -> "bg room" & "bg_room"
    // e.g. images/eileen/happy.png -> "eileen happy"
    if (lower.startsWith("images/")) {
      const imgRelative = lower.slice("images/".length);
      const dotIdx = imgRelative.lastIndexOf(".");
      const tagPath = dotIdx !== -1
        ? imgRelative.slice(0, dotIdx)
        : imgRelative;

      const spaceTag = tagPath.replace(/[/_\\]+/g, " ").trim();
      imageTags.set(spaceTag, normalized);
      imageTags.set(tagPath, normalized);
      imageTags.set(stem, normalized);
      imageTags.set(stem.replace(/_/g, " "), normalized);
    }
  }

  return {
    exactPaths,
    lowerPaths,
    lowerFilenames,
    lowerStems,
    imageTags,
    audioNames,
  };
}

export function resolveAssetReference(
  asset: string,
  type: "play" | "stop" | "queue" | "voice" | "scene" | "show" | "image",
  mediaIndex: ReturnType<typeof buildProjectMediaIndex>,
  state: ParseGraphState,
): string | null {
  let cleaned = stripAudioTags(asset).replace(/^["']|["']$/g, "").trim();
  if (!cleaned) return null;

  if (cleaned.startsWith("expression ")) {
    cleaned = cleaned.slice(11).trim().replace(/^["']|["']$/g, "");
  }

  if (isBuiltinOrColor(cleaned)) {
    return cleaned;
  }

  const norm = normalizePath(cleaned);
  const lower = norm.toLowerCase();

  // 1. Direct path / lower path match
  if (mediaIndex.exactPaths.has(norm)) return norm;
  if (mediaIndex.lowerPaths.has(lower)) return lower;

  // 2. Filename or stem match
  if (mediaIndex.lowerFilenames.has(lower)) return lower;
  if (mediaIndex.lowerStems.has(lower)) return lower;

  // 3. Audio cue namespace resolution
  if (
    type === "play" || type === "queue" || type === "voice" || type === "stop"
  ) {
    if (mediaIndex.audioNames.has(lower)) {
      return mediaIndex.audioNames.get(lower)!;
    }
    // Check if defined as init variable: define audio.theme = "music/theme.ogg"
    if (state.initVariables) {
      const varKey = lower.startsWith("audio.") ? lower.slice(6) : lower;
      const initDesc = state.initVariables.get(lower) ??
        state.initVariables.get(`audio.${varKey}`) ??
        state.initVariables.get(varKey);
      if (initDesc && typeof initDesc.value === "string") {
        const resolvedVal = stripAudioTags(initDesc.value).replace(
          /^["']|["']$/g,
          "",
        );
        const innerMatch = resolveAssetReference(
          resolvedVal,
          type,
          mediaIndex,
          state,
        );
        if (innerMatch) return innerMatch;
      }
    }
  }

  // 4. Visual cue image tags resolution
  if (type === "scene" || type === "show" || type === "image") {
    const spaceNormalized = lower.replace(/[/_\\]+/g, " ").trim();
    if (mediaIndex.imageTags.has(spaceNormalized)) {
      return mediaIndex.imageTags.get(spaceNormalized)!;
    }
    if (mediaIndex.imageTags.has(lower)) {
      return mediaIndex.imageTags.get(lower)!;
    }

    // Check declared image definitions: image bg room = "images/bg_room.png"
    if (state.imageDefinitions) {
      const target = state.imageDefinitions.get(cleaned) ??
        state.imageDefinitions.get(spaceNormalized) ??
        state.imageDefinitions.get(lower);
      if (target) {
        if (isBuiltinOrColor(target)) return target;
        const innerMatch = resolveAssetReference(
          target,
          type,
          mediaIndex,
          state,
        );
        if (innerMatch) return innerMatch;
      }
    }
  }

  return null;
}

/**
 * Cross-references audio and visual asset cues against project media files.
 * Emits missing_asset warnings for unresolved assets when project media files are present.
 */
export function verifyAssetIntegrity(
  state: ParseGraphState,
  projectMediaFiles?: NonNullable<ParseOptions["projectMediaFiles"]>,
): void {
  const mediaFiles = projectMediaFiles ?? state.projectMediaFiles;
  if (!mediaFiles) return;

  const count = Array.isArray(mediaFiles)
    ? mediaFiles.length
    : mediaFiles instanceof Set
    ? mediaFiles.size
    : 0;
  if (count === 0) return;

  const mediaIndex = buildProjectMediaIndex(mediaFiles);

  for (const node of state.nodes) {
    if (!node.audioAssetCues || node.audioAssetCues.length === 0) continue;

    for (const cue of node.audioAssetCues) {
      if (cue.type === "stop" && !cue.asset) continue;

      if (isBuiltinOrColor(cue.asset)) {
        cue.isColor = true;
        continue;
      }

      // Handle playlist queues: play music [ "a.ogg", "b.ogg" ]
      if (cue.asset.startsWith("[") && cue.asset.endsWith("]")) {
        const innerMatches = Array.from(
          cue.asset.matchAll(/["']([^"']+)["']|([A-Za-z0-9_./\\]+)/g),
        );
        const innerItems = innerMatches
          .map((m) => m[1] || m[2])
          .filter(
            (s): s is string =>
              Boolean(s) && s !== "[" && s !== "]" && s !== ",",
          );
        let allResolved = true;
        for (const item of innerItems) {
          const resolved = resolveAssetReference(
            item,
            cue.type,
            mediaIndex,
            state,
          );
          if (!resolved) {
            allResolved = false;
            addParseDiagnostic(
              state,
              {
                code: "missing_asset",
                severity: "warning",
                location: {
                  chapter: node.chapter,
                  construct: "asset",
                  sourceId: node.id,
                  sourceLocation: cue.sourceLocation ?? node.sourceLocation,
                  targetExpression: item,
                },
                context: {
                  category: "missing_asset",
                  detail: item,
                },
                message:
                  `Asset "${item}" referenced in ${cue.type} playlist was not found in project media files.`,
                recoveryAction:
                  "Ensure the media file exists in the game/ directory or verify the asset reference.",
              },
              `missing_asset|${cue.type}|${item}|${node.id}|${
                cue.lineNum ?? ""
              }`,
            );
          }
        }
        if (allResolved) {
          cue.resolvedPath = cue.asset;
        } else {
          cue.isMissing = true;
        }
        continue;
      }

      const resolved = resolveAssetReference(
        cue.asset,
        cue.type,
        mediaIndex,
        state,
      );
      if (resolved) {
        cue.resolvedPath = resolved;
      } else {
        cue.isMissing = true;
        addParseDiagnostic(
          state,
          {
            code: "missing_asset",
            severity: "warning",
            location: {
              chapter: node.chapter,
              construct: "asset",
              sourceId: node.id,
              sourceLocation: cue.sourceLocation ?? node.sourceLocation,
              targetExpression: cue.asset,
            },
            context: {
              category: "missing_asset",
              detail: cue.asset,
            },
            message:
              `Asset "${cue.asset}" referenced in ${cue.type} statement was not found in project media files.`,
            recoveryAction:
              "Ensure the media file exists in the game/ directory or verify the asset reference.",
          },
          `missing_asset|${cue.type}|${cue.asset}|${node.id}|${
            cue.lineNum ?? ""
          }`,
        );
      }
    }
  }
}
