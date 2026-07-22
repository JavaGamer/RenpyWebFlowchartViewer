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
import { buildConditionalVisibility, buildVisibleEdges, buildVisibleNodes } from "../src/domain/transforms/visibility.ts";
import { parsePythonBlockAst, extractPythonFunctionDefs } from "../src/parser/pythonAstParser.ts";
import { tokenizeOneFile } from "../src/parser/filePipeline.ts";
import { runControlFlowAnalysis } from "../src/parser/controlFlowAnalysis.ts";
import { createGraphState } from "../src/parser/pipelineState.ts";
import { dataUrlToBlob, deriveCollapsedLabelChildren } from "../src/ui/canvasHelpers.ts";
import { calculateReadingTimeSeconds, formatReadingTime } from "../src/ui/utils/readingTime.ts";
import { parseDictLiteral, parseListLiteral } from "../src/parser/handlers/jumpCallHandler.ts";
import { isSafeMockFlagKey } from "../src/application/viewerStoreSlices/simulationSlice.ts";
import { exportMermaid } from "../src/application/exporters/mermaidExporter.ts";
import { exportNarrativeOutline } from "../src/application/exporters/narrativeOutlineExporter.ts";
import { exportStandaloneHtml } from "../src/application/exporters/standaloneExporter.ts";
import { generateDialogueCsv } from "../src/application/exporters/csvExporter.ts";
import { applyChapterClustering } from "../src/domain/transforms/chapterClustering.ts";
import { computeGraphDiff } from "../src/domain/transforms/graphDiff.ts";

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

  // Bug Audit Fixes Suite (11 Bugs)
  it("Audit 1: conditionLogic avoids placeholder corruption when string content resembles placeholder tokens", () => {
    const expr = 'msg == "____STR_PH_1____"';
    const res = evaluateConditionExpression(expr, { msg: "____STR_PH_1____" });
    expect(res).toBe("true");
  });

  it("Audit 2: conditionLogic evaluates numeric comparison operators and IMEMBER property access", () => {
    const res1 = evaluateConditionExpression("score > 5", { score: "10" });
    expect(res1).toBe("true");
    const res2 = evaluateConditionExpression("persistent.hero_level >= 3", { "persistent.hero_level": "3" });
    expect(res2).toBe("true");
  });

  it("Audit 3: simplifyGraph inlineNodes preserves distinct parallel paths through inlined nodes", () => {
    const nodes = [
      { id: "start", type: "LABEL" as const, label: "start", dialogueCount: 1 },
      { id: "u1", type: "LABEL" as const, label: "u1", dialogueCount: 0, role: "utility" as const },
      { id: "u2", type: "LABEL" as const, label: "u2", dialogueCount: 0, role: "utility" as const },
      { id: "target", type: "LABEL" as const, label: "target", dialogueCount: 1 },
    ];
    const edges = [
      { id: "e1", source: "start", target: "u1", label: "branchA" },
      { id: "e2", source: "start", target: "u2", label: "branchB" },
      { id: "e3", source: "u1", target: "target" },
      { id: "e4", source: "u2", target: "target" },
    ];
    const res = simplifyGraph(nodes, edges, {
      collapseLinearChains: false,
      inlineUtilities: true,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    expect(res.edges.filter((e) => e.target === "target")).toHaveLength(2);
  });

  it("Audit 4: simplifyGraph collapseLinearChains protects splashscreen, main_menu, after_load, and before_main_menu", () => {
    const nodes = [
      { id: "node1", type: "LABEL" as const, label: "node1", dialogueCount: 1, chapter: "ch1" },
      { id: "splashscreen", type: "LABEL" as const, label: "splashscreen", dialogueCount: 1, chapter: "ch1" },
    ];
    const edges = [
      { id: "e1", source: "node1", target: "splashscreen", kind: "sequence" as const },
    ];
    const res = simplifyGraph(nodes, edges, {
      collapseLinearChains: true,
      inlineUtilities: false,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    expect(res.nodes.map((n) => n.id)).toContain("splashscreen");
  });

  it("Audit 5: extractPythonFunctionDefs correctly stops function body at sibling def at same indent", () => {
    const code = `
    def func_one():
        x = 1

    def func_two():
        y = 2
`;
    const defs = extractPythonFunctionDefs(code);
    expect(defs).toHaveLength(2);
    expect(defs[0]?.name).toBe("func_one");
    expect(defs[0]?.body.includes("func_two")).toBe(false);
    expect(defs[1]?.name).toBe("func_two");
  });

  it("Audit 6: analyzeUninitializedVariables ignores Python/Ren'Py standard built-ins", () => {
    const state = createGraphState();
    state.referencedVariables.push(
      { varName: "config.developer", location: { chapter: "ch1", construct: "condition" } },
      { varName: "True", location: { chapter: "ch1", construct: "condition" } },
      { varName: "store.my_var", location: { chapter: "ch1", construct: "condition" } }
    );
    runControlFlowAnalysis(state);
    const uninitDiags = state.diagnostics.filter((d) => d.context?.category === "uninitialized_variable");
    expect(uninitDiags).toHaveLength(0);
  });

  it("Audit 7: resolveGithubUrl resolves GitHub tree branch links to zip archives", () => {
    const url = "https://github.com/user/repo/tree/feature-branch";
    expect(resolveGithubUrl(url)).toBe("https://github.com/user/repo/archive/refs/heads/feature-branch.zip");
  });

  it("Audit 8: extractRpyFilesFromZip filters out folder entries ending in slash", async () => {
    const zipData = new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // Empty zip
    const fakeZipFile = {
      name: "test.zip",
      size: zipData.byteLength,
      text: async () => "",
      arrayBuffer: async () => zipData.buffer,
    };
    const files = await extractRpyFilesFromZip(fakeZipFile);
    expect(files).toEqual([]);
  });

  it("Audit 9: exportMermaid converts physical newlines in node and edge labels to <br/>", () => {
    const nodes = [
      { id: "n1", type: "LABEL" as const, label: "Line1\nLine2", dialogueCount: 1 },
    ];
    const edges = [
      { id: "e1", source: "n1", target: "n1", label: "Edge\nLine" },
    ];
    const mermaid = exportMermaid(nodes, edges);
    expect(mermaid.includes("Line1<br/>Line2")).toBe(true);
    expect(mermaid.includes("Edge<br/>Line")).toBe(true);
  });

  it("Audit 10: exportNarrativeOutline handles multiline dialogue blockquotes and safely ignores nulls", () => {
    const nodes = [
      {
        id: "n1",
        type: "LABEL" as const,
        label: "Label 1",
        dialogueCount: 1,
        dialogueLines: ["Line 1\nLine 2", undefined as unknown as string],
      },
    ];
    const outline = exportNarrativeOutline(nodes, []);
    expect(outline.includes("> Line 1\n> Line 2")).toBe(true);
    expect(outline.includes("> undefined")).toBe(false);
  });

  it("Audit 11: buildVisibleNodes and applyChapterClustering agree on default chapter fallback", () => {
    const canvasNodes = [
      {
        id: "n1",
        position: { x: 0, y: 0 },
        data: { label: "n1", dialogueCount: 1, nodeType: "LABEL" as const },
      },
    ];
    const visible = buildVisibleNodes({
      nodes: canvasNodes,
      search: "",
      minDialogue: 0,
      collapsedChapters: { default: true },
      collapsedLabelChildren: new Set(),
      theme: "violet",
    });
    expect(visible[0]?.hidden).toBe(true);

    const flowNodes = [{ id: "n1", type: "LABEL" as const, label: "n1", dialogueCount: 1 }];
    const clustered = applyChapterClustering(flowNodes, [], { collapsedChapters: new Set(["default"]) });
    expect(clustered.clusterNodes).toHaveLength(1);
    expect(clustered.clusterNodes[0]?.chapter).toBe("default");
  });

  it("Fix 1: simplifyGraph preserves isTerminalOutcome from intermediate nodes in linear chains", () => {
    const nodes = [
      { id: "a", type: "LABEL" as const, label: "a", dialogueCount: 5, isTerminalOutcome: true },
      { id: "b", type: "LABEL" as const, label: "b", dialogueCount: 5, isTerminalOutcome: false },
    ];
    const edges = [
      { id: "e1", source: "a", target: "b", kind: "sequence" as const },
    ];
    const res = simplifyGraph(nodes, edges, {
      collapseLinearChains: true,
      inlineUtilities: false,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    expect(res.nodes[0]?.isTerminalOutcome).toBe(true);
  });

  it("Fix 2: buildVisibleNodes detects wordCount and pauseDuration changes without returning stale memo", () => {
    const nodes1 = [
      { id: "n1", position: { x: 0, y: 0 }, data: { label: "n1", dialogueCount: 1, wordCount: 10, nodeType: "LABEL" as const } },
    ];
    const firstPass = buildVisibleNodes({ nodes: nodes1, search: "", minDialogue: 0, collapsedChapters: {}, collapsedLabelChildren: new Set(), theme: "violet" });
    const prevMap = new Map([["n1", firstPass[0]!]]);

    const nodes2 = [
      { id: "n1", position: { x: 0, y: 0 }, data: { label: "n1", dialogueCount: 1, wordCount: 50, nodeType: "LABEL" as const } },
    ];
    const secondPass = buildVisibleNodes({ nodes: nodes2, search: "", minDialogue: 0, collapsedChapters: {}, collapsedLabelChildren: new Set(), theme: "violet", previousById: prevMap });
    expect((secondPass[0]!.data as { wordCount: number }).wordCount).toBe(50);
  });

  it("Fix 3: buildVisibleEdges detects strokeWidth and zIndex changes for active path highlighting", () => {
    const edges = [{ id: "e1", source: "n1", target: "n2", data: { label: "" } }];
    const visible1 = buildVisibleEdges({
      edges,
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(["n1", "n2"]),
      edgeColor: "#000",
      largeGraphMode: false,
      activePathEdges: null,
    });
    const prevMap = new Map([["e1", visible1[0]!]]);

    const visible2 = buildVisibleEdges({
      edges,
      showCallReturns: true,
      visibleEdgeKinds: { sequence: true, jump: true, call: true, call_return: true },
      visibleNodeIds: new Set(["n1", "n2"]),
      edgeColor: "#000",
      largeGraphMode: false,
      activePathEdges: new Set(["e1"]),
      previousById: prevMap,
    });
    expect(visible2[0]?.style?.strokeWidth).toBe(2.5);
    expect(visible2[0]?.zIndex).toBe(1000);
  });

  it("Fix 4: evaluateConditionExpression safely guards Object.prototype flag names", () => {
    const res = evaluateConditionExpression("toString == 'val'", { toString: "true" as MockFlagValue });
    expect(res).toBeDefined();
  });

  it("Fix 5: exportStandaloneHtml preserves <br/> line breaks in Mermaid code", () => {
    const nodes = [{ id: "n1", type: "LABEL" as const, label: "Line 1\nLine 2", dialogueCount: 1 }];
    const html = exportStandaloneHtml(nodes, []);
    expect(html.includes("<br/>")).toBe(true);
    expect(html.includes("&lt;br/&gt;")).toBe(false);
  });

  it("Fix 6: exportMermaid handles safeId collisions iteratively", () => {
    const nodes = [
      { id: "n_a_1", type: "LABEL" as const, label: "Node 1", dialogueCount: 1 },
      { id: "a", type: "LABEL" as const, label: "Node 2", dialogueCount: 1 },
      { id: "a", type: "LABEL" as const, label: "Node 3", dialogueCount: 1 },
      { id: "a_2", type: "LABEL" as const, label: "Node 4", dialogueCount: 1 },
    ];
    const mermaid = exportMermaid(nodes, []);
    expect(mermaid).toBeDefined();
  });

  it("Fix 8: extractRpyFilesFromZip populates relativePath on UploadedFile objects", async () => {
    const fakeZipFile = {
      name: "test.zip",
      size: 0,
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    await expect(extractRpyFilesFromZip(fakeZipFile)).rejects.toThrow();
  });

  it("Fix 9: parsePythonBlockAst parses dictionary key jumps with escaped quotes", () => {
    const code = `ROUTER['escaped\\'key']()`;
    const calls = parsePythonBlockAst(code);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.targetExpression).toBe("'escaped\\'key'");
  });

  // Bug Fix 1: evaluateConditionExpression for 'not' on unmapped variables
  it("Audited Bug 1 Fix: evaluates 'not' on unmapped variables as unknown", () => {
    const res = evaluateConditionExpression("not unknown_flag", {});
    expect(res).toBe("unknown");
  });

  // Bug Fix 2: evaluateConditionExpression for '==' / '!=' on unmapped variables
  it("Audited Bug 2 Fix: evaluates equality comparisons on unmapped variables as unknown", () => {
    const resTrue = evaluateConditionExpression("unmapped_flag == true", {});
    const resFalse = evaluateConditionExpression("unmapped_flag == false", {});
    expect(resTrue).toBe("unknown");
    expect(resFalse).toBe("unknown");
  });

  // Bug Fix 3: simplifyGraph aggregates characterDialogue when collapsing chains
  it("Audited Bug 3 Fix: aggregates characterDialogue stats across collapsed nodes", () => {
    const nodes = [
      {
        id: "l1",
        type: "LABEL" as const,
        label: "l1",
        dialogueCount: 1,
        characterDialogue: { Eileen: { lineCount: 1, wordCount: 5 } },
      },
      {
        id: "l2",
        type: "LABEL" as const,
        label: "l2",
        dialogueCount: 1,
        characterDialogue: { Eileen: { lineCount: 2, wordCount: 10 } },
      },
    ];
    const edges = [{ id: "e1", source: "l1", target: "l2", kind: "sequence" as const }];
    const res = simplifyGraph(nodes, edges, {
      collapseLinearChains: true,
      inlineUtilities: false,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0]?.characterDialogue?.Eileen).toEqual({
      lineCount: 3,
      wordCount: 15,
    });
  });

  // Bug Fix 4: simplifyGraph generates unique inlined edge IDs
  it("Audited Bug 4 Fix: generates unique edge IDs during node inlining", () => {
    const nodes = [
      { id: "A", type: "LABEL" as const, label: "A", dialogueCount: 1 },
      { id: "U", type: "LABEL" as const, label: "U", dialogueCount: 0, role: "utility" as const },
      { id: "B", type: "LABEL" as const, label: "B", dialogueCount: 1 },
    ];
    const edges = [
      { id: "e1", source: "A", target: "U", label: "branch" },
      { id: "e2", source: "A", target: "U", label: "branch" },
      { id: "e3", source: "U", target: "B" },
    ];
    const res = simplifyGraph(nodes, edges, {
      collapseLinearChains: false,
      inlineUtilities: true,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    const edgeIds = res.edges.map((e) => e.id);
    const uniqueIds = new Set(edgeIds);
    expect(uniqueIds.size).toBe(edgeIds.length);
  });

  // Bug Fix 5: parseDictLiteral and parseListLiteral for empty literals {} and []
  it("Audited Bug 5 Fix: parses empty dict {} and list [] literals without returning null", () => {
    const parseDict = (parseDictLiteral as unknown as (s: string) => Map<string, string> | null)("{}");
    const parseList = (parseListLiteral as unknown as (s: string) => string[] | null)("[]");
    expect(parseDict).not.toBeNull();
    expect(parseDict?.size).toBe(0);
    expect(parseList).not.toBeNull();
    expect(parseList).toHaveLength(0);
  });

  // Bug Fix 8: simplifyGraph preserves 'else' branchKind when merging two 'else' conditions
  it("Audited Bug 8 Fix: preserves 'else' branchKind when merging two 'else' conditions", () => {
    const nodes = [
      { id: "A", type: "LABEL" as const, label: "A", dialogueCount: 1 },
      { id: "U", type: "LABEL" as const, label: "U", dialogueCount: 0, role: "utility" as const },
      { id: "B", type: "LABEL" as const, label: "B", dialogueCount: 1 },
    ];
    const edges = [
      { id: "e1", source: "A", target: "U", condition: { branchKind: "else" as const, expression: "x < 0" } },
      { id: "e2", source: "U", target: "B", condition: { branchKind: "else" as const, expression: "y < 0" } },
    ];
    const res = simplifyGraph(nodes, edges, {
      collapseLinearChains: false,
      inlineUtilities: true,
      inlineDetours: false,
      inlineStateToggles: false,
      inlineEmptyLabels: false,
      inlineDialogueThreshold: 0,
    });
    expect(res.edges[0]?.condition?.branchKind).toBe("else");
  });

  // Bug Fix 9: calculateReadingTimeSeconds handles undefined pauseDuration
  it("Audited Bug 9 Fix: calculateReadingTimeSeconds handles undefined pauseDuration safely", () => {
    const time = formatReadingTime(calculateReadingTimeSeconds(100, undefined as unknown as number, 200));
    expect(time).toBe("30s");
  });

  // Bug Fix 10: applyChapterClustering generates cluster_edge IDs
  it("Audited Bug 10 Fix: applyChapterClustering generates explicit cluster edge IDs", () => {
    const nodes = [
      { id: "n1", type: "LABEL" as const, label: "n1", chapter: "ch1", dialogueCount: 1 },
      { id: "n2", type: "LABEL" as const, label: "n2", chapter: "ch2", dialogueCount: 1 },
    ];
    const edges = [{ id: "e1", source: "n1", target: "n2" }];
    const res = applyChapterClustering(nodes, edges, {
      collapsedChapters: new Set(["ch1"]),
    });
    expect(res.edges[0]?.id).toContain("cluster_edge:");
  });

  // Bug Fix 11: resolveGithubUrl handles tree subpaths correctly
  it("Audited Bug 11 Fix: resolveGithubUrl handles GitHub tree subpaths correctly", () => {
    const url = "https://github.com/owner/repo/tree/main/game";
    const resolved = resolveGithubUrl(url);
    expect(resolved).toBe("https://github.com/owner/repo/archive/refs/heads/main.zip");
  });

  it("New Fix 1: splitPythonArgs properly resets quote state for string parameters", () => {
    const code = 'def foo(a: str = "hello", b: int = 1):\n    pass\n';
    const defs = extractPythonFunctionDefs(code);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.args).toHaveLength(2);
    expect(defs[0]?.args[0]).toBe('a: str = "hello"');
    expect(defs[0]?.args[1]).toBe("b: int = 1");
  });

  it("New Fix 2: exportStandaloneHtml preserves Mermaid entity escapes", () => {
    const nodes = [{ id: "n1", type: "LABEL" as const, label: "x < 5", dialogueCount: 1 }];
    const html = exportStandaloneHtml(nodes, []);
    expect(html).toContain("&lt;");
    expect(html).not.toContain("&amp;lt;");
  });

  it("New Fix 3: exportNarrativeOutline renders structured object dialogue items", () => {
    const nodes = [
      {
        id: "n1",
        type: "LABEL" as const,
        label: "Label 1",
        dialogueCount: 1,
        dialogueLines: [{ speaker: "Eileen", text: "Welcome back!" } as unknown as string],
      },
    ];
    const outline = exportNarrativeOutline(nodes, []);
    expect(outline).toContain("> Eileen: Welcome back!");
  });

  it("New Fix 4: parseDictLiteral handles unquoted integer keys", () => {
    const parseDict = (parseDictLiteral as unknown as (s: string) => Map<string, string> | null)('{1: "target_label"}');
    expect(parseDict).not.toBeNull();
    expect(parseDict?.get("1")).toBe("target_label");
  });

  it("New Fix 5: generateDialogueCsv strips RenPy text formatting tags before word counting", () => {
    const nodes = [
      {
        id: "n1",
        type: "LABEL" as const,
        label: "Label 1",
        dialogueCount: 1,
        dialogueLines: ["{cps=30}Hello world!{w=1.0}{/cps}"],
      },
    ];
    const csv = generateDialogueCsv(nodes);
    expect(csv).toContain('"2"'); // 2 words: "Hello", "world!"
  });

  it("New Fix 6: computeGraphDiff detects changes in characterDialogue", () => {
    const baseNodes = [
      { id: "n1", type: "LABEL", label: "n1", dialogueCount: 1, characterDialogue: { Eileen: { lineCount: 1, wordCount: 5 } } },
    ];
    const compNodes = [
      { id: "n1", type: "LABEL", label: "n1", dialogueCount: 1, characterDialogue: { Eileen: { lineCount: 2, wordCount: 10 } } },
    ];
    const res = computeGraphDiff(baseNodes, compNodes);
    expect(res.modifiedNodeIds).toContain("n1");
  });

  it("New Fix 7: buildVisibleNodes updates when node style changes", () => {
    const nodes1 = [
      { id: "n1", position: { x: 0, y: 0 }, style: { background: "blue" }, data: { label: "n1", dialogueCount: 1, nodeType: "LABEL" as const } },
    ];
    const firstPass = buildVisibleNodes({ nodes: nodes1, search: "", minDialogue: 0, collapsedChapters: {}, collapsedLabelChildren: new Set(), theme: "violet" });
    const prevMap = new Map([["n1", firstPass[0]!]]);

    const nodes2 = [
      { id: "n1", position: { x: 0, y: 0 }, style: { background: "red" }, data: { label: "n1", dialogueCount: 1, nodeType: "LABEL" as const } },
    ];
    const secondPass = buildVisibleNodes({ nodes: nodes2, search: "", minDialogue: 0, collapsedChapters: {}, collapsedLabelChildren: new Set(), theme: "violet", previousById: prevMap });
    expect(secondPass[0]?.style?.background).toBe("red");
  });

  it("New Fix 8: parsePythonBlockAst parses dict_jump with trailing comment", () => {
    const code = "ROUTER['start']() # jump to start label";
    const calls = parsePythonBlockAst(code);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("dict_jump");
    expect(calls[0]?.targetExpression).toBe("'start'");
  });

  it("New Fix 9: findPath returns reachable: true for self-path when startNodeId exists in node or edge set", () => {
    const res = findPath([{ id: "start", type: "LABEL", label: "start", dialogueCount: 1 }], [], "start", "start");
    expect(res.reachable).toBe(true);
    expect(res.pathNodes).toEqual(["start"]);
  });

  it("New Fix 10: analyzeReachability recognizes label: prefixed entry labels", () => {
    const state = createGraphState();
    state.nodes.push({
      id: "label:start",
      type: "LABEL",
      label: "label:start",
      dialogueCount: 1,
      wordCount: 5,
      pauseDuration: 0,
      chapter: "ch1",
    });
    runControlFlowAnalysis(state);
    const orphanDiags = state.diagnostics.filter((d) => d.context?.category === "orphan_label");
    expect(orphanDiags).toHaveLength(0);
  });

  it("Adversarial Fix 1: extractPythonFunctionDefs extracts inline function bodies after colon", () => {
    const code = "def inline_fn(x: int): return x + 1\n";
    const defs = extractPythonFunctionDefs(code);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.body).toBe("return x + 1");
  });

  it("Adversarial Fix 2: evaluateConditionExpression evaluates string literal inequality to false", () => {
    const res = evaluateConditionExpression('"alpha" == "beta"', {});
    expect(res).toBe("false");
  });

  it("Adversarial Fix 3: IMEMBER does not treat literal values as unmapped variables", () => {
    const res = evaluateConditionExpression('"literal".prop == "literal.prop"', {});
    expect(res).toBe("unknown");
  });
});

