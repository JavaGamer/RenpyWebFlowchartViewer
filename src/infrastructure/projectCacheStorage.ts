import type { FlowEdge, FlowNode } from "../domain/index.ts";
import type { ParseDiagnosticPayload } from "./index.ts";
import type { RenpyFileAst } from "../parser/index.ts";

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
const DB_VERSION = 2;
const STORE_NAME = "projects";
const AST_STORE_NAME = "astCache";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("indexedDB is not available"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      } else {
        store = request.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains("lastAccessed")) {
        store.createIndex("lastAccessed", "lastAccessed", { unique: false });
      }
      if (!db.objectStoreNames.contains(AST_STORE_NAME)) {
        db.createObjectStore(AST_STORE_NAME, { keyPath: "contentHash" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAstToCache(ast: RenpyFileAst): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AST_STORE_NAME, "readwrite");
      const store = tx.objectStore(AST_STORE_NAME);
      store.put(ast);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("Failed to save AST to cache:", err);
  }
}

export async function getAstFromCache(contentHash: string): Promise<RenpyFileAst | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AST_STORE_NAME, "readonly");
      const store = tx.objectStore(AST_STORE_NAME);
      const request = store.get(contentHash);
      let result: RenpyFileAst | null = null;
      request.onsuccess = () => {
        result = request.result || null;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("Failed to get AST from cache:", err);
    return null;
  }
}

export async function saveProjectToCache(
  project: CachedProject,
): Promise<void> {
  try {
    const db = await openDB();
    const entry: CachedProject = {
      ...project,
      lastAccessed: project.lastAccessed || Date.now(),
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
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
      let result: CachedProject | null = null;
      request.onsuccess = () => {
        result = request.result || null;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
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
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(results);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
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
      store.delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn("Failed to delete project from cache:", err);
  }
}
