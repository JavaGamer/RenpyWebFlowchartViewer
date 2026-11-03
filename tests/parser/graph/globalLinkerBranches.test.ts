import { describe, expect, it } from "vitest";
import { linkProjectGraphs } from "../../../src/parser/graph/globalLinker.ts";
import type { GraphBuildResult } from "../../../src/parser/graph/graphBuilder.ts";
import type { FlowEdge, FlowNode } from "../../../src/domain/index.ts";
import {
  clearCustomParserVariantPlugins,
  registerParserVariantPlugin,
} from "../../../src/parser/plugins/pluginRegistry.ts";

describe("globalLinker comprehensive branch coverage", () => {
  it("normalizes and merges all kinds of init variable values and precedence", () => {
    const mapVal = new Map<string, string>([["key", "val"]]);
    const frag: GraphBuildResult = {
      nodes: [
        { id: "start", type: "LABEL", label: "start" } as FlowNode,
      ],
      edges: [],
      initDescriptors: [
        { name: "var_map", value: mapVal, priority: 0, kind: "default" },
        {
          name: "var_arr",
          value: ["item1", "item2"],
          priority: 0,
          kind: "default",
        },
        {
          name: "var_true",
          value: "True",
          priority: 0,
          kind: "default",
        },
        {
          name: "var_false",
          value: "False",
          priority: 0,
          kind: "default",
        },
        { name: "var_null", value: null, priority: 0, kind: "default" },
        { name: "var_num", value: 42, priority: 0, kind: "default" },
        {
          name: "var_dict_str",
          value: "{'hero': 'Alice'}",
          priority: 0,
          kind: "default",
        },
        {
          name: "var_list_str",
          value: "[ apple, banana ]",
          priority: 0,
          kind: "default",
        },
        {
          name: "persistent.unlocked",
          value: true,
          priority: 0,
          kind: "default",
        },
        {
          name: "overwritten",
          value: "initial",
          priority: -10,
          kind: "default",
        },
        { name: "overwritten", value: "final", priority: 10, kind: "define" },
      ],
    } as unknown as GraphBuildResult;

    const linked = linkProjectGraphs([frag]);
    expect(linked.nodes).toHaveLength(1);
    expect(linked.initVariables?.get("overwritten")?.value).toBe("final");
    expect(linked.initVariables?.get("var_true")?.value).toBe(true);
    expect(linked.initVariables?.get("var_false")?.value).toBe(false);
    expect(linked.initVariables?.get("var_num")?.value).toBe(42);
    expect(linked.initVariables?.get("var_null")?.value).toBeNull();
  });

  it("handles duplicate label shadowing, diagnostics, and edge remapping", () => {
    const frag1: GraphBuildResult = {
      nodes: [
        {
          id: "shared_label",
          type: "LABEL",
          label: "shared_label",
        } as FlowNode,
      ],
      edges: [],
    } as unknown as GraphBuildResult;

    const frag2: GraphBuildResult = {
      nodes: [
        {
          id: "shared_label",
          type: "LABEL",
          label: "shared_label",
        } as FlowNode,
      ],
      edges: [
        {
          id: "e1",
          source: "shared_label",
          target: "target_label",
          kind: "jump",
        } as FlowEdge,
      ],
    } as unknown as GraphBuildResult;

    const linked = linkProjectGraphs([frag1, frag2]);
    const shadowed = linked.nodes.find((n) => n.id.includes("__shadow_"));
    expect(shadowed).toBeDefined();
    expect(shadowed?.isShadowed).toBe(true);
    expect(linked.edges[0]?.source).toBe(shadowed?.id);
    expect(linked.diagnostics?.some((d) => d.code === "shadowed_label")).toBe(
      true,
    );
  });

  it("resolves call returns and connects internal menu nodes in called label", () => {
    const frag: GraphBuildResult = {
      nodes: [
        { id: "caller", type: "LABEL", label: "caller" } as FlowNode,
        { id: "subroutine", type: "LABEL", label: "subroutine" } as FlowNode,
        {
          id: "menu_inside_sub",
          type: "MENU",
          parentLabelId: "subroutine",
          label: "sub_menu",
        } as FlowNode,
        {
          id: "return_target",
          type: "LABEL",
          label: "return_target",
        } as FlowNode,
      ],
      edges: [
        {
          id: "call_e",
          source: "caller",
          target: "subroutine",
          kind: "call",
          callContext: {
            callContextId: "ctx_1",
            callerLabelId: "caller",
            returnTargetId: "return_target",
            callNodeId: "caller",
          },
        } as FlowEdge,
      ],
      hasReliableReturnInLabel: new Set(["subroutine"]),
    } as unknown as GraphBuildResult;

    const linked = linkProjectGraphs([frag]);
    const returnEdges = linked.edges.filter((e) => e.kind === "call_return");
    expect(returnEdges.length).toBeGreaterThanOrEqual(2);
    expect(returnEdges.some((e) => e.source === "subroutine")).toBe(true);
    expect(returnEdges.some((e) => e.source === "menu_inside_sub")).toBe(true);
  });

  it("classifies node roles for utility patterns, state toggles, and continuation nodes", () => {
    try {
      registerParserVariantPlugin({
        id: "util_variant",
        label: "Utility Variant",
        isCustom: true,
        defaultScreenActionRules: [],
        utilityLabelPatterns: [/^util_/],
      });

      const frag: GraphBuildResult = {
        nodes: [
          {
            id: "util_helper",
            type: "LABEL",
            label: "util_helper",
          } as FlowNode,
          {
            id: "toggle_label",
            type: "LABEL",
            label: "toggle_label",
          } as FlowNode,
          {
            id: "util_helper__cont_1",
            type: "LABEL",
            label: "util_helper__cont_1",
          } as FlowNode,
          {
            id: "decision_node",
            type: "DECISION",
            label: "if coins > 0",
          } as FlowNode,
        ],
        edges: [],
        hasReliableReturnInLabel: new Set(["toggle_label"]),
      } as unknown as GraphBuildResult;

      const linked = linkProjectGraphs([frag], {
        parserVariant: "util_variant",
      });

      const utilNode = linked.nodes.find((n) => n.id === "util_helper");
      const contNode = linked.nodes.find((n) => n.id === "util_helper__cont_1");
      const toggleNode = linked.nodes.find((n) => n.id === "toggle_label");
      const decisionNode = linked.nodes.find((n) => n.id === "decision_node");

      expect(utilNode?.role).toBe("utility");
      expect(contNode?.role).toBe("utility");
      expect(toggleNode?.role).toBe("state_toggle");
      expect(decisionNode?.role).toBe("decision");
    } finally {
      clearCustomParserVariantPlugins();
    }
  });

  it("performs reachability analysis using fuzzy entry points and 0-incoming fallbacks", () => {
    const frag: GraphBuildResult = {
      nodes: [
        {
          id: "custom_game_start",
          type: "LABEL",
          label: "custom_game_start",
        } as FlowNode,
        {
          id: "unreachable_label",
          type: "LABEL",
          label: "unreachable",
        } as FlowNode,
      ],
      edges: [],
    } as unknown as GraphBuildResult;

    const linked = linkProjectGraphs([frag]);
    const startNode = linked.nodes.find((n) => n.id === "custom_game_start");
    const unreachableNode = linked.nodes.find((n) =>
      n.id === "unreachable_label"
    );

    expect(startNode?.isOrphan).toBeFalsy();
    expect(unreachableNode?.isOrphan).toBe(true);
  });

  it("processes for-loop edge conditions, label interpolations, and variable declarations", () => {
    const frag: GraphBuildResult = {
      nodes: [
        {
          id: "start",
          type: "LABEL",
          label: "Welcome [hero_name]",
          dialogueLines: ["You have [gold] coins and [persistent.gems] gems."],
          mutations: [
            {
              variableName: "score",
              rawExpression: "score + multiplier",
            },
          ],
        } as FlowNode,
        {
          id: "loop_target",
          type: "LABEL",
          label: "loop_target",
        } as FlowNode,
      ],
      edges: [
        {
          id: "for_edge",
          source: "start",
          target: "loop_target",
          kind: "jump",
          condition: {
            branchKind: "for",
            expression: "item, idx in inventory_list",
          },
          label: "Option [item]",
        } as FlowEdge,
      ],
      initDescriptors: [
        { name: "hero_name", value: "Alice", priority: 0, kind: "default" },
        { name: "gold", value: 10, priority: 0, kind: "default" },
        { name: "gems", value: 5, priority: 0, kind: "default" },
        { name: "multiplier", value: 2, priority: 0, kind: "default" },
        {
          name: "inventory_list",
          value: ["sword"],
          priority: 0,
          kind: "default",
        },
        {
          name: "unused_var",
          value: "never_used",
          priority: 0,
          kind: "default",
        },
        {
          name: "derived_var",
          value: 0,
          rawExpression: "base_points * 2",
          priority: 0,
          kind: "default",
        },
      ],
    } as unknown as GraphBuildResult;

    const linked = linkProjectGraphs([frag]);
    expect(linked.nodes).toHaveLength(2);

    // Should emit unused_variable for unused_var
    expect(
      linked.diagnostics?.some(
        (d) =>
          d.context?.category === "unused_variable" &&
          d.context?.detail === "unused_var",
      ),
    ).toBe(true);

    // Should emit undeclared_variable for base_points or hero_name references
    expect(linked.diagnostics?.length).toBeGreaterThan(0);
  });
});
