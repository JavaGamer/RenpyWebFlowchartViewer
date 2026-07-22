import { describe, expect, it } from "vitest";
import { generateDialogueCsv } from "../../src/application/exporters/csvExporter.ts";
import type { FlowNode } from "../../src/domain/index.ts";

describe("Phase 1 Exporters (CSV & PDF)", () => {
  it("generates CSV dialogue payload with complete script details", () => {
    const mockNodes: FlowNode[] = [
      {
        id: "lbl_start",
        type: "LABEL",
        role: "story",
        label: "start",
        chapter: "game/script.rpy",
        wordCount: 12,
        pauseDuration: 0,
        dialogueLines: [
          {
            speaker: "Eileen",
            text: "Hello world!",
            lineNumber: 15,
          } as unknown as string,
          {
            speaker: "Eileen",
            text: "Welcome to RenPy Flowchart Viewer.",
            lineNumber: 16,
          } as unknown as string,
        ],
      },
    ];

    const csvOutput = generateDialogueCsv(mockNodes);

    expect(csvOutput).toContain('"Node ID","Chapter/File Path","Line Number","Speaker/Character Name","Dialogue Text","Word Count","Node Type"');
    expect(csvOutput).toContain('"lbl_start"');
    expect(csvOutput).toContain('"game/script.rpy"');
    expect(csvOutput).toContain('"Eileen"');
    expect(csvOutput).toContain('"Hello world!"');
  });
});
