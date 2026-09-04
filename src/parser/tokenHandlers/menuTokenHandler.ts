import type { ParseGraphState, ParseScanState } from "../pipelineTypes.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "../graphMutations.ts";
import { assertInvariant } from "../pipelineInvariants.ts";
import { menuHasFallthrough } from "../handlers/menuHandler.ts";
import { emitJumpEdge } from "../handlers/jumpCallHandler.ts";
import { menuAtDepth, parentMenuStackLength } from "../scanTransitions.ts";
import {
  extractConditionFlagRefs,
  type SourceLocation,
} from "../../domain/index.ts";

function edgeIdWithOption(baseId: string, optionText: string | null): string {
  if (!optionText) return baseId;
  return `${baseId}_${optionText}`;
}

export function extractMenuOptionCondition(lineText: string): string | null {
  let cleanLine = lineText;
  let inQuote: string | null = null;
  let tripleQuoted = false;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < lineText.length) {
        i++;
      } else if (tripleQuoted) {
        if (
          ch === inQuote &&
          i + 2 < lineText.length &&
          lineText[i + 1] === inQuote &&
          lineText[i + 2] === inQuote
        ) {
          i += 2;
          inQuote = null;
          tripleQuoted = false;
        }
      } else if (ch === inQuote) {
        inQuote = null;
      }
    } else if (
      (ch === '"' || ch === "'") &&
      i + 2 < lineText.length &&
      lineText[i + 1] === ch &&
      lineText[i + 2] === ch
    ) {
      inQuote = ch;
      tripleQuoted = true;
      i += 2;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      tripleQuoted = false;
    } else if (ch === "#") {
      cleanLine = lineText.slice(0, i);
      break;
    }
  }
  let trimmed = cleanLine.trim();
  if (trimmed.endsWith(":")) {
    trimmed = trimmed.slice(0, -1).trim();
  }

  // Scan outside quotes for the first top-level ' if ' following the caption string
  inQuote = null;
  tripleQuoted = false;
  let captionClosed = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inQuote) {
      if (ch === "\\" && i + 1 < trimmed.length) {
        i++;
      } else if (tripleQuoted) {
        if (
          ch === inQuote &&
          i + 2 < trimmed.length &&
          trimmed[i + 1] === inQuote &&
          trimmed[i + 2] === inQuote
        ) {
          i += 2;
          inQuote = null;
          tripleQuoted = false;
          captionClosed = true;
        }
      } else if (ch === inQuote) {
        inQuote = null;
        captionClosed = true;
      }
    } else if (
      (ch === '"' || ch === "'") &&
      i + 2 < trimmed.length &&
      trimmed[i + 1] === ch &&
      trimmed[i + 2] === ch
    ) {
      inQuote = ch;
      tripleQuoted = true;
      i += 2;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      tripleQuoted = false;
    } else if (
      captionClosed &&
      (ch === "i" || ch === "I") &&
      i + 1 < trimmed.length &&
      (trimmed[i + 1] === "f" || trimmed[i + 1] === "F")
    ) {
      const prevChar = i > 0 ? trimmed[i - 1] : " ";
      const nextChar = i + 2 < trimmed.length ? trimmed[i + 2] : " ";
      if (/\s/.test(prevChar) && /\s/.test(nextChar)) {
        const cond = trimmed.slice(i + 2).trim();
        return cond.length > 0 ? cond : null;
      }
    }
  }

  return null;
}

export function handleMenuStatementToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  chapter: string,
  menuDepth: number,
  sourceLocation?: SourceLocation,
  lineIndent?: number,
  lineNum?: number,
): void {
  scanState.currentLabelHasContentSinceSceneBoundary = true;
  const poppedMenus: typeof scanState.menuStack = [];
  while (scanState.menuStack.length > parentMenuStackLength(menuDepth)) {
    const closedMenu = scanState.menuStack.pop();
    if (closedMenu) poppedMenus.push(closedMenu);
  }

  state.menuCounter += 1;
  const newMenuId = `menu_${state.menuCounter}`;
  scanState.waitForMenuNameForId = newMenuId;
  addNode(state, {
    id: newMenuId,
    type: "MENU",
    label: newMenuId,
    dialogueCount: 0,
    chapter,
    parentLabelId: scanState.currentLabelId ?? undefined,
    sourceLocation,
  });

  let connectedIncomingMenu = false;
  if (scanState.pendingMenuFallthrough.length > 0) {
    const currentDecision = scanState
      .conditionalDecisionStack[
        scanState.conditionalDecisionStack.length - 1
      ];
    const connectedFallthroughKeys = new Set<string>();
    const remainingPending: typeof scanState.pendingMenuFallthrough = [];
    for (const entry of scanState.pendingMenuFallthrough) {
      const isSiblingBranch = Boolean(
        currentDecision &&
          entry.decisionNodeId &&
          currentDecision.decisionNodeId === entry.decisionNodeId,
      );
      if (isSiblingBranch) {
        remainingPending.push(entry);
        continue;
      }
      const key = `${entry.menuId}__${entry.optionText ?? ""}`;
      if (!connectedFallthroughKeys.has(key)) {
        addEdge(state, {
          id: edgeIdWithOption(
            `seq_${entry.menuId}__${newMenuId}`,
            entry.optionText ?? null,
          ),
          source: entry.menuId,
          target: newMenuId,
          kind: "sequence",
          label: entry.optionText ?? "next",
          sourceLocation: entry.sourceLocation ?? sourceLocation,
        });
        addOutgoing(state, entry.menuId, "sequence");
        addIncoming(state, newMenuId, "sequence");
        connectedFallthroughKeys.add(key);
        connectedIncomingMenu = true;
      }
    }
    scanState.pendingMenuFallthrough = remainingPending;
  }

  for (const closedMenu of poppedMenus) {
    if (!menuHasFallthrough(closedMenu)) continue;
    const fallthroughOptions = closedMenu.options?.filter((o) => !o.hasExit) ??
      [];
    if (fallthroughOptions.length > 0) {
      for (const option of fallthroughOptions) {
        addEdge(state, {
          id: edgeIdWithOption(
            `seq_${closedMenu.id}__${newMenuId}`,
            option.text ?? null,
          ),
          source: closedMenu.id,
          target: newMenuId,
          kind: "sequence",
          label: option.text ?? "next",
          condition: option.condition,
          sourceLocation,
        });
        addOutgoing(state, closedMenu.id, "sequence");
        addIncoming(state, newMenuId, "sequence");
        connectedIncomingMenu = true;
      }
    } else {
      addEdge(state, {
        id: `seq_${closedMenu.id}__${newMenuId}`,
        source: closedMenu.id,
        target: newMenuId,
        kind: "sequence",
        label: "next",
        sourceLocation,
      });
      addOutgoing(state, closedMenu.id, "sequence");
      addIncoming(state, newMenuId, "sequence");
      connectedIncomingMenu = true;
    }
  }

  const parentMenu = scanState.menuStack[scanState.menuStack.length - 1];
  const decisionContext = scanState
    .conditionalDecisionStack[
      scanState.conditionalDecisionStack.length - 1
    ];
  const source = parentMenu
    ? parentMenu.id
    : (decisionContext?.decisionNodeId ??
      (connectedIncomingMenu ? null : scanState.currentLabelId));
  if (source) {
    const condition = decisionContext
      ? {
        branchKind: decisionContext.branchKind,
        expression: decisionContext.expression ?? undefined,
        references: decisionContext.references,
        decisionNodeId: decisionContext.decisionNodeId,
      }
      : parentMenu?.activeOptionCondition;
    addEdge(state, {
      id: edgeIdWithOption(
        `seq_${source}__${newMenuId}`,
        parentMenu?.optionText ?? null,
      ),
      source,
      target: newMenuId,
      kind: "sequence",
      label: parentMenu?.optionText ?? undefined,
      condition,
      sourceLocation,
    });
    addOutgoing(state, source, "sequence");
    addIncoming(state, newMenuId, "sequence");
  }

  if (scanState.pendingTimedChoice) {
    const pending = scanState.pendingTimedChoice;
    scanState.pendingTimedChoice = null;
    emitJumpEdge(
      state,
      scanState,
      pending.target,
      {
        isInOption: false,
        source: newMenuId,
        optionText: null,
        sourceLocation: pending.sourceLocation,
      },
      false,
      {
        isTimeout: true,
        durationSeconds: pending.durationSeconds,
      },
    );
  }

  scanState.menuStack.push({
    id: newMenuId,
    optionText: null,
    activeOptionCondition: undefined,
    decisionNodeId: decisionContext?.decisionNodeId,
    options: [],
    sourceLocation: sourceLocation ? { ...sourceLocation } : undefined,
    indent: lineIndent,
    lineNum,
  });
  assertInvariant(
    scanState.menuStack.length <= menuDepth,
    `menu stack depth exceeded menu meta depth (${scanState.menuStack.length} > ${menuDepth})`,
  );
}

export function handleMenuNameToken(
  state: ParseGraphState,
  scanState: ParseScanState,
  menuLabel: string,
): void {
  const existing = state.nodeMap.get(scanState.waitForMenuNameForId!);
  if (existing) existing.label = menuLabel;
  scanState.waitForMenuNameForId = null;
}

export function handleMenuOptionToken(
  scanState: ParseScanState,
  optionValue: string,
  menuDepth: number,
  lineText?: string,
): void {
  const menu = menuAtDepth(scanState.menuStack, menuDepth);
  if (menu) {
    menu.optionText = optionValue;
    if (!menu.options) {
      menu.options = [];
    }
    const condExpr = lineText ? extractMenuOptionCondition(lineText) : null;
    if (condExpr) {
      const references = extractConditionFlagRefs(condExpr);
      const condition = {
        branchKind: "if" as const,
        expression: condExpr,
        references,
      };
      menu.activeOptionCondition = condition;
      menu.options.push({ text: optionValue, hasExit: false, condition });
    } else {
      menu.activeOptionCondition = undefined;
      menu.options.push({ text: optionValue, hasExit: false });
    }
  }
}
