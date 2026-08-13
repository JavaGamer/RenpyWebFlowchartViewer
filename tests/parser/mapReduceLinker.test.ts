import { describe, expect, it } from "vitest";
import {
  linkGraphFragments,
  parseFileToFragment,
  parseRenpyFiles,
} from "../../src/parser/index.ts";

describe("2-Pass MapReduce Linker Architecture", () => {
  it("generates isolated FileGraphFragment during Pass 1 Map", async () => {
    const file = {
      name: "chapter1.rpy",
      content: `
label start:
    "Hello from chapter 1"
    jump chapter2_intro
`,
    };

    const fragment = await parseFileToFragment(file, {}, undefined, 0);

    expect(fragment.filePath).toBe("chapter1.rpy");
    expect(fragment.chapter).toBe("chapter1");
    expect(fragment.nodes.length).toBeGreaterThan(0);
    expect(fragment.edges.length).toBeGreaterThan(0);
    expect(fragment.canonicalLabelIds).toContainEqual(["start", "start"]);
  });

  it("links cross-file jumps and pending call returns in Pass 2 Fast Linker", async () => {
    const file1 = {
      name: "ch1.rpy",
      content: `
label start:
    call sub_routine
    jump finish

label finish:
    return
`,
    };

    const file2 = {
      name: "ch2.rpy",
      content: `
label sub_routine:
    "Inside sub routine"
    return
`,
    };

    const fragment1 = await parseFileToFragment(file1, {}, undefined, 0);
    const fragment2 = await parseFileToFragment(file2, {}, undefined, 1);

    const mergedState = linkGraphFragments([fragment1, fragment2]);

    expect(mergedState.nodes.map((n) => n.id)).toContain("start");
    expect(mergedState.nodes.map((n) => n.id)).toContain("sub_routine");
    expect(mergedState.nodes.map((n) => n.id)).toContain("finish");

    // Verify call edge from start -> sub_routine
    const callEdge = mergedState.edges.find((e) => e.kind === "call");
    expect(callEdge).toBeDefined();
    expect(callEdge?.source).toBe("start");
    expect(callEdge?.target).toBe("sub_routine");

    // Verify call return edge materialized from sub_routine -> start
    const retEdge = mergedState.edges.find((e) => e.kind === "call_return");
    expect(retEdge).toBeDefined();
    expect(retEdge?.source).toBe("sub_routine");
    expect(retEdge?.target).toBe("start");
  });

  it("disambiguates duplicate label IDs deterministically across files", async () => {
    const file1 = {
      name: "fileA.rpy",
      content: `
label intro:
    "Intro in file A"
`,
    };

    const file2 = {
      name: "fileB.rpy",
      content: `
label intro:
    "Intro in file B"
`,
    };

    const fragment1 = await parseFileToFragment(file1, {}, undefined, 0);
    const fragment2 = await parseFileToFragment(file2, {}, undefined, 1);

    const mergedState = linkGraphFragments([fragment1, fragment2]);

    const introNodes = mergedState.nodes.filter((n) => n.label === "intro");
    expect(introNodes.length).toBe(2);

    const ids = introNodes.map((n) => n.id);
    expect(ids).toContain("intro");
    expect(ids).toContain("intro__shadow_2");
  });

  it("produces identical output graph between single-thread and parallel parseRenpyFiles", async () => {
    const files = [
      {
        name: "01_start.rpy",
        content: `
label start:
    $ hp = 100
    jump scene_forest
`,
      },
      {
        name: "02_forest.rpy",
        content: `
label scene_forest:
    "You enter the deep forest."
    call check_health
    jump end_game

label check_health:
    if hp > 50:
        "You are healthy."
    return
`,
      },
      {
        name: "03_end.rpy",
        content: `
label end_game:
    "The journey ends."
    return
`,
      },
    ];

    const singleState = await parseRenpyFiles(files, { maxParallelFiles: 1 });
    const parallelState = await parseRenpyFiles(files, { maxParallelFiles: 4 });

    expect(parallelState.nodes.length).toEqual(singleState.nodes.length);
    expect(parallelState.edges.length).toEqual(singleState.edges.length);
    expect(parallelState.nodes.map((n) => n.id).sort()).toEqual(
      singleState.nodes.map((n) => n.id).sort(),
    );
    expect(parallelState.edges.map((e) => e.id).sort()).toEqual(
      singleState.edges.map((e) => e.id).sort(),
    );
  });
});
