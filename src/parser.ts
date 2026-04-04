/**
 * src/parser.ts
 *
 * Client-side Ren'Py script parser.
 */

import { Tokenizer } from '@renpy/ast/out/tokenizer/tokenizer';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { FlowNode, FlowEdge } from './types';
import { PARSER_TOKENS } from './parserTokens';
import { createPerfTracker } from './perf';

let _docVersion = 0;

type EdgeKind = 'sequence' | 'jump' | 'call';

interface ParseScanState {
  currentLabelId: string | null;
  menuStack: Array<{ id: string; optionText: string | null }>;
  conditionalIndentStack: number[];
  labelHasExplicitExit: boolean;
  waitForLabelName: boolean;
  waitForJumpTarget: boolean;
  waitForCallTarget: boolean;
  waitForMenuNameForId: string | null;
}

interface ParseGraphState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  nodeMap: Map<string, FlowNode>;
  menuCounter: number;
  allLabelIds: Set<string>;
  incomingByLabel: Map<string, Set<EdgeKind>>;
  outgoingByLabel: Map<string, Set<EdgeKind>>;
  hasReturnInLabel: Set<string>;
  calledLabels: Set<string>;
  calledFromMenuOptionTargets: Set<string>;
  pendingCallReturns: Array<{ callerLabelId: string; callTargetId: string }>;
}

export interface ParseResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface ParseProgress {
  doneFiles: number;
  totalFiles: number;
  currentFile: string;
}

export interface ParseOptions {
  onProgress?: (progress: ParseProgress) => void;
}

function createGraphState(): ParseGraphState {
  return {
    nodes: [],
    edges: [],
    nodeIds: new Set<string>(),
    edgeIds: new Set<string>(),
    nodeMap: new Map<string, FlowNode>(),
    menuCounter: 0,
    allLabelIds: new Set<string>(),
    incomingByLabel: new Map<string, Set<EdgeKind>>(),
    outgoingByLabel: new Map<string, Set<EdgeKind>>(),
    hasReturnInLabel: new Set<string>(),
    calledLabels: new Set<string>(),
    calledFromMenuOptionTargets: new Set<string>(),
    pendingCallReturns: [],
  };
}

function createScanState(): ParseScanState {
  return {
    currentLabelId: null,
    menuStack: [],
    conditionalIndentStack: [],
    labelHasExplicitExit: false,
    waitForLabelName: false,
    waitForJumpTarget: false,
    waitForCallTarget: false,
    waitForMenuNameForId: null,
  };
}

function assertInvariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[parser] Internal invariant failed: ${message}`);
  }
}

function parentMenuStackLength(menuDepth: number): number {
  return Math.max(0, menuDepth - 1);
}

interface TokenMetaFlags {
  menuDepth: number;
  hasLabelStatement: boolean;
  hasMenuStatement: boolean;
  hasMenuBlock: boolean;
  hasMenuOption: boolean;
  hasMenuOptionBlock: boolean;
  hasJumpStatement: boolean;
  hasCallStatement: boolean;
  hasSayNarrator: boolean;
  hasSayCharacter: boolean;
  hasSayStatement: boolean;
}

function analyzeTokenMeta(metas: Iterable<number>): TokenMetaFlags {
  let menuDepth = 0;
  let hasLabelStatement = false;
  let hasMenuStatement = false;
  let hasMenuBlock = false;
  let hasMenuOption = false;
  let hasMenuOptionBlock = false;
  let hasJumpStatement = false;
  let hasCallStatement = false;
  let hasSayNarrator = false;
  let hasSayCharacter = false;
  let hasSayStatement = false;

  for (const m of metas) {
    if (m === PARSER_TOKENS.metaMenuStatement) {
      menuDepth += 1;
      hasMenuStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaLabelStatement) {
      hasLabelStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaMenuBlock) {
      hasMenuBlock = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaMenuOption) {
      hasMenuOption = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaMenuOptionBlock) {
      hasMenuOptionBlock = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaJumpStatement) {
      hasJumpStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaCallStatement) {
      hasCallStatement = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaSayNarrator) {
      hasSayNarrator = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaSayCharacter) {
      hasSayCharacter = true;
      continue;
    }
    if (m === PARSER_TOKENS.metaSayStatement) {
      hasSayStatement = true;
    }
  }

  return {
    menuDepth,
    hasLabelStatement,
    hasMenuStatement,
    hasMenuBlock,
    hasMenuOption,
    hasMenuOptionBlock,
    hasJumpStatement,
    hasCallStatement,
    hasSayNarrator,
    hasSayCharacter,
    hasSayStatement,
  };
}

function edgeIdWithOption(base: string, optionText: string | null | undefined): string {
  return optionText ? `${base}_${optionText}` : base;
}

function menuAtDepth(
  menuStack: { id: string; optionText: string | null }[],
  depth: number,
): { id: string; optionText: string | null } | null {
  return depth > 0 ? (menuStack[depth - 1] ?? null) : null;
}

async function renpyParse(content: string) {
  const document = TextDocument.create('file://my.rpy', 'rpy', ++_docVersion, content);
  return { document, nodes: await Tokenizer.tokenizeDocument(document) };
}

function addNode(state: ParseGraphState, node: FlowNode) {
  if (!state.nodeIds.has(node.id)) {
    state.nodeIds.add(node.id);
    state.nodes.push(node);
    state.nodeMap.set(node.id, node);
  }
}

function addEdge(state: ParseGraphState, edge: FlowEdge) {
  if (!state.edgeIds.has(edge.id)) {
    assertInvariant(Boolean(edge.source), `edge ${edge.id} has empty source`);
    assertInvariant(Boolean(edge.target), `edge ${edge.id} has empty target`);
    state.edgeIds.add(edge.id);
    state.edges.push(edge);
  }
}

function addIncoming(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  const existing = state.incomingByLabel.get(labelId) ?? new Set<EdgeKind>();
  existing.add(kind);
  state.incomingByLabel.set(labelId, existing);
}

function addOutgoing(state: ParseGraphState, labelId: string, kind: EdgeKind) {
  const existing = state.outgoingByLabel.get(labelId) ?? new Set<EdgeKind>();
  existing.add(kind);
  state.outgoingByLabel.set(labelId, existing);
}

function maybeUpdateConditionalState(
  scanState: ParseScanState,
  type: number,
  getTokenText: () => string,
  indent: number,
) {
  if (type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline) {
    return;
  }

  while (
    scanState.conditionalIndentStack.length > 0 &&
    indent <= scanState.conditionalIndentStack[scanState.conditionalIndentStack.length - 1]
  ) {
    scanState.conditionalIndentStack.pop();
  }

  if (
    type === PARSER_TOKENS.kwConditional &&
    (() => {
      const tokenText = getTokenText();
      return tokenText === 'if' || tokenText === 'elif' || tokenText === 'else';
    })()
  ) {
    scanState.conditionalIndentStack.push(indent);
  }
}

function finalizeRoles(state: ParseGraphState) {
  for (const { callerLabelId, callTargetId } of state.pendingCallReturns) {
    addEdge(state, {
      id: `ret_${callTargetId}__${callerLabelId}`,
      source: callTargetId,
      target: callerLabelId,
      kind: 'call_return',
      label: 'return',
    });
  }

  for (const node of state.nodes) {
    if (node.type === 'MENU') {
      node.role = 'menu';
      continue;
    }

    const incoming = state.incomingByLabel.get(node.id) ?? new Set<EdgeKind>();
    const outgoing = state.outgoingByLabel.get(node.id) ?? new Set<EdgeKind>();
    const hasReturn = state.hasReturnInLabel.has(node.id);
    const isCalled = state.calledLabels.has(node.id);
    const isCalledFromMenuOption = state.calledFromMenuOptionTargets.has(node.id);
    const hasStoryTraffic =
      incoming.has('sequence') ||
      outgoing.has('sequence') ||
      incoming.has('jump') ||
      outgoing.has('jump');

    if (hasReturn && !hasStoryTraffic && !isCalled) {
      node.role = 'state_toggle';
    } else if (isCalledFromMenuOption && hasReturn) {
      node.role = 'detour';
    } else if (isCalled && hasReturn && !hasStoryTraffic) {
      node.role = 'utility';
    } else {
      node.role = 'story';
    }
  }
}

async function parseOneFile(state: ParseGraphState, file: { name: string; content: string }) {
  const chapter = file.name.replace(/\.rpy$/i, '');
  const { document, nodes: tokenTree } = await renpyParse(file.content);
  const flat = tokenTree.flatten();
  const scanState = createScanState();

  for (const tok of flat) {
    const type = tok.type as number;
    const meta = analyzeTokenMeta(tok.metaTokens as Iterable<number>);
    let tokenText: string | undefined;
    const val = (): string => {
      if (tokenText === undefined) tokenText = tok.getValue(document);
      return tokenText;
    };
    const menuDepth = meta.menuDepth;

    maybeUpdateConditionalState(scanState, type, val, tok.startPos.character);

    if (type === PARSER_TOKENS.kwLabel && meta.hasLabelStatement) {
      scanState.waitForLabelName = true;
      scanState.menuStack.length = 0;
      scanState.conditionalIndentStack.length = 0;
      scanState.waitForJumpTarget = false;
      scanState.waitForCallTarget = false;
      scanState.waitForMenuNameForId = null;
      continue;
    }

    if (
      type === PARSER_TOKENS.entityFunctionName &&
      scanState.waitForLabelName &&
      meta.hasLabelStatement
    ) {
      const newLabelId = val();
      if (
        scanState.currentLabelId !== null &&
        !scanState.labelHasExplicitExit &&
        scanState.menuStack.length === 0
      ) {
        addEdge(state, {
          id: `seq_${scanState.currentLabelId}__${newLabelId}`,
          source: scanState.currentLabelId,
          target: newLabelId,
          kind: 'sequence',
          label: 'next',
        });
        addOutgoing(state, scanState.currentLabelId, 'sequence');
        addIncoming(state, newLabelId, 'sequence');
      }

      scanState.currentLabelId = newLabelId;
      state.allLabelIds.add(newLabelId);
      scanState.labelHasExplicitExit = false;
      scanState.waitForLabelName = false;

      addNode(state, {
        id: newLabelId,
        type: 'LABEL',
        label: newLabelId,
        dialogueCount: 0,
        chapter,
      });
      continue;
    }

    if (scanState.currentLabelId === null) continue;

    if (type === PARSER_TOKENS.kwMenuObserved && meta.hasMenuStatement) {
      while (scanState.menuStack.length > parentMenuStackLength(menuDepth)) {
        scanState.menuStack.pop();
      }

      state.menuCounter += 1;
      const newMenuId = `menu_${state.menuCounter}`;
      scanState.waitForMenuNameForId = newMenuId;
      addNode(state, {
        id: newMenuId,
        type: 'MENU',
        label: newMenuId,
        dialogueCount: 0,
        chapter,
        parentLabelId: scanState.currentLabelId,
      });

      const parentMenu = scanState.menuStack[scanState.menuStack.length - 1];
      const source = parentMenu ? parentMenu.id : scanState.currentLabelId;
      if (source) {
        addEdge(state, {
          id: edgeIdWithOption(`seq_${source}__${newMenuId}`, parentMenu?.optionText),
          source,
          target: newMenuId,
          kind: 'sequence',
          label: parentMenu?.optionText ?? undefined,
        });
      }

      scanState.menuStack.push({ id: newMenuId, optionText: null });
      assertInvariant(
        scanState.menuStack.length <= menuDepth,
        `menu stack depth exceeded menu meta depth (${scanState.menuStack.length} > ${menuDepth})`,
      );

      if (scanState.conditionalIndentStack.length === 0) {
        scanState.labelHasExplicitExit = true;
      }
      continue;
    }

    if (
      type === PARSER_TOKENS.entityFunctionName &&
      scanState.waitForMenuNameForId !== null &&
      meta.hasMenuStatement &&
      !meta.hasMenuBlock
    ) {
      const menuLabel = val();
      const existing = state.nodeMap.get(scanState.waitForMenuNameForId);
      if (existing) existing.label = menuLabel;
      scanState.waitForMenuNameForId = null;
      continue;
    }

    if (
      type === PARSER_TOKENS.literalString &&
      meta.hasMenuOption &&
      meta.hasMenuBlock
    ) {
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      if (menu) menu.optionText = val();
      continue;
    }

    if (type === PARSER_TOKENS.kwJump && meta.hasJumpStatement) {
      scanState.waitForJumpTarget = true;
      continue;
    }

    if (
      type === PARSER_TOKENS.entityFunctionName &&
      scanState.waitForJumpTarget &&
      meta.hasJumpStatement
    ) {
      const target = val();
      const isInOption = meta.hasMenuOptionBlock;
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      const source = isInOption && menu ? menu.id : scanState.currentLabelId;
      const optionText = menu?.optionText ?? null;
      if (source) {
        addEdge(state, {
          id: `jump_${source}__${target}_${optionText ?? ''}`,
          source,
          target,
          kind: 'jump',
          label: isInOption ? (optionText ?? undefined) : undefined,
        });
      }
      if (!isInOption && scanState.currentLabelId) {
        addOutgoing(state, scanState.currentLabelId, 'jump');
        addIncoming(state, target, 'jump');
      }
      if (!isInOption && scanState.conditionalIndentStack.length === 0) {
        scanState.labelHasExplicitExit = true;
      }
      scanState.waitForJumpTarget = false;
      continue;
    }

    if (type === PARSER_TOKENS.kwCall && meta.hasCallStatement) {
      scanState.waitForCallTarget = true;
      continue;
    }

    if (
      type === PARSER_TOKENS.entityFunctionName &&
      scanState.waitForCallTarget &&
      meta.hasCallStatement
    ) {
      const target = val();
      const isInOption = meta.hasMenuOptionBlock;
      const menu = menuAtDepth(scanState.menuStack, menuDepth);
      const source = isInOption && menu ? menu.id : scanState.currentLabelId;
      const optionText = menu?.optionText ?? null;
      if (source) {
        addEdge(state, {
          id: `call_${source}__${target}_${optionText ?? ''}`,
          source,
          target,
          kind: 'call',
          label: isInOption ? (optionText ? `call: ${optionText}` : 'call') : 'call',
        });
      }

      state.calledLabels.add(target);
      if (!isInOption && scanState.currentLabelId) {
        addOutgoing(state, scanState.currentLabelId, 'call');
        addIncoming(state, target, 'call');
        state.pendingCallReturns.push({
          callerLabelId: scanState.currentLabelId,
          callTargetId: target,
        });
      }
      if (isInOption) state.calledFromMenuOptionTargets.add(target);

      scanState.waitForCallTarget = false;
      continue;
    }

    if (type === PARSER_TOKENS.kwReturn && !meta.hasMenuOptionBlock) {
      scanState.labelHasExplicitExit = true;
      state.hasReturnInLabel.add(scanState.currentLabelId);
      continue;
    }

    if (type === PARSER_TOKENS.literalString) {
      const isSay =
        meta.hasSayNarrator ||
        meta.hasSayCharacter ||
        meta.hasSayStatement;
      const isMenuOption = meta.hasMenuOption;

      if (isSay && !isMenuOption) {
        const menu = menuAtDepth(scanState.menuStack, menuDepth);
        const ownerId =
          meta.hasMenuOptionBlock && menu
            ? menu.id
            : scanState.currentLabelId;

        if (ownerId) {
          const ownerNode = state.nodeMap.get(ownerId);
          if (ownerNode) ownerNode.dialogueCount += 1;
        }
      }
    }
  }
}

export async function parseRenpyFiles(
  files: { name: string; content: string }[],
  options: ParseOptions = {},
): Promise<ParseResult> {
  const perf = createPerfTracker('parser');
  perf.mark('total');
  const state = createGraphState();

  for (let idx = 0; idx < files.length; idx += 1) {
    const file = files[idx];
    perf.mark(`file:${idx}`);
    await parseOneFile(state, file);
    perf.measure(`file:${idx}`, 'parse_file_ms', { file: file.name });
    options.onProgress?.({
      doneFiles: idx + 1,
      totalFiles: files.length,
      currentFile: file.name,
    });
  }

  perf.mark('finalize');
  finalizeRoles(state);
  perf.measure('finalize', 'finalize_roles_ms', { nodes: state.nodes.length });
  perf.measure('total', 'parse_total_ms', {
    files: files.length,
    nodes: state.nodes.length,
    edges: state.edges.length,
  });
  return { nodes: state.nodes, edges: state.edges };
}
