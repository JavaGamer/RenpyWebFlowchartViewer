import { describe, expect, it } from "vitest";
import { ensureScanStateInitialized } from "../../src/parser/tokenHandling.ts";
import type { ParseScanState } from "../../src/parser/pipelineTypes.ts";

describe("ensureScanStateInitialized", () => {
  it("initializes literal target map when missing", () => {
    const scanState = {} as ParseScanState;

    ensureScanStateInitialized(scanState);

    expect(scanState.labelVariableLiteralTargets).toBeInstanceOf(Map);
  });

  it("does not overwrite pre-initialized scan state fields", () => {
    const literalTargets = new Map<string, string>([["from", "to"]]);
    const dictTargets = new Map<string, Map<string, string>>();
    const listTargets = new Map<string, string[]>();
    const scanState = {
      conditionalDecisionStack: [],
      labelVariableLiteralTargets: literalTargets,
      labelVariableDictTargets: dictTargets,
      labelVariableListTargets: listTargets,
      pendingConditionalHeader: null,
      currentLabelDeclaredName: "start",
      currentLabelBaseId: "start",
      currentLabelSceneIndex: 3,
      currentLabelHasSplit: true,
      currentLabelHasContentSinceSceneBoundary: true,
    } as ParseScanState;

    ensureScanStateInitialized(scanState);

    expect(scanState.labelVariableLiteralTargets).toBe(literalTargets);
    expect(scanState.labelVariableDictTargets).toBe(dictTargets);
    expect(scanState.labelVariableListTargets).toBe(listTargets);
    expect(scanState.currentLabelDeclaredName).toBe("start");
    expect(scanState.currentLabelBaseId).toBe("start");
    expect(scanState.currentLabelSceneIndex).toBe(3);
    expect(scanState.currentLabelHasSplit).toBe(true);
    expect(scanState.currentLabelHasContentSinceSceneBoundary).toBe(true);
  });
});
