import type { FlowEdge, FlowNode } from "../domain/index.ts";
import type { ParseDiagnosticPayload } from "./index.ts";

export interface CachedProject {
  id: string; // A unique ID (e.g., project name)
  name: string; // Human readable name (e.g., folder name)
  lastAccessed: number;
  fileCount: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics: ParseDiagnosticPayload[];
}

export type RecentProject = Omit<
  CachedProject,
  "nodes" | "edges" | "diagnostics"
>;

const DB_NAME = "RenpyWebFlowchartViewerDB";
const DB_VERSION = 1;
const STORE_NAME = "projects";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("indexedDB is not available"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("lastAccessed", "lastAccessed", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProjectToCache(
  project: CachedProject,
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(project);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn("Failed to save project to cache:", err);
  }
}

export async function getProjectFromCache(
  id: string,
): Promise<CachedProject | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn("Failed to get project from cache:", err);
    return null;
  }
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("lastAccessed");
      // Get all records, sorted by lastAccessed descending
      const request = index.openCursor(null, "prev");
      const results: RecentProject[] = [];
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const { id, name, lastAccessed, fileCount } = cursor
            .value as CachedProject;
          results.push({ id, name, lastAccessed, fileCount });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn("Failed to get recent projects from cache:", err);
    return [];
  }
}

export async function deleteProjectFromCache(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn("Failed to delete project from cache:", err);
  }
}
