import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRenpyFilesModern } from "../../src/parser/modernParseService.ts";

function loadFixture(name: string): string {
  const fixturesDir = resolve(import.meta.dirname, "../fixtures");
  return readFileSync(resolve(fixturesDir, name), "utf8");
}

describe("parseRenpyFilesModern", () => {
  it("processes multi-file projects with onProgress callbacks and clean topology", async () => {
    const file1 = [
      "label start:",
      '    "Beginning of the story."',
      "    jump chapter_two",
    ].join("\n");

    const file2 = [
      "label chapter_two:",
      '    "Continuation in chapter two."',
      "    return",
    ].join("\n");

    const progressReports: string[] = [];

    const result = await parseRenpyFilesModern(
      [
        { name: "01_start.rpy", content: file1 },
        { name: "02_ch2.rpy", content: file2 },
      ],
      {
        onProgress: (p) => {
          progressReports.push(
            `${p.doneFiles}/${p.totalFiles}: ${p.currentFile}`,
          );
        },
      },
    );

    expect(progressReports).toHaveLength(2);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((n) => n.id)).toEqual(["start", "chapter_two"]);

    const jumpEdge = result.edges.find((e) => e.kind === "jump");
    expect(jumpEdge).toBeDefined();
    expect(jumpEdge!.source).toBe("start");
    expect(jumpEdge!.target).toBe("chapter_two");
  });

  it("handles fixtures: nested-menus.rpy, unreachable-labels.rpy, cyclic-jumps.rpy", async () => {
    const nestedRes = await parseRenpyFilesModern([
      { name: "nested-menus.rpy", content: loadFixture("nested-menus.rpy") },
    ]);
    expect(nestedRes.nodes.filter((n) => n.type === "MENU")).toHaveLength(2);

    const unreachableRes = await parseRenpyFilesModern([
      {
        name: "unreachable-labels.rpy",
        content: loadFixture("unreachable-labels.rpy"),
      },
    ]);
    expect(unreachableRes.nodes).toHaveLength(3);
    const hiddenNode = unreachableRes.nodes.find((n) =>
      n.id === "hidden_branch"
    );
    expect(hiddenNode).toBeDefined();
    expect(hiddenNode!.isOrphan).toBe(true);

    const cyclicRes = await parseRenpyFilesModern([
      { name: "cyclic-jumps.rpy", content: loadFixture("cyclic-jumps.rpy") },
    ]);
    expect(cyclicRes.edges).toHaveLength(2);
  });

  it("delegates from parseRenpyFiles when engine: 'modern' is set", async () => {
    const { parseRenpyFiles } = await import("../../src/parser/parser.ts");
    const result = await parseRenpyFiles(
      [
        {
          name: "quick.rpy",
          content: 'label start:\n    "Hello"\n    return\n',
        },
      ],
      { engine: "modern" },
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe("start");
  });
});
