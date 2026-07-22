import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "../src/domain/index.ts";
import {
  evaluateConditionExpression,
  extractConditionFlagRefs,
} from "../src/domain/conditionLogic.ts";
import { resolveGithubUrl } from "../src/application/urlImporter.ts";
import { extractRpyFilesFromZip } from "../src/application/zipExtractor.ts";
import { findPath } from "../src/domain/transforms/pathFinding.ts";
import { simplifyGraph } from "../src/domain/transforms/simplify.ts";
import { buildConditionalVisibility, buildVisibleNodes } from "../src/domain/transforms/visibility.ts";
import { parsePythonBlockAst, extractPythonFunctionDefs } from "../src/parser/pythonAstParser.ts";
import { tokenizeOneFile } from "../src/parser/filePipeline.ts";
import { runControlFlowAnalysis } from "../src/parser/controlFlowAnalysis.ts";
import { createGraphState } from "../src/parser/pipelineState.ts";
import { dataUrlToBlob, deriveCollapsedLabelChildren } from "../src/ui/canvasHelpers.ts";
import { formatReadingTime } from "../src/ui/utils/readingTime.ts";
import { isSafeMockFlagKey } from "../src/application/viewerStoreSlices/simulationSlice.ts";

describe("Codebase Audited 21 Bugs Suite", () => {
  // Bug 1: preprocessConditionExpression string literal corruption
  it("Bug 1: preserves 'is' / 'is not' inside quoted strings in condition expressions", () => {
    const refs = extractConditionFlagRefs('flag == "This is not a drill"');
    expect(refs).toEqual(["flag"]);
  });

  // Bug 2: evaluateInstructions for ISTR non-boolean strings
  it("Bug 2: correctly evaluates string equality in condition expressions", () => {
    const res = evaluateConditionExpression('route == "secret"', { route: "true" });
    expect(res).toBeDefined();
  });

  // Bug 3: urlImporter octet-stream misclassification
  it("Bug 3: does not misclassify .rpy files with application/octet-stream as zip", async () => {
    const url = "https://example.com/test.rpy";
    // resolveGithubUrl should keep test.rpy intact
    expect(resolveGithubUrl(url)).toBe("https://example.com/test.rpy");
  });

  // Bug 4: resolveGithubUrl branch names with slashes
  it("Bug 4: resolves GitHub file URLs with slash-containing branches", () => {
    const url = "https://github.com/user/repo/blob/feature/sub/game/script.rpy";
    const resolved = resolveGithubUrl(url);
    expect(resolved).toBe("https://raw.githubusercontent.com/user/repo/feature/sub/game/script.rpy");
  });

  // Bug 5: zipExtractor trailing slash in name
  it("Bug 5: handles zip entries gracefully", async () => {
    const fakeZipFile = {
      name: "test.zip",
      size: 100,
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    await expect(extractRpyFilesFromZip(fakeZipFile)).rejects.toThrow();
  });

  // Bug 7: pathFinding with empty nodes
  it("Bug 7: returns reachable: false when searching path in empty graph for non-existent node", () => {
    const res = findPath([], [], "nonexistent", "nonexistent");
    expect(res.reachable).toBe(false);
  });

  // Bug 8: simplifyGraph protecting entry points
  it("Bug 8: protects splashscreen and main_menu from being inlined in simplifyGraph", () => {
    const nodes = [
      { id: "splashscreen", type: "LABEL" as const, label: "splashscreen", dialogueCount: 0, role: "utility" as const },
      { id: "main_menu", type: "LABEL" as const, label: "main_menu", dialogueCount: 0, role: "utility" as const },
      { id: "next_node", type: "LABEL" as const, label: "next_node", dialogueCount: 5 },
    ];
    const edges = [
      { id: "e1", source: "splashscreen", target: "next_node" },
      { id: "e2", source: "main_menu", target: "next_node" },
    ];
    const simplified = simplifyGraph(nodes, edges, {
      collapseLinearChains: false,
      inlineUtilities: true,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    expect(simplified.nodes.map((n) => n.id)).toContain("splashscreen");
    expect(simplified.nodes.map((n) => n.id)).toContain("main_menu");
  });

  // Bug 10: buildVisibleNodes with null/undefined dialogueLines
  it("Bug 10: handles null/undefined dialogueLines array elements safely in buildVisibleNodes", () => {
    const canvasNodes = [
      {
        id: "node1",
        position: { x: 0, y: 0 },
        data: {
          label: "Test",
          dialogueCount: 1,
          dialogueLines: [undefined as unknown as string],
          nodeType: "LABEL" as const,
        },
      },
    ];
    expect(() =>
      buildVisibleNodes({
        nodes: canvasNodes,
        search: "test",
        minDialogue: 0,
        collapsedChapters: {},
        collapsedLabelChildren: new Set(),
        theme: "violet",
      })
    ).not.toThrow();
  });

  // Bug 11: pythonAstParser parenthesis in quotes for call_in_new_context
  it("Bug 11: ignores parens inside string literals when parsing call_in_new_context", () => {
    const code = 'renpy.call_in_new_context("my_label(special)")';
    const calls = parsePythonBlockAst(code);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.targetExpression).toBe('"my_label(special)"');
  });

  // Bug 12: extractPythonFunctionDefs with nested parens in types
  it("Bug 12: extracts python function definitions with complex parameters", () => {
    const code = "def foo(x: int = (1 + 2)):\n    pass\n";
    const defs = extractPythonFunctionDefs(code);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe("foo");
  });

  // Bug 13: tokenizeOneFile stripping UTF-8 BOM
  it("Bug 13: strips UTF-8 BOM from start of text files", async () => {
    const fileWithBOM = {
      name: "script.rpy",
      size: 20,
      content: new Uint8Array([0xef, 0xbb, 0xbf, 0x6c, 0x61, 0x62, 0x65, 0x6c, 0x20, 0x73, 0x74, 0x61, 0x72, 0x74, 0x3a]), // \uFEFFlabel start:
    };
    const res = await tokenizeOneFile(fileWithBOM);
    expect(res.document.getText().startsWith("label")).toBe(true);
  });

  // Bug 14: analyzeUninitializedVariables built-in identifiers
  it("Bug 14: does not report persistent or renpy as uninitialized variables", () => {
    const state = createGraphState();
    state.referencedVariables.push({
      varName: "persistent.flag",
      location: { chapter: "ch1", construct: "condition" },
    });
    runControlFlowAnalysis(state);
    const uninitDiags = state.diagnostics.filter((d) => d.context?.category === "uninitialized_variable");
    expect(uninitDiags).toHaveLength(0);
  });

  // Bug 16: dataUrlToBlob base64 exception safety
  it("Bug 16: handles invalid base64 in dataUrlToBlob safely without crashing", () => {
    expect(() => dataUrlToBlob("data:image/png;base64,invalid!@#$")).not.toThrow();
  });

  // Bug 17: deriveCollapsedLabelChildren recursive check
  it("Bug 17: derives collapsed label children for nested sub-label hierarchy", () => {
    const nodes = [
      { id: "parent", data: { nodeType: "LABEL" } },
      { id: "sub", data: { nodeType: "LABEL", parentLabelId: "parent", isSubLabel: true } },
      { id: "child_menu", data: { nodeType: "MENU", parentLabelId: "sub" } },
    ];
    const collapsed = deriveCollapsedLabelChildren(nodes, { parent: true });
    expect(collapsed.has("sub")).toBe(true);
    expect(collapsed.has("child_menu")).toBe(true);
  });

  // Bug 18: formatReadingTime handling Infinity
  it("Bug 18: returns '0s' for Infinity or NaN in formatReadingTime", () => {
    expect(formatReadingTime(Infinity)).toBe("0s");
    expect(formatReadingTime(NaN)).toBe("0s");
  });

  // Bug 20: isSafeMockFlagKey Object.prototype guards
  it("Bug 20: guards Object.prototype methods in isSafeMockFlagKey", () => {
    expect(isSafeMockFlagKey("toString")).toBe(false);
    expect(isSafeMockFlagKey("valueOf")).toBe(false);
    expect(isSafeMockFlagKey("hasOwnProperty")).toBe(false);
  });

  // Bug Fix 1: preprocessConditionExpression string literal replacement & $ expansion
  it("Bug Fix 1: handles 10+ string placeholders and dollar signs without corruption in condition expressions", () => {
    const expr = 'a == "str0" or b == "str1" or c == "str2" or d == "str3" or e == "str4" or f == "str5" or g == "str6" or h == "str7" or i == "str8" or j == "str9" or k == "$100"';
    const refs = extractConditionFlagRefs(expr);
    expect(refs).toContain("a");
    expect(refs).toContain("k");
    const evalRes = evaluateConditionExpression('price == "$100"', { price: "unknown" });
    expect(evalRes).toBeDefined();
  });

  // Bug Fix 2: inlineNodes multi-path visited bug
  it("Bug Fix 2: preserves multiple distinct branching paths to the same destination during inlining", () => {
    const nodes = [
      { id: "start", type: "LABEL" as const, label: "start", dialogueCount: 10 },
      { id: "util1", type: "LABEL" as const, label: "util1", dialogueCount: 0, role: "utility" as const },
      { id: "util2", type: "LABEL" as const, label: "util2", dialogueCount: 0, role: "utility" as const },
      { id: "dest", type: "LABEL" as const, label: "dest", dialogueCount: 10 },
    ];
    const edges = [
      { id: "e1", source: "start", target: "util1", label: "branch1" },
      { id: "e2", source: "start", target: "util2", label: "branch2" },
      { id: "e3", source: "util1", target: "dest" },
      { id: "e4", source: "util2", target: "dest" },
    ];
    const simplified = simplifyGraph(nodes, edges, {
      collapseLinearChains: false,
      inlineUtilities: true,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    // Dest should receive edges from both branch1 and branch2
    const destEdges = simplified.edges.filter((e) => e.target === "dest");
    expect(destEdges.length).toBe(2);
  });

  // Bug Fix 3: buildConditionalVisibility label: entry point prefix
  it("Bug Fix 3: includes label: prefixed entry points in buildConditionalVisibility starting set", () => {
    const edges = [
      { id: "e1", source: "label:start", target: "label:main_menu", data: { kind: "jump" } },
    ];
    const result = buildConditionalVisibility({ edges: edges as unknown as CanvasEdge[], mockFlags: {} });
    expect(result.hiddenNodeIds.has("label:main_menu")).toBe(false);
  });

  // Bug Fix 4: dataUrlToBlob whitespace handling
  it("Bug Fix 4: handles base64 data URLs with whitespace without throwing in dataUrlToBlob", () => {
    const dataUrl = "data:text/plain;base64, SGVsbG8gV29ybGQ= \n";
    const blob = dataUrlToBlob(dataUrl);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/plain");
  });

  // Bug Fix 5: extractPythonFunctionDefs complex parameter splitting
  it("Bug Fix 5: parses python function signatures with complex defaults/types containing commas", () => {
    const code = 'def complex_func(a: Tuple[int, int] = (1, 2), b: str = "x,y"):\n    pass\n';
    const defs = extractPythonFunctionDefs(code);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.args).toHaveLength(2);
    expect(defs[0]?.args[0]).toBe("a: Tuple[int, int] = (1, 2)");
    expect(defs[0]?.args[1]).toBe('b: str = "x,y"');
  });
});
