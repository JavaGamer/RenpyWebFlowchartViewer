import type { ParseGraphState, ParseScanState } from "../pipelineTypes.ts";
import {
  addEdge,
  addIncoming,
  addNode,
  addOutgoing,
} from "../graphMutations.ts";
import { assertInvariant } from "../pipelineInvariants.ts";
import { menuHasFallthrough } from "../handlers/menuHandler.ts";
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
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (inQuote) {
      if (ch === "\\" && i + 1 < lineText.length) {
        i++;
      } else if (ch === inQuote) {
        inQuote = null;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "#") {
      cleanLine = lineText.slice(0, i);
      break;
    }
  }
  let trimmed = cleanLine.trim();
  if (trimmed.endsWith(":")) {
    trimmed = trimmed.slice(0, -1).trim();
  }

  // Scan outside quotes for ' if '
  inQuote = null;
  let lastIfIndex = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inQuote) {
      if (ch === "\\" && i + 1 < trimmed.length) {
        i++;
      } else if (ch === inQuote) {
        inQuote = null;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (
      (ch === "i" || ch === "I") &&
      i + 1 < trimmed.length &&
      (trimmed[i + 1] === "f" || trimmed[i + 1] === "F")
    ) {
      const prevChar = i > 0 ? trimmed[i - 1] : " ";
      const nextChar = i + 2 < trimmed.length ? trimmed[i + 2] : " ";
      if (/\s/.test(prevChar) && /\s/.test(nextChar)) {
        lastIfIndex = i;
      }
    }
  }

  if (lastIfIndex !== -1) {
    const cond = trimmed.slice(lastIfIndex + 2).trim();
    if (cond.length > 0) {
      return cond;
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
  for (const closedMenu of poppedMenus) {
    if (!menuHasFallthrough(closedMenu)) continue;
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
  }

  const parentMenu = scanState.menuStack[scanState.menuStack.length - 1];
  const decisionContext = scanState
    .conditionalDecisionStack[
      scanState.conditionalDecisionStack.length - 1
    ];
  const source = parentMenu
    ? parentMenu.id
    : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
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

  scanState.menuStack.push({
    id: newMenuId,
    optionText: null,
    activeOptionCondition: undefined,
    options: [],
    sourceLocation: sourceLocation ? { ...sourceLocation } : undefined,
  });
  assertInvariant(
    scanState.menuStack.length <= menuDepth,
    `menu stack depth exceeded menu meta depth (${scanState.menuStack.length} > ${menuDepth})`,
  );

  if (scanState.conditionalIndentStack.length === 0) {
    scanState.labelHasExplicitExit = true;
  }
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
