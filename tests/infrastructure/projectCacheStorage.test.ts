import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CachedProject,
  deleteProjectFromCache,
  getProjectFromCache,
  getRecentProjects,
  saveProjectToCache,
} from "../../src/infrastructure/projectCacheStorage.ts";

interface MockIDBRequest {
  onsuccess?: ((event?: unknown) => void) | null;
  onerror?: ((event?: unknown) => void) | null;
  onupgradeneeded?: ((event?: unknown) => void) | null;
  result?: unknown;
}

describe("infrastructure / projectCacheStorage", () => {
  const originalIndexedDB = globalThis.indexedDB;

  afterEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: originalIndexedDB,
      writable: true,
      configurable: true,
    });
  });

  describe("when indexedDB is not available", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "indexedDB", {
        value: undefined,
        writable: true,
        configurable: true,
      });
    });

    it("saveProjectToCache handles missing indexedDB gracefully", async () => {
      const sampleProject: CachedProject = {
        id: "proj1",
        name: "Test Project",
        lastAccessed: Date.now(),
        fileCount: 1,
        nodes: [],
        edges: [],
        diagnostics: [],
      };

      // Should not throw, logs console.warn and returns undefined
      await expect(saveProjectToCache(sampleProject)).resolves.toBeUndefined();
    });

    it("getProjectFromCache returns null when indexedDB is missing", async () => {
      const res = await getProjectFromCache("proj1");
      expect(res).toBeNull();
    });

    it("getRecentProjects returns empty array when indexedDB is missing", async () => {
      const res = await getRecentProjects();
      expect(res).toEqual([]);
    });

    it("deleteProjectFromCache handles missing indexedDB gracefully", async () => {
      await expect(deleteProjectFromCache("proj1")).resolves.toBeUndefined();
    });
  });

  describe("when indexedDB is mocked", () => {
    let mockStore: Map<string, CachedProject>;

    beforeEach(() => {
      mockStore = new Map();

      const fakeIDB = {
        open: () => {
          const req: MockIDBRequest = {
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
            result: {
              objectStoreNames: {
                contains: () => true,
              },
              createObjectStore: () => ({
                createIndex: () => {},
              }),
              transaction: () => {
                const tx: { objectStore: unknown; oncomplete?: (() => void) | null } = {
                  oncomplete: null,
                  objectStore: () => ({
                    put: (item: CachedProject) => {
                      mockStore.set(item.id, item);
                      const putReq: MockIDBRequest = {
                        onsuccess: null,
                        onerror: null,
                      };
                      setTimeout(() => {
                        putReq.onsuccess?.();
                        tx.oncomplete?.();
                      }, 0);
                      return putReq;
                    },
                    get: (id: string) => {
                      const item = mockStore.get(id);
                      const getReq: MockIDBRequest = {
                        onsuccess: null,
                        onerror: null,
                        result: item || undefined,
                      };
                      setTimeout(() => {
                        getReq.onsuccess?.();
                        tx.oncomplete?.();
                      }, 0);
                      return getReq;
                    },
                    delete: (id: string) => {
                      mockStore.delete(id);
                      const delReq: MockIDBRequest = {
                        onsuccess: null,
                        onerror: null,
                      };
                      setTimeout(() => {
                        delReq.onsuccess?.();
                        tx.oncomplete?.();
                      }, 0);
                      return delReq;
                    },
                    index: () => ({
                      openCursor: () => {
                        const items = Array.from(mockStore.values()).sort(
                          (a, b) => b.lastAccessed - a.lastAccessed,
                        );
                        let idx = 0;
                        const cursorReq: MockIDBRequest = {
                          onsuccess: null,
                          onerror: null,
                        };
                        setTimeout(() => {
                          const step = () => {
                            if (idx < items.length) {
                              const val = items[idx++];
                              const cursorObj = {
                                value: val,
                                continue: () => {
                                  setTimeout(step, 0);
                                },
                              };
                              cursorReq.result = cursorObj;
                              cursorReq.onsuccess?.({ target: cursorReq });
                            } else {
                              cursorReq.result = null;
                              cursorReq.onsuccess?.({ target: cursorReq });
                              tx.oncomplete?.();
                            }
                          };
                          step();
                        }, 0);
                        return cursorReq;
                      },
                    }),
                  }),
                };
                return tx;
              },
              close: () => {},
            },
          };
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
      };

      Object.defineProperty(globalThis, "indexedDB", {
        value: fakeIDB,
        writable: true,
        configurable: true,
      });
    });

    it("saves and retrieves project from cache", async () => {
      const project: CachedProject = {
        id: "proj1",
        name: "My Story",
        lastAccessed: 1000,
        fileCount: 2,
        nodes: [{ id: "n1", type: "LABEL", label: "Start", dialogueCount: 1 }],
        edges: [],
        diagnostics: [],
      };

      await saveProjectToCache(project);
      const retrieved = await getProjectFromCache("proj1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe("proj1");
      expect(retrieved?.name).toBe("My Story");
      expect(retrieved?.nodes.length).toBe(1);
    });

    it("lists recent projects sorted by lastAccessed", async () => {
      await saveProjectToCache({
        id: "p1",
        name: "Older Project",
        lastAccessed: 1000,
        fileCount: 1,
        nodes: [],
        edges: [],
        diagnostics: [],
      });
      await saveProjectToCache({
        id: "p2",
        name: "Newer Project",
        lastAccessed: 5000,
        fileCount: 3,
        nodes: [],
        edges: [],
        diagnostics: [],
      });

      const recents = await getRecentProjects();
      expect(recents.length).toBe(2);
      expect(recents[0].id).toBe("p2"); // newer first
      expect(recents[1].id).toBe("p1");
    });

    it("deletes project from cache", async () => {
      await saveProjectToCache({
        id: "p1",
        name: "To Delete",
        lastAccessed: 1000,
        fileCount: 1,
        nodes: [],
        edges: [],
        diagnostics: [],
      });

      await deleteProjectFromCache("p1");
      const res = await getProjectFromCache("p1");
      expect(res).toBeNull();
    });
  });
});
