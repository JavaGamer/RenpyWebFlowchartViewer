/**
 * src/parser/modernParseService.ts
 *
 * Modern Story Graph Parsing Engine.
 * Cleanly wraps AST parsing and Story Graph Building into the
 * ParseResult contract for seamless integration.
 */

import {
  compareFiles,
  type FlowAsset,
  type NodeDetailsPayload,
  type ProjectTranslations,
  type VariableMutation,
} from "../domain/index.ts";
import type {
  ParseGraphState,
  ParseInputFile,
  ParseOptions,
  ParseResult,
} from "./pipelineTypes.ts";
import { parseRenpyScript, type ScreenStatementAst } from "./ast/index.ts";
import { buildStoryGraph, linkProjectGraphs } from "./graph/index.ts";
import { RENPY_TL_PATH_REGEX, scanTranslations } from "./translationScanner.ts";
import { verifyAssetIntegrity } from "./assetIntegrity.ts";

export async function parseRenpyFilesModern(
  files: ParseInputFile[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  if (options.signal?.aborted) {
    throw new DOMException("Parsing cancelled", "AbortError");
  }

  if (files.length === 0) {
    return { nodes: [], edges: [] };
  }

  const normalizedFiles = files.map((file) => {
    if (file.content instanceof Uint8Array) {
      return {
        ...file,
        content: new TextDecoder("utf-8").decode(file.content),
      };
    }
    return file;
  });

  const translationFiles = normalizedFiles.filter((f) => {
    const rawPath = f.relativePath ?? f.name;
    return RENPY_TL_PATH_REGEX.test(rawPath);
  });

  let translations: ProjectTranslations | undefined;
  let availableLanguages: string[] | undefined;
  if (translationFiles.length > 0) {
    translations = scanTranslations(translationFiles);
    availableLanguages = translations.availableLanguages;
  }

  const scriptFiles = normalizedFiles.filter((f) => {
    const rawPath = f.relativePath ?? f.name;
    return rawPath.toLowerCase().endsWith(".rpy") &&
      !RENPY_TL_PATH_REGEX.test(rawPath);
  });

  const orderedFiles = [...scriptFiles].sort(compareFiles);

  // Pass 1: Parse ASTs and collect all global screens
  const parsedAsts = orderedFiles.map((file) => {
    const filePath = file.relativePath ?? file.name;
    const content = typeof file.content === "string" ? file.content : "";
    return parseRenpyScript(content, filePath, {
      parserVariant: options.parserVariant,
    });
  });

  const allScreens = new Map<string, ScreenStatementAst>();
  for (const ast of parsedAsts) {
    for (const stmt of ast.statements) {
      if (stmt.kind === "screen") {
        allScreens.set(stmt.name, stmt);
      }
    }
  }

  // Pass 2: Build graph fragments
  const fragments = parsedAsts.map((ast, idx) => {
    if (options.signal?.aborted) {
      throw new DOMException("Parsing cancelled", "AbortError");
    }
    const fragment = buildStoryGraph(ast, {
      screens: allScreens,
      parserVariant: options.parserVariant,
      screenActionRules: options.screenActionRules,
      captureDialogueLines: options.captureDialogueLines,
      deferDetails: options.deferDetails,
      pruneDeadEndDecisions: options.pruneDeadEndDecisions,
      dynamicJumpRules: options.dynamicJumpRules,
    });

    options.onProgress?.({
      doneFiles: idx + 1,
      totalFiles: orderedFiles.length,
      currentFile: ast.file,
    });

    return fragment;
  });

  const linked = linkProjectGraphs(fragments, {
    dynamicJumpRules: options.dynamicJumpRules,
    parserVariant: options.parserVariant,
    maxCallStackDepth: options.maxCallStackDepth,
  });

  if (options.projectMediaFiles) {
    if (!linked.diagnostics) linked.diagnostics = [];
    const integrityState = {
      nodes: linked.nodes,
      diagnostics: linked.diagnostics,
      diagnosticIds: new Set<string>(),
      imageDefinitions: linked.imageDefinitions ?? new Map<string, string>(),
      initVariables: linked.initVariables,
    };
    verifyAssetIntegrity(
      integrityState as unknown as ParseGraphState,
      options.projectMediaFiles,
    );
  }

  const nodeMutations = new Map<string, VariableMutation[]>();
  for (const node of linked.nodes) {
    if (node.mutations && node.mutations.length > 0) {
      nodeMutations.set(node.id, [...node.mutations]);
    }
  }

  const nodeDetails = new Map<string, NodeDetailsPayload>();
  for (const frag of fragments) {
    if (frag.nodeDetails) {
      for (const [id, payload] of frag.nodeDetails) {
        nodeDetails.set(id, payload);
      }
    }
  }

  const assets: FlowAsset[] = [];
  const assetMap = new Map<string, FlowAsset>();
  for (const node of linked.nodes) {
    if (node.audioAssetCues) {
      for (const cue of node.audioAssetCues) {
        let type: FlowAsset["type"] = "audio";
        if (cue.type === "scene") {
          type = "scene";
        } else if (cue.type === "show" || cue.type === "image") {
          type = "image";
        }
        let cleanName = (cue.asset || "").trim().replace(/:$/, "").trim();
        if (type === "scene" || type === "image") {
          const withIdx = cleanName.indexOf(" with ");
          if (withIdx !== -1) {
            cleanName = cleanName.slice(0, withIdx).trim();
          }
        }
        if (cleanName) {
          const key = `${type}:${cleanName}`;
          let existing = assetMap.get(key);
          if (!existing) {
            existing = { name: cleanName, type, nodeIds: [] };
            assetMap.set(key, existing);
            assets.push(existing);
          }
          if (existing.nodeIds && !existing.nodeIds.includes(node.id)) {
            existing.nodeIds.push(node.id);
          }
        }
      }
    }
  }

  return {
    nodes: linked.nodes,
    edges: linked.edges,
    ...(linked.initVariables && linked.initVariables.size > 0
      ? { initVariables: linked.initVariables }
      : {}),
    ...(assets.length > 0 ? { assets } : {}),
    ...(nodeMutations.size > 0 ? { nodeMutations } : {}),
    ...(nodeDetails.size > 0 ? { nodeDetails } : {}),
    diagnostics: linked.diagnostics ?? [],
    ...(translations ? { translations, availableLanguages } : {}),
    ...(options.parserVariant
      ? { detectedVariant: options.parserVariant, autoDetected: false }
      : {}),
  };
}
