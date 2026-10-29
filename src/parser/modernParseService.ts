/**
 * src/parser/modernParseService.ts
 *
 * Modern Story Graph Parsing Engine.
 * Cleanly wraps AST parsing and Story Graph Building into the
 * ParseResult contract for seamless integration.
 */

import { compareFiles } from "../domain/sortUtils.ts";
import type {
  ParseInputFile,
  ParseOptions,
  ParseResult,
} from "./pipelineTypes.ts";
import { parseRenpyScript } from "./ast/index.ts";
import { buildStoryGraph, linkProjectGraphs } from "./graph/index.ts";

export async function parseRenpyFilesModern(
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

  const scriptFiles = normalizedFiles.filter((f) => {
    const rawPath = f.relativePath ?? f.name;
    return rawPath.toLowerCase().endsWith(".rpy");
  });

  const orderedFiles = [...scriptFiles].sort(compareFiles);

  const fragments = orderedFiles.map((file, idx) => {
    const filePath = file.relativePath ?? file.name;
    const content = typeof file.content === "string" ? file.content : "";
    const ast = parseRenpyScript(content, filePath);
    const fragment = buildStoryGraph(ast);

    options.onProgress?.({
      doneFiles: idx + 1,
      totalFiles: orderedFiles.length,
      currentFile: filePath,
    });

    return fragment;
  });

  const linked = linkProjectGraphs(fragments);

  return {
    nodes: linked.nodes,
    edges: linked.edges,
  };
}
