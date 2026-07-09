import { describe, expect, it } from "vitest";
import { parseRenpyFiles } from "../src/parser/parser";

describe("controlFlowAnalysis", () => {
  it("detects unreachable label (orphan) when start exists", async () => {
    const files = [
      {
        name: "orphan.rpy",
        content: `
label start:
    "Welcome to the start"
    jump finished

label unreachable_label:
    "This is unreachable"

label finished:
    "End of route"
`,
      },
    ];

    const result = await parseRenpyFiles(files);

    const unreachableNode = result.nodes.find((n) => n.id === "unreachable_label");
    expect(unreachableNode).toBeDefined();
    expect(unreachableNode?.isOrphan).toBe(true);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "normalization",
          context: expect.objectContaining({
            category: "unreachable_label",
            detail: "unreachable_label",
          }),
        }),
      ]),
    );
  });

  it("detects dialogue-less tight loops (infinite cycles)", async () => {
    const files = [
      {
        name: "cycle.rpy",
        content: `
label start:
    jump loop_a

label loop_a:
    jump loop_b

label loop_b:
    jump loop_a
`,
      },
    ];

    const result = await parseRenpyFiles(files);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "normalization",
          context: expect.objectContaining({
            category: "infinite_loop",
          }),
        }),
      ]),
    );
  });

  it("does not report infinite loops when there is dialogue in the loop", async () => {
    const files = [
      {
        name: "valid_loop.rpy",
        content: `
label start:
    jump loop_a

label loop_a:
    "Inside loop"
    jump loop_a
`,
      },
    ];

    const result = await parseRenpyFiles(files);

    const loopDiagnostics = result.diagnostics?.filter(
      (d) => d.context?.category === "infinite_loop"
    );
    expect(loopDiagnostics ?? []).toHaveLength(0);
  });

  it("detects missing returns on called labels", async () => {
    const files = [
      {
        name: "missing_return.rpy",
        content: `
label start:
    call sub_label
    "Back to start"

label sub_label:
    "No return statement here"
`,
      },
    ];

    const result = await parseRenpyFiles(files);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "normalization",
          context: expect.objectContaining({
            category: "missing_return",
            detail: "sub_label",
          }),
        }),
      ]),
    );
  });

  it("detects uncalled returns on story labels", async () => {
    const files = [
      {
        name: "uncalled_return.rpy",
        content: `
label start:
    jump sub_label

label sub_label:
    "Jumped here but returning"
    return
`,
      },
    ];

    const result = await parseRenpyFiles(files);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "normalization",
          context: expect.objectContaining({
            category: "uncalled_return",
            detail: "sub_label",
          }),
        }),
      ]),
    );
  });
});
