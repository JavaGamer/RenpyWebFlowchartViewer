/**
 * src/parser.ts
 *
 * Client-side Ren'Py script parser.
 *
 * Uses @renpy/ast to tokenize .rpy source files and walks the flattened token
 * stream to extract:
 *   - label blocks  (LABEL nodes)
 *   - menu blocks   (MENU nodes)
 *   - jump / call statements → directed edges
 *   - dialogue line counts (SayStatement / NarratorSayStatement)
 */

import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { FlowNode, FlowEdge } from './types';

// Monotonically increasing version counter so that each call to renpyParse
// produces a document with a unique (uri, version) pair, preventing
// @renpy/ast's static TokenCache from returning stale tokens across calls.
let _docVersion = 0;

async function renpyParse(content: string) {
  const document = TextDocument.create('file://my.rpy', 'rpy', ++_docVersion, content);
  return { document, nodes: await Tokenizer.tokenizeDocument(document) };
}

// ─── Token-type numeric constants (from @renpy/ast enums) ────────────────────

// KeywordTokenType
const KW_LABEL = 8;
const KW_JUMP = 63;
const KW_CALL = 64;
const KW_RETURN = 62;
// Note: @renpy/ast tokenizes the `menu` keyword as type 81 (KeywordTokenType.Def)
// rather than type 9 (KeywordTokenType.Menu) — this is a quirk of the tokenizer.
const KW_RENPY_MENU = 81;

// EntityTokenType
const ET_FUNCTION_NAME = 1005;

// LiteralTokenType
const LIT_STRING = 2001;

// MetaTokenType
const META_LABEL_STATEMENT = 6029;
const META_MENU_STATEMENT = 6025;
const META_MENU_BLOCK = 6026;
const META_MENU_OPTION = 6027;
const META_MENU_OPTION_BLOCK = 6028;
const META_JUMP_STATEMENT = 6047;
const META_CALL_STATEMENT = 6043;
const META_SAY_NARRATOR = 6067; // "text" (no character)
const META_SAY_CHARACTER = 6068; // char "text"
const META_SAY_STATEMENT = 6065; // generic say

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return true when the iterable `metas` contains `value`. */
function hasMeta(metas: Iterable<number>, value: number): boolean {
  for (const m of metas) {
    if (m === value) return true;
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Parse one or more .rpy file contents and return the flowchart graph data.
 *
 * @param files  Array of `{ name, content }` objects — one per .rpy file.
 */
export async function parseRenpyFiles(
  files: { name: string; content: string }[],
): Promise<ParseResult> {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // Track IDs we've already added so multiple files don't duplicate nodes.
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  const addNode = (node: FlowNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  const addEdge = (edge: FlowEdge) => {
    if (!edgeIds.has(edge.id)) {
      edgeIds.add(edge.id);
      edges.push(edge);
    }
  };

  let menuCounter = 0;

  for (const file of files) {
    const { document, nodes: tokenTree } = await renpyParse(file.content);
    const flat = tokenTree.flatten();

    // ── Per-file state ────────────────────────────────────────────────────────
    let currentLabelId: string | null = null;
    let currentMenuId: string | null = null;
    /** Last seen menu-option string (used to label the outgoing edge). */
    let currentOptionText: string | null = null;
    /** Whether the current label already has an explicit control-flow exit. */
    let labelHasExplicitExit = false;

    // Pending-name flags
    let waitForLabelName = false;
    let waitForJumpTarget = false;
    let waitForCallTarget = false;
    let waitForMenuName = false;

    for (const tok of flat) {
      const type = tok.type as number;
      const metas = tok.metaTokens as Iterable<number>;
      const val = (): string => tok.getValue(document);

      // ── Label keyword → start a new label block ───────────────────────────
      if (type === KW_LABEL && hasMeta(metas, META_LABEL_STATEMENT)) {
        // Before starting a new label, check if the previous one falls through
        // (no explicit jump/call/return) directly into this new label.
        if (currentLabelId && !labelHasExplicitExit && currentMenuId === null) {
          // Will be wired once we know the new label name — store for later.
          // We handle this at the FunctionName step below.
          waitForLabelName = true;
        } else {
          waitForLabelName = true;
        }
        // Reset per-label state
        currentMenuId = null;
        currentOptionText = null;
        waitForJumpTarget = false;
        waitForCallTarget = false;
        waitForMenuName = false;
        continue;
      }

      // ── FunctionName inside a LabelStatement → label name ─────────────────
      if (
        type === ET_FUNCTION_NAME &&
        waitForLabelName &&
        hasMeta(metas, META_LABEL_STATEMENT)
      ) {
        const newLabelId = val();
        // Sequence edge: previous label falls through into this one
        if (
          currentLabelId !== null &&
          !labelHasExplicitExit &&
          currentMenuId === null
        ) {
          addEdge({
            id: `seq_${currentLabelId}__${newLabelId}`,
            source: currentLabelId,
            target: newLabelId,
            label: 'next',
          });
        }
        currentLabelId = newLabelId;
        labelHasExplicitExit = false;
        waitForLabelName = false;
        addNode({
          id: currentLabelId,
          type: 'LABEL',
          label: currentLabelId,
          dialogueCount: 0,
        });
        continue;
      }

      // Skip tokens before the first label is identified
      if (currentLabelId === null) continue;

      // ── Menu keyword → start a new menu block inside the current label ─────
      // @renpy/ast tokenizes `menu` as KW_RENPY_MENU (81) with META_MENU_STATEMENT.
      if (
        type === KW_RENPY_MENU &&
        hasMeta(metas, META_MENU_STATEMENT) &&
        !hasMeta(metas, META_MENU_BLOCK)
      ) {
        if (currentMenuId === null) {
          menuCounter += 1;
          currentMenuId = `menu_${menuCounter}`;
          waitForMenuName = true;
          addNode({
            id: currentMenuId,
            type: 'MENU',
            label: `menu_${menuCounter}`,
            dialogueCount: 0,
          });
          // Sequence edge: label → its menu
          addEdge({
            id: `seq_${currentLabelId}__${currentMenuId}`,
            source: currentLabelId,
            target: currentMenuId,
            label: undefined,
          });
          // The label's execution falls into the menu — suppress label→label sequence.
          labelHasExplicitExit = true;
        }
        continue;
      }

      // ── FunctionName inside MenuStatement (not MenuBlock) → optional menu label
      if (
        type === ET_FUNCTION_NAME &&
        waitForMenuName &&
        hasMeta(metas, META_MENU_STATEMENT) &&
        !hasMeta(metas, META_MENU_BLOCK)
      ) {
        const menuLabel = val();
        if (currentMenuId) {
          const existing = nodes.find((n) => n.id === currentMenuId);
          if (existing) existing.label = menuLabel;
        }
        waitForMenuName = false;
        continue;
      }

      // ── String inside MenuOption → option text ────────────────────────────
      if (
        type === LIT_STRING &&
        hasMeta(metas, META_MENU_OPTION) &&
        hasMeta(metas, META_MENU_BLOCK)
      ) {
        currentOptionText = val();
        continue;
      }

      // ── Jump keyword ──────────────────────────────────────────────────────
      if (type === KW_JUMP && hasMeta(metas, META_JUMP_STATEMENT)) {
        waitForJumpTarget = true;
        continue;
      }

      // ── FunctionName inside JumpStatement → jump target ───────────────────
      if (
        type === ET_FUNCTION_NAME &&
        waitForJumpTarget &&
        hasMeta(metas, META_JUMP_STATEMENT)
      ) {
        const target = val();
        const isInOption = hasMeta(metas, META_MENU_OPTION_BLOCK);
        const source = isInOption && currentMenuId ? currentMenuId : currentLabelId;
        if (source) {
          addEdge({
            id: `jump_${source}__${target}_${currentOptionText ?? ''}`,
            source,
            target,
            label: isInOption ? (currentOptionText ?? undefined) : undefined,
          });
        }
        if (!isInOption) labelHasExplicitExit = true;
        waitForJumpTarget = false;
        continue;
      }

      // ── Call keyword ──────────────────────────────────────────────────────
      if (type === KW_CALL && hasMeta(metas, META_CALL_STATEMENT)) {
        waitForCallTarget = true;
        continue;
      }

      // ── FunctionName inside CallStatement → call target ───────────────────
      if (
        type === ET_FUNCTION_NAME &&
        waitForCallTarget &&
        hasMeta(metas, META_CALL_STATEMENT)
      ) {
        const target = val();
        const isInOption = hasMeta(metas, META_MENU_OPTION_BLOCK);
        const source = isInOption && currentMenuId ? currentMenuId : currentLabelId;
        if (source) {
          addEdge({
            id: `call_${source}__${target}_${currentOptionText ?? ''}`,
            source,
            target,
            label: isInOption
              ? (currentOptionText ? `call: ${currentOptionText}` : 'call')
              : 'call',
          });
        }
        // `call` returns, so don't mark labelHasExplicitExit
        waitForCallTarget = false;
        continue;
      }

      // ── Return keyword → label exits explicitly ───────────────────────────
      if (type === KW_RETURN && !hasMeta(metas, META_MENU_OPTION_BLOCK)) {
        labelHasExplicitExit = true;
        continue;
      }

      // ── Dialogue lines → increment count on the owning node ──────────────
      if (type === LIT_STRING) {
        const isSay =
          hasMeta(metas, META_SAY_NARRATOR) ||
          hasMeta(metas, META_SAY_CHARACTER) ||
          hasMeta(metas, META_SAY_STATEMENT);
        const isMenuOption = hasMeta(metas, META_MENU_OPTION);

        if (isSay && !isMenuOption) {
          // Attribute the line to the innermost block
          const ownerId =
            hasMeta(metas, META_MENU_OPTION_BLOCK) && currentMenuId
              ? currentMenuId
              : currentLabelId;
          if (ownerId) {
            const ownerNode = nodes.find((n) => n.id === ownerId);
            if (ownerNode) ownerNode.dialogueCount += 1;
          }
        }
      }
    }
  }

  return { nodes, edges };
}
