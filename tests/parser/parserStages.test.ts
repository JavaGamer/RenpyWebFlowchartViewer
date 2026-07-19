import { describe, expect, it } from "vitest";
import { analyzeTokenMeta } from "../../src/parser/tokenMeta";
import { PARSER_TOKENS } from "../../src/parser/parserTokens";
import {
  createGraphState,
  createScanState,
} from "../../src/parser/pipelineState";
import { finalizeRoles } from "../../src/parser/roleFinalization";
import {
  addIncoming,
  addNode,
  addOutgoing,
} from "../../src/parser/graphMutations";
import { handleToken } from "../../src/parser/tokenHandling";
import { materializeCallReturnEdges } from "../../src/parser/callReturnFinalization";
import { classifyNodeRole } from "../../src/parser/roleClassification";
import { normalizeGraphState } from "../../src/parser/graphNormalization";
import {
  processFlatToken,
  processFlatTokens,
  processTokenTreeStream,
} from "../../src/parser/tokenScanStage";
import { maybeUpdateConditionalState } from "../../src/parser/scanTransitions";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Tokenizer } from "@renpy/ast/out/tokenizer/tokenizer";

describe("parser stage modules", () => {
  it("analyzes token meta flags correctly", () => {
    const flags = analyzeTokenMeta([
      PARSER_TOKENS.metaMenuStatement,
      PARSER_TOKENS.metaMenuOption,
      PARSER_TOKENS.metaCallStatement,
    ]);
    expect(flags.menuDepth).toBe(1);
    expect(flags.hasMenuStatement).toBe(true);
    expect(flags.hasMenuOption).toBe(true);
    expect(flags.hasCallStatement).toBe(true);
    expect(flags.hasJumpStatement).toBe(false);
  });

  it("finalizes menu node role as menu", () => {
    const state = createGraphState();
    addNode(state, {
      id: "menu_1",
      type: "MENU",
      label: "menu_1",
      dialogueCount: 0,
      chapter: "ch",
      parentLabelId: "start",
    });
    finalizeRoles(state);
    expect(state.nodes[0]?.role).toBe("menu");
  });

  it("token handler resets scan waits when label keyword is observed", () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: "start",
      currentLabelIndent: 0,
      labelVariableLiteralTargets: new Map<string, string>(),
      menuStack: [{ id: "menu_1", optionText: null as string | null }],
      pendingMenuFallthroughIds: [],
      conditionalIndentStack: [2],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: true,
      waitForJumpExpressionTarget: false,
      waitForCallTarget: true,
      waitForMenuNameForId: "menu_1",
    };

    handleToken(state, scanState, {
      type: PARSER_TOKENS.kwLabel,
      meta: {
        menuDepth: 0,
        hasLabelStatement: true,
        hasMenuStatement: false,
        hasMenuBlock: false,
        hasMenuOption: false,
        hasMenuOptionBlock: false,
        hasJumpStatement: false,
        hasCallStatement: false,
        hasPythonBlock: false,
        hasScreenBlock: false,
        hasSayNarrator: false,
        hasSayCharacter: false,
        hasSayStatement: false,
      },
      val: () => "",
      chapter: "ch",
      menuDepth: 0,
      lineIndent: 0,
      captureDialogueLines: true,
      screenActionRuleMap: new Map(),
    });

    expect(scanState.waitForLabelName).toBe(true);
    expect(scanState.waitForJumpTarget).toBe(false);
    expect(scanState.waitForCallTarget).toBe(false);
    expect(scanState.waitForMenuNameForId).toBeNull();
    expect(scanState.menuStack).toHaveLength(0);
    expect(scanState.conditionalIndentStack).toHaveLength(0);
  });

  it("materializes call return edges from pending call-return pairs", () => {
    const state = createGraphState();
    state.pendingCallReturns.push({
      returnTargetId: "caller",
      callTargetId: "callee",
    });
    state.hasReliableReturnInLabel.add("callee");

    materializeCallReturnEdges(state);

    expect(state.edges).toContainEqual(
      expect.objectContaining({
        id: "ret_callee__caller",
        source: "callee",
        target: "caller",
        kind: "call_return",
        label: "return",
      }),
    );
  });

  it("classifies utility role for called labels with return and no story traffic", () => {
    const state = createGraphState();
    addNode(state, {
      id: "util_label",
      type: "LABEL",
      label: "util_label",
      dialogueCount: 0,
      chapter: "ch",
    });
    state.calledLabels.add("util_label");
    state.hasReturnInLabel.add("util_label");

    const node = state.nodes[0]!;
    expect(classifyNodeRole(state, node)).toBe("utility");
  });

  it("classifies story role when sequence traffic exists", () => {
    const state = createGraphState();
    addNode(state, {
      id: "story_label",
      type: "LABEL",
      label: "story_label",
      dialogueCount: 0,
      chapter: "ch",
    });
    addOutgoing(state, "story_label", "sequence");
    addIncoming(state, "story_label", "sequence");
    state.hasReturnInLabel.add("story_label");
    state.calledLabels.add("story_label");

    const node = state.nodes[0]!;
    expect(classifyNodeRole(state, node)).toBe("story");
  });

  it("records sequence traffic indexes when adding menu sequence edge", () => {
    const state = createGraphState();
    addNode(state, {
      id: "start",
      type: "LABEL",
      label: "start",
      dialogueCount: 0,
      chapter: "ch",
    });
    const scanState = {
      currentLabelId: "start",
      currentLabelIndent: 0,
      labelVariableLiteralTargets: new Map<string, string>(),
      menuStack: [],
      pendingMenuFallthroughIds: [],
      conditionalIndentStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: false,
      waitForJumpExpressionTarget: false,
      waitForCallTarget: false,
      waitForMenuNameForId: null as string | null,
    };

    handleToken(state, scanState, {
      type: PARSER_TOKENS.kwMenuObserved,
      meta: {
        menuDepth: 1,
        hasLabelStatement: false,
        hasMenuStatement: true,
        hasMenuBlock: true,
        hasMenuOption: false,
        hasMenuOptionBlock: false,
        hasJumpStatement: false,
        hasCallStatement: false,
        hasPythonBlock: false,
        hasScreenBlock: false,
        hasSayNarrator: false,
        hasSayCharacter: false,
        hasSayStatement: false,
      },
      val: () => "menu",
      chapter: "ch",
      menuDepth: 1,
      lineIndent: 4,
      captureDialogueLines: true,
      screenActionRuleMap: new Map(),
    });

    expect(state.outgoingByLabel.get("start")?.has("sequence")).toBe(true);
    expect(state.incomingByLabel.get("menu_1")?.has("sequence")).toBe(true);
  });

  it("processFlatToken delegates conditional updates and token handling", () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: null as string | null,
      currentLabelIndent: null as number | null,
      labelVariableLiteralTargets: new Map<string, string>(),
      menuStack: [],
      pendingMenuFallthroughIds: [],
      conditionalIndentStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: true,
      waitForJumpExpressionTarget: false,
      waitForCallTarget: true,
      waitForMenuNameForId: "menu_1",
    };
    const doc = TextDocument.create("file://t.rpy", "rpy", 1, "label start:\n");

    processFlatToken(
      state,
      scanState,
      {
        type: PARSER_TOKENS.kwLabel,
        metaTokens: [PARSER_TOKENS.metaLabelStatement],
        startPos: { line: 0, character: 0 },
        getValue: () => "label",
      },
      doc,
      "ch",
      true,
      new Map(),
    );

    expect(scanState.waitForLabelName).toBe(true);
    expect(scanState.waitForJumpTarget).toBe(false);
    expect(scanState.waitForCallTarget).toBe(false);
    expect(scanState.waitForMenuNameForId).toBeNull();
  });

  it("tracks conditional header transitions for decision-context parsing", () => {
    const scanState = {
      currentLabelId: "start",
      currentLabelIndent: 0,
      labelVariableLiteralTargets: new Map<string, string>(),
      menuStack: [],
      pendingMenuFallthroughIds: [],
      conditionalIndentStack: [],
      pendingConditionalHeader: null,
      conditionalDecisionStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: false,
      waitForJumpExpressionTarget: false,
      waitForCallTarget: false,
      waitForMenuNameForId: null as string | null,
    };

    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.kwConditional,
      () => "if",
      4,
      "if flag_a:  # inline",
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "if",
      indent: 4,
      expression: "flag_a",
    });

    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.kwConditional,
      () => "if",
      4,
      'if route_map["a:b"] == {"k": "v:1"}: jump branch_a',
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "if",
      indent: 4,
      expression: 'route_map["a:b"] == {"k": "v:1"}',
    });

    const multilineGroupedHeader = [
      "if (",
      '    route_map["a:b"] == {"k": "v:1"},  # comment with ) , : tokens',
      "    guard_flag,",
      ") and fallback_ready:",
    ].join("\n");
    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.kwConditional,
      () => "if",
      4,
      multilineGroupedHeader,
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "if",
      indent: 4,
      expression: [
        "(",
        '    route_map["a:b"] == {"k": "v:1"},  # comment with ) , : tokens',
        "    guard_flag,",
        ") and fallback_ready",
      ].join("\n"),
    });

    const multilineBackslashHeader = [
      "elif route_a and \\",
      "    route_b:  # trailing comment with ) , :",
    ].join("\n");
    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.kwConditional,
      () => "elif",
      4,
      multilineBackslashHeader,
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "elif",
      indent: 4,
      expression: ["route_a and \\", "    route_b"].join("\n"),
    });

    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.kwConditional,
      () => "if",
      4,
      "if ([flag)]:",
    );
    expect(scanState.pendingConditionalHeader).toBeNull();

    scanState.conditionalDecisionStack.push({
      indent: 4,
      decisionNodeId: "decision_1",
      sourceId: "start",
      branchKind: "if",
      expression: "flag_a",
      references: ["flag_a"],
    });
    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.kwConditional,
      () => "elif",
      4,
      "elif flag_b:  # inline",
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "elif",
      indent: 4,
      expression: "flag_b",
    });
    expect(scanState.conditionalDecisionStack).toHaveLength(1);

    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.kwConditional,
      () => "else",
      4,
      "else:  # fallback",
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "else",
      indent: 4,
      expression: null,
    });

    maybeUpdateConditionalState(
      scanState,
      PARSER_TOKENS.entityFunctionName,
      () => "jump",
      4,
      "jump branch",
    );
    expect(scanState.conditionalDecisionStack).toHaveLength(0);
  });

  it("builds multiline logical conditional headers from physical lines in token scan stage", () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: "start",
      currentLabelIndent: 0,
      labelVariableLiteralTargets: new Map<string, string>(),
      menuStack: [],
      pendingMenuFallthroughIds: [],
      conditionalIndentStack: [],
      pendingConditionalHeader: null,
      conditionalDecisionStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: false,
      waitForJumpExpressionTarget: false,
      waitForCallTarget: false,
      waitForMenuNameForId: null as string | null,
    };
    const doc = TextDocument.create(
      "file://conditional-multiline.rpy",
      "rpy",
      1,
      [
        "if (",
        '    route_map["a:b"] == {"k": "v:1"},  # comment with ) , :',
        "    guard_flag,",
        "):",
        "    pass",
        "elif route_a and \\",
        "    route_b:  # trailing comment with ) , :",
        "    pass",
        "",
      ].join("\n"),
    );
    const lineIndentCache = new Map<number, number>();
    const lineTextCache = new Map<number, string>();
    const conditionalLogicalLineCache = new Map<number, string>();

    processFlatToken(
      state,
      scanState,
      {
        type: PARSER_TOKENS.kwConditional,
        metaTokens: [],
        startPos: { line: 0, character: 0 },
        getValue: () => "if",
      },
      doc,
      "ch",
      true,
      lineIndentCache,
      lineTextCache,
      conditionalLogicalLineCache,
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "if",
      indent: 0,
      expression: [
        "(",
        '    route_map["a:b"] == {"k": "v:1"},  # comment with ) , :',
        "    guard_flag,",
        ")",
      ].join("\n"),
    });

    processFlatToken(
      state,
      scanState,
      {
        type: PARSER_TOKENS.kwConditional,
        metaTokens: [],
        startPos: { line: 5, character: 0 },
        getValue: () => "elif",
      },
      doc,
      "ch",
      true,
      lineIndentCache,
      lineTextCache,
      conditionalLogicalLineCache,
    );
    expect(scanState.pendingConditionalHeader).toEqual({
      kind: "elif",
      indent: 0,
      expression: ["route_a and \\", "    route_b"].join("\n"),
    });
  });

  it("processFlatTokens processes token stream in order", () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: null as string | null,
      currentLabelIndent: null as number | null,
      labelVariableLiteralTargets: new Map<string, string>(),
      menuStack: [],
      pendingMenuFallthroughIds: [],
      conditionalIndentStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: false,
      waitForJumpExpressionTarget: false,
      waitForCallTarget: false,
      waitForMenuNameForId: null as string | null,
    };
    const doc = TextDocument.create("file://t.rpy", "rpy", 1, "label start:\n");

    processFlatTokens(
      state,
      scanState,
      [
        {
          type: PARSER_TOKENS.kwLabel,
          metaTokens: [PARSER_TOKENS.metaLabelStatement],
          startPos: { line: 0, character: 0 },
          getValue: () => "label",
        },
        {
          type: PARSER_TOKENS.entityFunctionName,
          metaTokens: [PARSER_TOKENS.metaLabelStatement],
          startPos: { line: 0, character: 6 },
          getValue: () => "start",
        },
      ],
      doc,
      "ch",
    );

    expect(state.nodeMap.has("start")).toBe(true);
    expect(scanState.currentLabelId).toBe("start");
  });

  it("processTokenTreeStream processes token tree without flattening", async () => {
    const state = createGraphState();
    const scanState = {
      currentLabelId: null as string | null,
      currentLabelIndent: null as number | null,
      labelVariableLiteralTargets: new Map<string, string>(),
      menuStack: [],
      pendingMenuFallthroughIds: [],
      conditionalIndentStack: [],
      labelHasExplicitExit: false,
      waitForLabelName: false,
      waitForJumpTarget: false,
      waitForJumpExpressionTarget: false,
      waitForCallTarget: false,
      waitForMenuNameForId: null as string | null,
    };
    const script = [
      "label start:",
      '    "hello"',
      "",
      "label next:",
      "    jump start",
      "",
    ].join("\n");
    const doc = TextDocument.create("file://t.rpy", "rpy", 1, script);
    const tokenTree = await Tokenizer.tokenizeDocument(doc);

    processTokenTreeStream(state, scanState, tokenTree, doc, "ch");

    expect(state.nodeMap.has("start")).toBe(true);
    expect(state.nodeMap.has("next")).toBe(true);
    expect(state.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "next",
          target: "start",
          kind: "jump",
        }),
      ]),
    );
  });

  it("normalization rebuilds derived state after dropping duplicate edges", () => {
    const state = createGraphState();
    addNode(state, {
      id: "start",
      type: "LABEL",
      label: "start",
      dialogueCount: 0,
      chapter: "ch",
    });
    addNode(state, {
      id: "next",
      type: "LABEL",
      label: "next",
      dialogueCount: 0,
      chapter: "ch",
    });
    state.edges.push(
      { id: "jump_a", source: "start", target: "next", kind: "jump" },
      { id: "jump_b", source: "start", target: "next", kind: "jump" },
    );
    state.edgeIds.add("jump_a");
    state.edgeIds.add("jump_b");
    state.edgeMap.set("jump_a", state.edges[0]!);
    state.edgeMap.set("jump_b", state.edges[1]!);
    state.outgoingByLabel.set("start", new Set(["jump"]));
    state.incomingByLabel.set("next", new Set(["jump"]));

    normalizeGraphState(state);

    expect(state.edges).toHaveLength(1);
    expect(state.outgoingByLabel.get("start")?.has("jump")).toBe(true);
    expect(state.incomingByLabel.get("next")?.has("jump")).toBe(true);
    expect(state.graph.hasNode("start")).toBe(true);
    expect(state.graph.hasNode("next")).toBe(true);
    expect(state.graph.hasEdge(state.edges[0]!.id)).toBe(true);
    expect(state.pendingGraphEdgeIds.size).toBe(0);
  });

  it("preserves graph edges and parent label links when first scene split remaps label id", async () => {
    const state = createGraphState();
    const scanState = createScanState();
    const script = [
      "label start:",
      "    menu:",
      '        "Pick":',
      '            "inside option 1"',
      '            "inside option 2"',
      '            "inside option 3"',
      "            scene bg beach",
      '            "after split trigger"',
      "",
    ].join("\n");
    const doc = TextDocument.create("file://scene-remap.rpy", "rpy", 1, script);
    const tokenTree = await Tokenizer.tokenizeDocument(doc);

    processTokenTreeStream(
      state,
      scanState,
      tokenTree,
      doc,
      "scene-remap",
      true,
      undefined,
      undefined,
      0,
    );

    const menuNode = state.nodes.find((node) => node.type === "MENU");
    expect(menuNode).toBeDefined();
    expect(menuNode?.parentLabelId).toBe("start__scene_1");
    expect(state.graph.hasNode("start__scene_1")).toBe(true);
    expect(state.graph.hasEdge("seq_start__menu_1")).toBe(true);
    expect(state.graph.hasEdge("seq_menu_1__start__scene_2_Pick")).toBe(true);
  });

  it("normalization trims identifiers and emits a deterministic duplicate-node diagnostic", () => {
    const state = createGraphState();
    addNode(state, {
      id: " start ",
      type: "LABEL",
      label: "start",
      dialogueCount: 0,
      chapter: "ch",
    });
    addNode(state, {
      id: "start",
      type: "LABEL",
      label: "start_duplicate",
      dialogueCount: 0,
      chapter: "ch",
    });
    addNode(state, {
      id: "next",
      type: "LABEL",
      label: "next",
      dialogueCount: 0,
      chapter: "ch",
    });
    state.edges.push({
      id: "jump_start__next",
      source: " start ",
      target: " next ",
      kind: "jump",
    });

    normalizeGraphState(state);

    expect(state.nodes.map((node) => node.id)).toEqual(["start", "next"]);
    expect(state.edges).toEqual([
      expect.objectContaining({
        source: "start",
        target: "next",
        kind: "jump",
      }),
    ]);
    expect(state.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "normalization",
          context: expect.objectContaining({
            category: "duplicate_node",
            detail: "start",
          }),
        }),
      ]),
    );
    expect(
      state.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "normalization" &&
          diagnostic.context?.category === "duplicate_node",
      ),
    ).toHaveLength(1);
  });
});
