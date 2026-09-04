import { PARSER_TOKENS } from "./parserTokens.ts";
import type {
  ConditionalBranchKind,
  ParseGraphState,
  ParseScanState,
  TokenMetaFlags,
} from "./pipelineTypes.ts";
import { menuHasFallthrough } from "./handlers/menuHandler.ts";
import type { SourceLocation } from "../domain/index.ts";

/**
 * Calculates the index of the parent menu block in the menu stack based on menu depth.
 */
export function parentMenuStackLength(menuDepth: number): number {
  return Math.max(0, menuDepth - 1);
}

/**
 * Safely retrieves the menu context definition located at the specified stack depth.
 * Returns null if the depth is out of bounds or invalid.
 */
export function menuAtDepth(
  menuStack: ParseScanState["menuStack"],
  depth: number,
): ParseScanState["menuStack"][number] | null {
  return depth > 0 ? (menuStack[depth - 1] ?? null) : null;
}

/**
 * Appends the menu option text slug to the base edge ID to guarantee identifier uniqueness.
 */
export function edgeIdWithOption(
  base: string,
  optionText: string | null | undefined,
): string {
  return optionText ? `${base}_${optionText}` : base;
}

/**
 * Evaluates block indentation changes to manage the conditional logic stack during scanning.
 * Triggers on non-whitespace tokens:
 * 1. Pops out-of-scope blocks from the conditional indentation stack (`conditionalIndentStack`).
 * 2. Pops closed decision scopes from the conditional decision stack (`conditionalDecisionStack`)
 *    when indentation decreases or stays equal on a non-conditional token.
 * 3. Registers a new pending conditional header when a conditional token (`if`, `elif`, `else`) is encountered.
 *
 * @param scanState The file-local scanner state track.
 * @param type The current token type integer.
 * @param getTokenText Callback returning raw token string content.
 * @param indent The leading whitespace indent level of the current line.
 * @param lineText Raw or logical multiline text contents of the line.
 * @param lineNumber Optional 0-indexed line number.
 * @param sourceLocation Optional calculated token source location.
 */
export function maybeUpdateConditionalState(
  scanState: ParseScanState,
  type: number,
  getTokenText: () => string,
  indent: number,
  lineText?: string,
  lineNumber?: number,
  sourceLocation?: SourceLocation,
) {
  if (!scanState.conditionalDecisionStack) {
    scanState.conditionalDecisionStack = [];
  }
  if (scanState.pendingConditionalHeader === undefined) {
    scanState.pendingConditionalHeader = null;
  }
  // Ignore purely whitespace or newline tokens
  if (
    type === PARSER_TOKENS.charWhitespace || type === PARSER_TOKENS.charNewline
  ) {
    return;
  }

  const rawLine = (lineText ?? "").trim();
  const tokenVal = getTokenText().trim();
  const isMatchOrCase = (tokenVal === "match" || tokenVal === "case") &&
    /^(match|case)\b/.test(rawLine);
  const isLineMatchOrCase = /^(match|case)\b/.test(rawLine);

  if (
    lineNumber !== undefined && scanState.lastConditionalLine === lineNumber
  ) {
    // We are on the same line as the conditional statement keyword itself.
    // Do not pop.
    if (type !== PARSER_TOKENS.kwConditional && !isMatchOrCase) return;
  }

  scanState.pendingConditionalHeader = null;

  // Pop all conditional blocks that are deeper than the current indentation
  while (
    scanState.conditionalIndentStack.length > 0 &&
    indent <=
      scanState
        .conditionalIndentStack[scanState.conditionalIndentStack.length - 1]
  ) {
    scanState.conditionalIndentStack.pop();
  }
  // Pop out-of-scope decisions from the stack
  while (scanState.conditionalDecisionStack.length > 0) {
    const top = scanState
      .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1]!;
    if (indent < top.indent) {
      const popped = scanState.conditionalDecisionStack.pop()!;
      if (
        popped.decisionNodeId &&
        popped.branchKind !== "else" &&
        !popped.sourceId?.startsWith("menu_") &&
        !scanState.pendingMenuFallthrough.some((e) =>
          e.menuId === popped.decisionNodeId
        )
      ) {
        scanState.pendingMenuFallthrough.push({
          menuId: popped.decisionNodeId,
          optionText: null,
          sourceLocation: popped.sourceLocation,
        });
      }
      continue;
    }
    if (
      indent === top.indent && type !== PARSER_TOKENS.kwConditional &&
      !isLineMatchOrCase
    ) {
      const popped = scanState.conditionalDecisionStack.pop()!;
      if (
        popped.decisionNodeId &&
        popped.branchKind !== "else" &&
        !popped.sourceId?.startsWith("menu_") &&
        !scanState.pendingMenuFallthrough.some((e) =>
          e.menuId === popped.decisionNodeId
        )
      ) {
        scanState.pendingMenuFallthrough.push({
          menuId: popped.decisionNodeId,
          optionText: null,
          sourceLocation: popped.sourceLocation,
        });
      }
      continue;
    }
    break;
  }

  if (type !== PARSER_TOKENS.kwConditional && !isMatchOrCase) return;
  scanState.lastConditionalLine = lineNumber;
  const tokenText = getTokenText();
  const parsedHeader = parseConditionalHeader(lineText ?? tokenText);
  if (!parsedHeader) return;
  if (
    parsedHeader.kind === "if" || parsedHeader.kind === "elif" ||
    parsedHeader.kind === "else" || parsedHeader.kind === "while" ||
    parsedHeader.kind === "for" || parsedHeader.kind === "match" ||
    parsedHeader.kind === "case"
  ) {
    scanState.conditionalIndentStack.push(indent);
  }
  scanState.pendingConditionalHeader = {
    ...parsedHeader,
    indent,
    sourceLocation,
  };
}

/**
 * Extracts the conditional keyword (if, elif, else, while, for, match, case) and the evaluated expression
 * from a raw statement line (e.g. "if x == 5:" or "match x:" or "case 'a':").
 */
function parseConditionalHeader(lineText: string): {
  kind: ConditionalBranchKind;
  expression: string | null;
} | null {
  const trimmed = lineText.trim();
  const keywordMatch = /^(if|elif|else|while|for|match|case)\b/.exec(trimmed);
  if (!keywordMatch) return null;
  const kind = keywordMatch[1] as ConditionalBranchKind;
  const headerColonIndex = findTopLevelHeaderColon(trimmed);
  if (headerColonIndex < 0) return null;

  const headerPrefix = trimmed.slice(0, headerColonIndex).trim();
  if (kind === "else") {
    return headerPrefix === "else" ? { kind: "else", expression: null } : null;
  }

  if (!headerPrefix.startsWith(kind)) return null;
  const expression = headerPrefix.slice(kind.length).trim();
  if (!expression) return null;
  return { kind, expression };
}

/**
 * Locates the Python statement colon suffix (":") at the root nesting level.
 * Correctly bypasses colons found within string literals or parenthesized expressions.
 * Returns -1 if no valid root-level colon can be found.
 */
export function findTopLevelHeaderColon(text: string): number {
  const delimiterStack: Array<")" | "]" | "}"> = [];
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let inComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inComment) {
      if (char === "\n") {
        inComment = false;
      }
      continue;
    }

    if (activeQuote) {
      if (char === "\\") {
        if (i + 1 < text.length) {
          i += 1;
        } else {
          break;
        }
        continue;
      }
      if (tripleQuoted) {
        if (
          i + 2 < text.length && char === activeQuote &&
          text[i + 1] === activeQuote && text[i + 2] === activeQuote
        ) {
          i += 2;
          activeQuote = null;
          tripleQuoted = false;
        }
        continue;
      }
      if (char === activeQuote) {
        activeQuote = null;
      }
      continue;
    }

    if (
      (char === '"' || char === "'") && i + 2 < text.length &&
      text[i + 1] === char && text[i + 2] === char
    ) {
      activeQuote = char;
      tripleQuoted = true;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      activeQuote = char;
      tripleQuoted = false;
      continue;
    }

    if (char === "#") {
      inComment = true;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      delimiterStack.push(char === "(" ? ")" : char === "[" ? "]" : "}");
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      const expectedCloser = delimiterStack.pop();
      if (!expectedCloser || expectedCloser !== char) {
        return -1;
      }
      continue;
    }

    if (char === ":" && delimiterStack.length === 0) {
      if (i + 1 < text.length && text[i + 1] === "=") {
        continue;
      }
      return i;
    }
  }

  return -1;
}

/**
 * Evaluates block indentation changes and token meta flags to pop out-of-scope menus
 * from the menuStack and record their fallthrough options into pendingMenuFallthrough.
 */
export function maybeUpdateMenuScope(
  _state: ParseGraphState,
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  lineIndent: number,
  lineNumber?: number,
  sourceLocation?: SourceLocation,
): void {
  while (scanState.menuStack.length > 0) {
    const topMenu = scanState.menuStack[scanState.menuStack.length - 1]!;
    if (
      lineNumber !== undefined &&
      topMenu.lineNum !== undefined &&
      lineNumber <= topMenu.lineNum
    ) {
      break;
    }

    const isOutOfScope = meta.menuDepth < scanState.menuStack.length ||
      (topMenu.indent !== undefined && lineIndent <= topMenu.indent);

    if (!isOutOfScope) {
      break;
    }

    const closedMenu = scanState.menuStack.pop()!;
    const fallthroughOptions = closedMenu.options?.filter((o) => !o.hasExit) ??
      [];

    if (fallthroughOptions.length > 0) {
      for (const option of fallthroughOptions) {
        scanState.pendingMenuFallthrough.push({
          menuId: closedMenu.id,
          optionText: option.text,
          sourceLocation: closedMenu.sourceLocation ?? sourceLocation,
          decisionNodeId: closedMenu.decisionNodeId,
        });
      }
      scanState.labelHasExplicitExit = false;
    } else if (closedMenu.options && closedMenu.options.length > 0) {
      const isTopLevelMenu = scanState.currentLabelIndent === null ||
        topMenu.indent === undefined ||
        topMenu.indent <= (scanState.currentLabelIndent ?? 0) + 4;
      if (isTopLevelMenu && scanState.conditionalIndentStack.length === 0) {
        scanState.labelHasExplicitExit = true;
      }
    } else if (menuHasFallthrough(closedMenu)) {
      scanState.pendingMenuFallthrough.push({
        menuId: closedMenu.id,
        optionText: null,
        sourceLocation: closedMenu.sourceLocation ?? sourceLocation,
        decisionNodeId: closedMenu.decisionNodeId,
      });
      scanState.labelHasExplicitExit = false;
    }
  }
}

/**
 * Determines whether all execution paths from the current label/scene scope are
 * guaranteed to pass through the fallthrough menus in `pendingMenuFallthrough`.
 *
 * If this returns true, the direct sequence/jump/call edge from the enclosing label
 * must be suppressed to prevent a phantom bypass edge around the menus.
 *
 * If this returns false (e.g. an `if` block has a menu but the `else` block has non-menu
 * statements, or an `if` block has no `else` block so the false condition falls through),
 * the enclosing label must still emit its edge so that non-menu paths are not severed.
 */
export function areAllPathsCoveredByPendingMenus(
  state: ParseGraphState,
  scanState: ParseScanState,
): boolean {
  const menuEntries = scanState.pendingMenuFallthrough.filter((e) =>
    e.menuId.startsWith("menu_")
  );
  if (menuEntries.length === 0) {
    return false;
  }

  // If there are any non-menu entries (like decision_ nodes) in pendingMenuFallthrough,
  // there is an explicit non-menu fallthrough path.
  const hasNonMenuPending = scanState.pendingMenuFallthrough.some(
    (e) => !e.menuId.startsWith("menu_"),
  );
  if (hasNonMenuPending) {
    return false;
  }

  // If any fallthrough menu was at the top level of the label/scene (not inside a conditional),
  // then every execution path reaching that point passed unconditionally through the menu.
  const hasTopLevelMenu = menuEntries.some((e) => !e.decisionNodeId);
  if (hasTopLevelMenu) {
    return true;
  }

  // All menus are inside conditional decisions.
  // If there is still an active conditional on the decision stack, the conditional structure is not closed.
  if (scanState.conditionalDecisionStack.length > 0) {
    return false;
  }

  const decisionIds = new Set(
    menuEntries
      .map((e) => e.decisionNodeId)
      .filter((id): id is string => Boolean(id)),
  );

  if (decisionIds.size === 0) {
    return true;
  }

  const menuIds = new Set(menuEntries.map((e) => e.menuId));

  for (const decId of decisionIds) {
    if (!state.graph.hasNode(decId)) {
      return false;
    }
    const outEdges = state.graph.outEdges(decId).map((e) => {
      const target = state.graph.target(e);
      const edgeData = state.graph.getEdgeAttributes(e);
      return {
        target,
        branchKind: edgeData.condition?.branchKind ?? edgeData.label,
      };
    });

    const hasElseBranch = outEdges.some((e) => e.branchKind === "else");
    if (!hasElseBranch) {
      // No else branch means if condition is false, execution falls through past the if without a menu.
      return false;
    }

    const allBranchesAreMenus = outEdges.length > 0 &&
      outEdges.every((e) =>
        e.target.startsWith("menu_") && menuIds.has(e.target)
      );

    if (!allBranchesAreMenus) {
      return false;
    }
  }

  return true;
}
