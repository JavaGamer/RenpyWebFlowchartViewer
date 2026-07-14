import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../src/application/appStore";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it("has correct initial state", () => {
    const state = useAppStore.getState();
    expect(state.phase).toBe("idle");
    expect(state.flowNodes).toEqual([]);
    expect(state.flowEdges).toEqual([]);
    expect(state.parseDiagnostics).toEqual([]);
    expect(state.errorMsg).toBe("");
    expect(state.fileCount).toBe(0);
    expect(state.parseProgress).toBeNull();
    expect(state.importRevision).toBe(0);
    expect(state.dialogueSearchMode).toBe("auto");
  });

  it("transitions to reading with initialized progress", () => {
    useAppStore.getState().startReading(2);
    const state = useAppStore.getState();
    expect(state.phase).toBe("reading");
    expect(state.parseProgress).toEqual({
      doneFiles: 0,
      totalFiles: 2,
      currentFile: "",
    });
    expect(state.importRevision).toBe(0);
  });

  it("startReading clears any previous error message", () => {
    useAppStore.getState().fail("previous error");
    useAppStore.getState().startReading(3);
    expect(useAppStore.getState().errorMsg).toBe("");
    expect(useAppStore.getState().fileCount).toBe(3);
  });

  it("transitions to parsing phase via startParsing", () => {
    useAppStore.getState().startReading(1);
    useAppStore.getState().startParsing();
    expect(useAppStore.getState().phase).toBe("parsing");
  });

  it("updates parse progress via setProgress", () => {
    useAppStore.getState().startReading(3);
    useAppStore.getState().setProgress({
      doneFiles: 1,
      totalFiles: 3,
      currentFile: "a.rpy",
    });
    const progress = useAppStore.getState().parseProgress;
    expect(progress).toEqual({
      doneFiles: 1,
      totalFiles: 3,
      currentFile: "a.rpy",
    });
  });

  it("partialParseSuccess updates nodes, edges and diagnostics while keeping phase parsing", () => {
    useAppStore.getState().startParsing();
    const nodes = [{
      id: "n1",
      type: "LABEL" as const,
      label: "n1",
      dialogueCount: 0,
    }];
    const edges = [{
      id: "e1",
      source: "n1",
      target: "n2",
      kind: "jump" as const,
    }];
    const diagnostics = [{
      code: "dynamic_target" as const,
      severity: "warning" as const,
      location: { chapter: "ch", construct: "jump", targetExpression: "x" },
      message: "dynamic",
    }];
    useAppStore.getState().partialParseSuccess(nodes, edges, diagnostics);
    const state = useAppStore.getState();
    expect(state.phase).toBe("parsing");
    expect(state.flowNodes).toEqual(nodes);
    expect(state.flowEdges).toEqual(edges);
    expect(state.parseDiagnostics).toEqual(diagnostics);
  });

  it("partialParseSuccess without diagnostics does not overwrite existing diagnostics", () => {
    const diagnostics = [{
      code: "dynamic_target" as const,
      severity: "warning" as const,
      location: { chapter: "ch", construct: "jump", targetExpression: "x" },
      message: "dynamic",
    }];
    useAppStore.getState().partialParseSuccess([], [], diagnostics);
    useAppStore.getState().partialParseSuccess([], []);
    expect(useAppStore.getState().parseDiagnostics).toEqual(diagnostics);
  });

  it("transitions to success and clears progress", () => {
    useAppStore.getState().startReading(1);
    useAppStore.getState().parseSuccess([], []);
    const state = useAppStore.getState();
    expect(state.phase).toBe("done");
    expect(state.parseProgress).toBeNull();
    expect(state.parseDiagnostics).toEqual([]);
    expect(state.importRevision).toBe(1);
  });

  it("parseSuccess stores diagnostics from arguments", () => {
    const diagnostics = [{
      code: "dynamic_target" as const,
      severity: "warning" as const,
      location: { chapter: "ch", construct: "call", targetExpression: "y" },
      message: "dynamic call",
    }];
    useAppStore.getState().parseSuccess([], [], diagnostics);
    expect(useAppStore.getState().parseDiagnostics).toEqual(diagnostics);
  });

  it("parseSuccess increments importRevision on each call", () => {
    useAppStore.getState().parseSuccess([], []);
    useAppStore.getState().parseSuccess([], []);
    expect(useAppStore.getState().importRevision).toBe(2);
  });

  it("fail sets error phase, stores error message, and clears parse progress", () => {
    useAppStore.getState().startReading(2);
    useAppStore.getState().fail("something went wrong");
    const state = useAppStore.getState();
    expect(state.phase).toBe("error");
    expect(state.errorMsg).toBe("something went wrong");
    expect(state.parseProgress).toBeNull();
  });

  it("updates dialogue search mode", () => {
    useAppStore.getState().setDialogueSearchMode("countOnly");
    expect(useAppStore.getState().dialogueSearchMode).toBe("countOnly");
  });

  it("setDialogueSearchMode accepts all valid modes", () => {
    for (const mode of ["auto", "full", "countOnly"] as const) {
      useAppStore.getState().setDialogueSearchMode(mode);
      expect(useAppStore.getState().dialogueSearchMode).toBe(mode);
    }
  });

  it("resets to initial state", () => {
    useAppStore.getState().startReading(5);
    useAppStore.getState().reset();
    const state = useAppStore.getState();
    expect(state.phase).toBe("idle");
    expect(state.fileCount).toBe(0);
    expect(state.parseProgress).toBeNull();
  });

  it("reset clears error message and flow data", () => {
    useAppStore.getState().fail("oops");
    const nodes = [{
      id: "n1",
      type: "LABEL" as const,
      label: "n1",
      dialogueCount: 0,
    }];
    useAppStore.setState({ flowNodes: nodes });
    useAppStore.getState().reset();
    const state = useAppStore.getState();
    expect(state.errorMsg).toBe("");
    expect(state.flowNodes).toEqual([]);
    expect(state.importRevision).toBe(0);
  });
});
