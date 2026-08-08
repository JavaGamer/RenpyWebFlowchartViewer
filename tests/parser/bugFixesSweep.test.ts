import { describe, expect, it } from "vitest";
import { allowsActionExtractionOnLine } from "../../src/parser/handlers/screen/screenActionExtractor.ts";
import { materializeCallReturnEdges } from "../../src/parser/callReturnFinalization.ts";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import {
  parseDictLiteral,
  parseListLiteral,
} from "../../src/parser/handlers/jumpCallHandler.ts";
import type { ParseGraphState } from "../../src/parser/pipelineTypes.ts";
import { MultiDirectedGraph } from "graphology";

describe("Parser Bug Fixes Sweep", () => {
  it("safely handles null keyword in allowsActionExtractionOnLine", () => {
    expect(allowsActionExtractionOnLine(null)).toBe(true);
    expect(allowsActionExtractionOnLine("action")).toBe(true);
    expect(allowsActionExtractionOnLine("default")).toBe(false);
    expect(allowsActionExtractionOnLine("DEFAULT")).toBe(false);
  });

  it("materializes call_return edges for scene-split call targets with returns", () => {
    const graph = new MultiDirectedGraph();
    const state: ParseGraphState = {
      graph,
      nodes: [],
      edges: [],
      nodeIds: new Set(),
      edgeIds: new Set(),
      nodeMap: new Map(),
      edgeMap: new Map(),
      pendingGraphEdgeIds: new Set(),
      menuCounter: 0,
      decisionCounter: 0,
      allLabelIds: new Set(["sub_routine__scene_1", "sub_routine__scene_2"]),
      incomingByLabel: new Map(),
      outgoingByLabel: new Map(),
      hasReturnInLabel: new Set(["sub_routine__scene_2"]),
      hasReliableReturnInLabel: new Set(["sub_routine__scene_2"]),
      calledLabels: new Set(["sub_routine__scene_1"]),
      calledFromMenuOptionTargets: new Set(),
      pendingCallReturns: [
        {
          returnTargetId: "main_label",
          callTargetId: "sub_routine__scene_1",
          callEdgeId: "call_edge_1",
          callContextId: "ctx_1",
        },
      ],
      canonicalLabelIdByName: new Map(),
      labelDefinitionCountByName: new Map(),
      labelsByChapter: new Map(),
      globalLabelVariableLiteralTargets: new Map(),
      globalLabelVariableDictTargets: new Map(),
      globalLabelVariableListTargets: new Map(),
      globalScreens: new Set(),
      globalCharacters: new Set(),
      diagnostics: [],
      diagnosticIds: new Set(),
    };

    materializeCallReturnEdges(state);
    expect(state.edges.length).toBe(1);
    expect(state.edges[0].kind).toBe("call_return");
    expect(state.edges[0].source).toBe("sub_routine__scene_1");
    expect(state.edges[0].target).toBe("main_label");
  });

  it("parses terminal exit statements without emitting fallthrough sequence edges", async () => {
    const script = `
label start:
    "Hello"
    $ renpy.full_restart()

label unreached:
    "End"
`;
    const result = await parseRenpyFiles([{
      name: "script.rpy",
      relativePath: "script.rpy",
      content: script,
    }]);
    const seqEdges = result.edges.filter((e) =>
      e.kind === "sequence" && e.source === "start"
    );
    expect(seqEdges.length).toBe(0);
  });

  it("parses type-annotated dollar assignments and nested define priorities with plus signs", async () => {
    const script = `
init:
    define +5 custom_var = "val"
    $ count: int = 10

label start:
    "Count is 10"
`;
    const result = await parseRenpyFiles(
      [{ name: "script.rpy", relativePath: "script.rpy", content: script }],
      { captureDialogueLines: true },
    );
    expect(result.initVariables?.has("custom_var")).toBe(true);
    expect(result.initVariables?.has("count")).toBe(true);
  });

  it("parses unquoted identifier literals in dict and list literals", () => {
    const dictResult = parseDictLiteral(
      '{ "key1": target_label, "key2": alt_label }',
    );
    expect(dictResult).not.toBeNull();
    expect(dictResult?.get("key1")).toBe("target_label");
    expect(dictResult?.get("key2")).toBe("alt_label");

    const listResult = parseListLiteral("[label_a, label_b, label_c]");
    expect(listResult).not.toBeNull();
    expect(listResult).toEqual(["label_a", "label_b", "label_c"]);
  });
});
