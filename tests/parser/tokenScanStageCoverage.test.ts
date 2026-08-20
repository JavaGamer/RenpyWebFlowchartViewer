import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createGraphState, createScanState } from "../../src/parser/pipelineState.ts";
import { processFlatTokens } from "../../src/parser/tokenScanStage.ts";

describe("processFlatTokens coverage", () => {
  it("skips non-relevant token types", () => {
    const state = createGraphState();
    const scanState = createScanState();
    const doc = TextDocument.create("file://skip.rpy", "rpy", 1, "label start:\n");

    processFlatTokens(
      state,
      scanState,
      [
        {
          type: -1,
          metaTokens: [],
          startPos: { line: 0, character: 0 },
          getValue: () => "",
        },
      ],
      doc,
      "skip",
      true,
    );

    expect(state.nodes).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
  });
});
