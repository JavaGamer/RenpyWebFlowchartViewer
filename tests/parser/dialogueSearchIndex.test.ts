import { describe, expect, it } from "vitest";
import {
  buildDialogueSearchIndex,
  type DialogueSearchTargetSession,
  searchDialogueIndex,
} from "../../src/parser/dialogueSearchIndex.ts";
import type { FlowNode, ProjectTranslations } from "../../src/domain/index.ts";
import type { ParseGraphState } from "../../src/parser/pipelineTypes.ts";

function createMockSession(): DialogueSearchTargetSession {
  const nodeMap = new Map<string, FlowNode>();
  nodeMap.set("node_intro", {
    id: "node_intro",
    label: "Introduction",
    type: "LABEL",
    dialogueLines: ["Hello world", "Welcome to the story"],
  } as FlowNode);
  nodeMap.set("node_middle", {
    id: "node_middle",
    label: "Middle Scene",
    type: "LABEL",
    dialogueLines: ["Another adventure begins"],
  } as FlowNode);

  const canonicalLabelIdByName = new Map<string, string>();
  canonicalLabelIdByName.set("aliased_label", "node_middle");
  canonicalLabelIdByName.set("ending", "node_ending_canonical");

  const accumulatedState: ParseGraphState = {
    nodeMap,
    canonicalLabelIdByName,
    translations: undefined,
  } as unknown as ParseGraphState;

  return {
    accumulatedState,
    dialogueSearchDocs: [],
    dialogueSearchMiniSearch: null,
  };
}

describe("DialogueSearchIndex", () => {
  it("builds index from flow nodes and allows searching", () => {
    const session = createMockSession();
    const nodes: FlowNode[] = [
      {
        id: "node_intro",
        label: "Introduction",
        type: "LABEL",
        dialogueLines: ["Hello world", "Welcome to the story"],
      } as FlowNode,
      {
        id: "node_empty",
        label: "Empty Node",
        type: "LABEL",
        dialogueLines: [],
      } as FlowNode,
    ];

    buildDialogueSearchIndex(session, nodes);

    expect(session.dialogueSearchDocs).toHaveLength(2);
    expect(session.dialogueSearchMiniSearch).not.toBeNull();

    // Query match
    const results = searchDialogueIndex(session, "Hello");
    expect(results).toHaveLength(1);
    expect(results[0]?.nodeId).toBe("node_intro");
    expect(results[0]?.lineIndex).toBe(1);
    expect(results[0]?.lineText).toBe("Hello world");

    // Scoped node search
    const scoped = searchDialogueIndex(session, "world", {
      nodeIds: ["non_existent_node"],
    });
    expect(scoped).toHaveLength(0);

    const scopedMatch = searchDialogueIndex(session, "world", {
      nodeIds: ["node_intro"],
    });
    expect(scopedMatch).toHaveLength(1);

    // Max results limit
    const limited = searchDialogueIndex(session, "to", {
      maxResults: 1,
    });
    expect(limited).toHaveLength(1);
  });

  it("handles empty nodes and empty queries gracefully", () => {
    const session = createMockSession();
    buildDialogueSearchIndex(session, []);

    expect(session.dialogueSearchDocs).toHaveLength(0);
    expect(session.dialogueSearchMiniSearch).toBeNull();

    // Search on null index
    expect(searchDialogueIndex(session, "hello")).toEqual([]);

    // Search with blank query
    expect(searchDialogueIndex(session, "   ")).toEqual([]);
  });

  it("indexes translations with canonical node ID resolution branches", () => {
    const session = createMockSession();

    const translations: ProjectTranslations = {
      availableLanguages: ["es", "fr"],
      translationsByLanguage: {
        es: {
          language: "es",
          strings: {},
          dialogueByNodeId: {
            // 1. Direct nodeMap match
            node_intro: ["Hola mundo"],
            // 2. Hash match where stripped is in nodeMap
            node_intro_1234abcd: ["Bienvenidos"],
            // 3. Hash match where stripped is in canonicalLabelIdByName
            aliased_label_aabbccdd: ["Aventura"],
            // 4. No hash, but rawBlockId in canonicalLabelIdByName
            ending: ["Fin de la historia"],
            // 5. Fallback rawBlockId (not in nodeMap or canonical map)
            unknown_block: ["Texto desconocido"],
          },
        },
      },
    };

    // Index with translations passed directly
    buildDialogueSearchIndex(session, [], translations);

    expect(session.dialogueSearchDocs.length).toBeGreaterThan(0);

    // Verify search matches translated dialogue
    const results = searchDialogueIndex(session, "Hola");
    expect(results).toHaveLength(1);
    expect(results[0]?.lineText).toBe("Hola mundo");

    const unknownSearch = searchDialogueIndex(session, "desconocido");
    expect(unknownSearch).toHaveLength(1);
    expect(unknownSearch[0]?.nodeLabel).toBe("unknown_block");
  });

  it("uses session.accumulatedState.translations when translation argument is omitted", () => {
    const session = createMockSession();
    session.accumulatedState.translations = {
      availableLanguages: ["ja"],
      translationsByLanguage: {
        ja: {
          language: "ja",
          strings: {},
          dialogueByNodeId: {
            node_intro: ["こんにちは"],
          },
        },
      },
    };

    buildDialogueSearchIndex(session, []);
    expect(session.dialogueSearchDocs).toHaveLength(1);

    const results = searchDialogueIndex(session, "こんにちは");
    expect(results).toHaveLength(1);
  });
});
