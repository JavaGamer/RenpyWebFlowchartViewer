import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../../src/parser/parser.ts";
import { normalizeGraphState } from "../../src/parser/graphNormalization.ts";
import { createGraphState } from "../../src/parser/pipelineState.ts";
import { evaluateConditionExpression } from "../../src/domain/conditionLogic.ts";
import { resolveGithubUrl } from "../../src/application/urlImporter.ts";
import type { FlowNode } from "../../src/domain/index.ts";

describe("Edge Case & Bug Fix Audits", () => {
  it("handles null or undefined file input safely in parseRenpyFiles", async () => {
    // @ts-expect-error testing null input
    const resultNull = await parseRenpyFiles(null);
    expect(resultNull.nodes).toEqual([]);
    expect(resultNull.edges).toEqual([]);

    // @ts-expect-error testing undefined input
    const resultUndefined = await parseRenpyFiles(undefined);
    expect(resultUndefined.nodes).toEqual([]);
  });

  it("handles empty or missing file content without throwing TypeError", async () => {
    const result = await parseRenpyFiles([
      { name: "empty.rpy", content: "" },
      // @ts-expect-error testing missing content property
      { name: "missing.rpy" },
    ]);
    expect(result.nodes).toBeDefined();
    expect(result.edges).toBeDefined();
  });

  it("filters state.hasReliableReturnInLabel during graph normalization", () => {
    const state = createGraphState();
    const validNode: FlowNode = {
      id: "label_valid",
      type: "LABEL",
      label: "valid",
      role: "story",
      dialogueCount: 0,
    };
    state.nodes = [validNode];
    state.hasReturnInLabel = new Set(["label_valid", "label_dropped"]);
    state.hasReliableReturnInLabel = new Set(["label_valid", "label_dropped"]);

    normalizeGraphState(state);

    expect(state.hasReturnInLabel.has("label_valid")).toBe(true);
    expect(state.hasReturnInLabel.has("label_dropped")).toBe(false);
    expect(state.hasReliableReturnInLabel.has("label_valid")).toBe(true);
    expect(state.hasReliableReturnInLabel.has("label_dropped")).toBe(false);
  });

  it("handles condition evaluation stack underflow gracefully without throwing errors", () => {
    // Missing operands for operator
    const res = evaluateConditionExpression("and", {});
    expect(res).toBe("unknown");
  });

  it("resolves script URLs containing query strings or hash fragments", () => {
    const resolved = resolveGithubUrl(
      "https://github.com/owner/repo/blob/main/script.rpy?v=123#L10",
    );
    expect(resolved).toBe(
      "https://raw.githubusercontent.com/owner/repo/main/script.rpy?v=123#L10",
    );
  });
});
