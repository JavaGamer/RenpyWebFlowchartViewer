import { beforeEach, describe, expect, it } from "vitest";
import { useTelemetryStore } from "../../src/application/telemetryStore.ts";

describe("application / telemetryStore", () => {
  beforeEach(() => {
    useTelemetryStore.getState().reset();
  });

  it("initializes with default metrics", () => {
    const state = useTelemetryStore.getState();
    expect(state.readMs).toBeNull();
    expect(state.parseMs).toBeNull();
    expect(state.layoutMs).toBeNull();
    expect(state.renderMs).toBeNull();
    expect(state.nodesCount).toBe(0);
    expect(state.edgesCount).toBe(0);
    expect(state.fileCount).toBe(0);
  });

  it("records timing metrics", () => {
    const store = useTelemetryStore.getState();
    store.recordRead(120);
    store.recordParse(250);
    store.recordLayout(80);
    store.recordRender(45);

    const updated = useTelemetryStore.getState();
    expect(updated.readMs).toBe(120);
    expect(updated.parseMs).toBe(250);
    expect(updated.layoutMs).toBe(80);
    expect(updated.renderMs).toBe(45);
  });

  it("records parse details while preserving existing fields", () => {
    const store = useTelemetryStore.getState();
    store.setFileCount(10);
    store.recordParse(300, { nodes: 50, edges: 75 });

    const updated = useTelemetryStore.getState();
    expect(updated.parseMs).toBe(300);
    expect(updated.fileCount).toBe(10); // preserved
    expect(updated.nodesCount).toBe(50);
    expect(updated.edgesCount).toBe(75);
  });

  it("updates graph metrics and file count", () => {
    const store = useTelemetryStore.getState();
    store.setGraphMetrics(100, 200);
    store.setFileCount(5);

    const updated = useTelemetryStore.getState();
    expect(updated.nodesCount).toBe(100);
    expect(updated.edgesCount).toBe(200);
    expect(updated.fileCount).toBe(5);
  });

  it("resets store to initial state", () => {
    const store = useTelemetryStore.getState();
    store.recordRead(100);
    store.setGraphMetrics(10, 20);
    store.reset();

    const resetState = useTelemetryStore.getState();
    expect(resetState.readMs).toBeNull();
    expect(resetState.nodesCount).toBe(0);
  });
});
