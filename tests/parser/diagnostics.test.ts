import { describe, expect, it } from "vitest";
import { addParseDiagnostic } from "../../src/parser/diagnostics.ts";
import type {
  ParseDiagnostic,
  ParseGraphState,
} from "../../src/parser/pipelineTypes.ts";

describe("addParseDiagnostic", () => {
  it("adds diagnostic and sets id when not already present", () => {
    const state: ParseGraphState = {
      diagnostics: [],
      diagnosticIds: new Set<string>(),
    } as unknown as ParseGraphState;

    const diag: ParseDiagnostic = {
      code: "normalization",
      severity: "warning",
      message: "Test message",
    };

    addParseDiagnostic(state, diag, "diag_1");
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnosticIds.has("diag_1")).toBe(true);
    expect(diag.id).toBe("diag_1");
  });

  it("ignores duplicate diagnostic IDs", () => {
    const state: ParseGraphState = {
      diagnostics: [],
      diagnosticIds: new Set<string>(["diag_1"]),
    } as unknown as ParseGraphState;

    const diag: ParseDiagnostic = {
      code: "normalization",
      severity: "warning",
      message: "Duplicate message",
    };

    addParseDiagnostic(state, diag, "diag_1");
    expect(state.diagnostics).toHaveLength(0);
  });

  it("caps diagnostics at 1000", () => {
    const diags: ParseDiagnostic[] = [];
    for (let i = 0; i < 1000; i++) {
      diags.push({
        id: `id_${i}`,
        code: "normalization",
        severity: "info",
        message: `msg_${i}`,
      });
    }

    const state: ParseGraphState = {
      diagnostics: diags,
      diagnosticIds: new Set<string>(diags.map((d) => d.id!)),
    } as unknown as ParseGraphState;

    const extraDiag: ParseDiagnostic = {
      code: "normalization",
      severity: "warning",
      message: "Extra message",
    };

    addParseDiagnostic(state, extraDiag, "overflow_id");
    expect(state.diagnostics).toHaveLength(1000);
    expect(state.diagnosticIds.has("overflow_id")).toBe(false);
  });
});
