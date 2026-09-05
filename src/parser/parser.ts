/**
 * src/parser/parser.ts
 *
 * Client-side Ren'Py script parser.
 */

import pLimit from "p-limit";
import { compareFiles, createPerfTracker } from "../domain/index.ts";
import { createGraphState } from "./pipelineState.ts";
import { preParseInitialization } from "./initMapper.ts";
import { linkGraphFragments, parseFileToFragment } from "./mapReduceLinker.ts";
import { RENPY_TL_PATH_REGEX, scanTranslations } from "./translationScanner.ts";
import type {
  ParseInputFile,
  ParseOptions,
  ParseProgress,
  ParseResult,
} from "./pipelineTypes.ts";

export type { ParseOptions, ParseProgress, ParseResult };

function getMaxParallelFiles(
  requested: number | undefined,
  fileCount: number,
): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return Math.max(1, Math.min(4, fileCount));
  }
  const normalized = Math.floor(requested);
  if (normalized <= 1) return 1;
  return Math.max(1, Math.min(normalized, fileCount));
}

export async function parseRenpyFiles(
  files: ParseInputFile[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  const normalizedFiles = files.map((file) => {
    if (file.content instanceof Uint8Array) {
      return {
        ...file,
        content: new TextDecoder("utf-8").decode(file.content),
      };
    }
    return file;
  });

  const perf = createPerfTracker("parser");
  perf.mark("total");
  const state = createGraphState(options.parserVariant);
  if (options.dynamicJumpRules) {
    state.dynamicJumpRules = options.dynamicJumpRules;
  }
  if (options.maxCallStackDepth !== undefined) {
    state.maxCallStackDepth = options.maxCallStackDepth;
  }

  const mediaFileExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".avif",
    ".gif",
    ".svg",
    ".ogg",
    ".opus",
    ".mp3",
    ".wav",
    ".flac",
    ".webm",
    ".mp4",
  ]);

  const scriptFiles: typeof normalizedFiles = [];
  const translationFiles: typeof normalizedFiles = [];
  const discoveredMediaFiles: string[] = [];

  for (const file of normalizedFiles) {
    const rawPath = file.relativePath ?? file.name;
    const lower = rawPath.toLowerCase();
    const dotIdx = lower.lastIndexOf(".");
    const ext = dotIdx !== -1 ? lower.slice(dotIdx) : "";
    if (mediaFileExtensions.has(ext)) {
      discoveredMediaFiles.push(rawPath);
    } else if (RENPY_TL_PATH_REGEX.test(rawPath)) {
      translationFiles.push(file);
    } else {
      scriptFiles.push(file);
    }
  }

  if (translationFiles.length > 0) {
    const projectTrans = scanTranslations(translationFiles);
    state.translations = projectTrans;
    state.availableLanguages = projectTrans.availableLanguages;
  }

  if (options.projectMediaFiles) {
    state.projectMediaFiles = options.projectMediaFiles;
  } else if (discoveredMediaFiles.length > 0) {
    state.projectMediaFiles = discoveredMediaFiles;
  }

  const orderedFiles = [...scriptFiles].sort(compareFiles);

  perf.mark("pre-parse");
  preParseInitialization(orderedFiles, state);
  perf.measure("pre-parse", "pre_parse_init_ms", {
    files: orderedFiles.length,
  });

  const maxParallelFiles = getMaxParallelFiles(
    options.maxParallelFiles,
    orderedFiles.length,
  );

  let lastYieldTime = performance.now();

  // Pass 1: Parallel Map (Tokenize + Line Token Scan per isolated file)
  const limit = pLimit(maxParallelFiles);
  let completedCount = 0;
  const fragments = await Promise.all(
    orderedFiles.map((file, idx) =>
      limit(async () => {
        if (options.signal?.aborted) {
          throw new DOMException("Parsing cancelled", "AbortError");
        }
        if (performance.now() - lastYieldTime > 16) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          lastYieldTime = performance.now();
        }
        perf.mark(`file:${idx}:map`);
        const fragment = await parseFileToFragment(file, options, state, idx);
        perf.measure(`file:${idx}:map`, "parse_file_map_ms", {
          file: file.name,
        });

        completedCount += 1;
        options.onProgress?.({
          doneFiles: completedCount,
          totalFiles: orderedFiles.length,
          currentFile: file.relativePath ?? file.name,
        });

        return fragment;
      })
    ),
  );

  // Pass 2: Fast Linker (Merge symbol tables, graph fragments, & finalize roles)
  perf.mark("finalize");
  linkGraphFragments(fragments, state, options);
  perf.measure("finalize", "finalize_roles_ms", { nodes: state.nodes.length });
  perf.measure("total", "parse_total_ms", {
    files: orderedFiles.length,
    nodes: state.nodes.length,
    edges: state.edges.length,
  });
  const hasInitVars = Boolean(
    state.initVariables && state.initVariables.size > 0,
  );
  const hasNodeMutations = Boolean(
    state.nodeMutations && state.nodeMutations.size > 0,
  );
  const hasAssets = Boolean(state.assets && state.assets.length > 0);
  const hasDiagnostics = Boolean(
    state.diagnostics && state.diagnostics.length > 0,
  );
  return {
    nodes: state.nodes,
    edges: state.edges,
    ...(hasInitVars ? { initVariables: state.initVariables } : {}),
    ...(hasNodeMutations ? { nodeMutations: state.nodeMutations } : {}),
    ...(hasAssets ? { assets: state.assets } : {}),
    ...(hasDiagnostics ? { diagnostics: state.diagnostics } : {}),
    ...(state.translations ? { translations: state.translations } : {}),
    ...(state.availableLanguages
      ? { availableLanguages: state.availableLanguages }
      : {}),
  };
}
