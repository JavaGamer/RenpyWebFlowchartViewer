import { describe, expect, it } from "vitest";
import type { RenpyFileAst } from "../../src/parser/astTypes";
import { getAstFromCache, saveAstToCache } from "../../src/infrastructure/projectCacheStorage";

describe("Phase 3: Caching & AST Standardization Infrastructure", () => {
  it("validates intermediate RenpyFileAst data structure", () => {
    const ast: RenpyFileAst = {
      filePath: "game/script.rpy",
      contentHash: "abc123hash",
      nodes: [
        {
          type: "label",
          name: "start",
          isSubLabel: false,
          filePath: "game/script.rpy",
          lineIndex: 1,
          indent: 0,
        },
        {
          type: "jump",
          target: "chapter1",
          isExpression: false,
          filePath: "game/script.rpy",
          lineIndex: 5,
          indent: 4,
        },
      ],
    };

    expect(ast.filePath).toBe("game/script.rpy");
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[0].type).toBe("label");
    expect(ast.nodes[1].type).toBe("jump");
  });

  it("handles saveAstToCache and getAstFromCache gracefully in non-browser env", async () => {
    const mockAst: RenpyFileAst = {
      filePath: "game/test.rpy",
      contentHash: "hash_test_123",
      nodes: [],
    };

    await saveAstToCache(mockAst);
    const retrieved = await getAstFromCache("hash_test_123");
    // IndexedDB is un-mocked in Node/Deno environment by default so should safely return null
    expect(retrieved).toBeNull();
  });
});
