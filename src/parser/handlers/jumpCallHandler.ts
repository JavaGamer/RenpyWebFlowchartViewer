import type {
  ParseGraphState,
  ParseScanState,
  ResolveTargetScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import { type ConditionMetadata, type FlowEdge } from "../../domain/index.ts";
import { menuAtDepth } from "../scanTransitions.ts";
import { addEdge, addIncoming, addOutgoing } from "../graphMutations.ts";
import { addParseDiagnostic } from "../diagnostics.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function addDynamicTargetDiagnostic(
  state: ParseGraphState,
  chapter: string,
  construct: string,
  targetExpression: string,
  sourceId?: string,
) {
  const diagnosticId = [
    "dynamic_target",
    chapter,
    construct,
    targetExpression.trim(),
    sourceId ?? "",
  ].join("|");
  addParseDiagnostic(
    state,
    {
      code: "dynamic_target",
      severity: "warning",
      location: {
        chapter,
        construct,
        targetExpression: targetExpression.trim(),
        sourceId,
      },
      message:
        `Dynamic ${construct} target cannot be resolved statically: ${targetExpression.trim()}`,
      recoveryAction:
        "Use a static string target or configure explicit parser rules.",
    },
    diagnosticId,
  );
}

export function resolveCallContext(
  scanState: ParseScanState,
  meta: TokenMetaFlags,
  menuDepth: number,
): {
  isInOption: boolean;
  source: string | null;
  optionText: string | null;
  condition?: ConditionMetadata;
} {
  const isInOption = meta.hasMenuOptionBlock;
  const menu = menuAtDepth(scanState.menuStack, menuDepth);
  const decisionContext = scanState
    .conditionalDecisionStack[scanState.conditionalDecisionStack.length - 1];
  const source = isInOption
    ? (menu ? menu.id : null)
    : (decisionContext?.decisionNodeId ?? scanState.currentLabelId);
  const condition: ConditionMetadata | undefined = decisionContext
    ? {
      branchKind: decisionContext.branchKind,
      expression: decisionContext.expression ?? undefined,
      references: decisionContext.references,
      decisionNodeId: decisionContext.decisionNodeId,
    }
    : undefined;
  return {
    isInOption,
    source,
    optionText: menu?.optionText ?? null,
    condition,
  };
}

export function resolveTargetLabelId(
  state: ParseGraphState,
  targetExpression: string,
): { resolvedTargetId: string } {
  const targetName = targetExpression.trim();
  const resolvedTargetId = state.canonicalLabelIdByName.get(targetName) ??
    targetName;
  return { resolvedTargetId };
}

export function emitJumpEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: {
    isInOption: boolean;
    source: string | null;
    optionText: string | null;
    condition?: ConditionMetadata;
  },
  suppressFallthrough: boolean,
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (source) {
    const { resolvedTargetId } = resolveTargetLabelId(state, target);
    const timeoutSuffix = timeout?.isTimeout === true
      ? `_timeout_${
        timeout.durationSeconds === undefined
          ? "unknown"
          : String(timeout.durationSeconds)
      }`
      : "";
    const edgeId = `jump_${source}__${resolvedTargetId}_${
      optionText ?? ""
    }${timeoutSuffix}`;
    addEdge(state, {
      id: edgeId,
      source,
      target: resolvedTargetId,
      kind: "jump",
      label: isInOption ? (optionText ?? undefined) : undefined,
      condition: context.condition,
      timeout,
    });
    if (!isInOption && scanState.currentLabelId) {
      addOutgoing(state, scanState.currentLabelId, "jump");
      addIncoming(state, resolvedTargetId, "jump");
    } else if (isInOption) {
      // Register the menu node's outgoing jump traffic so that fallthrough
      // detection (hasOutgoingEdge) correctly skips menus whose options all
      // explicitly jump to another label.
      addOutgoing(state, source, "jump");
      addIncoming(state, resolvedTargetId, "jump");

      const menu = menuAtDepth(scanState.menuStack, scanState.menuStack.length);
      if (menu && menu.options) {
        const lastOpt = menu.options[menu.options.length - 1];
        if (lastOpt) {
          lastOpt.hasExit = true;
        }
      }
    }
  }
  if (
    suppressFallthrough && !isInOption &&
    scanState.conditionalIndentStack.length === 0
  ) {
    scanState.labelHasExplicitExit = true;
  }
}

export function emitCallEdge(
  state: ParseGraphState,
  scanState: ParseScanState,
  target: string,
  context: {
    isInOption: boolean;
    source: string | null;
    optionText: string | null;
    condition?: ConditionMetadata;
  },
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (!source) return;
  const { resolvedTargetId } = resolveTargetLabelId(state, target);
  const timeoutSuffix = timeout?.isTimeout === true
    ? `_timeout_${
      timeout.durationSeconds === undefined
        ? "unknown"
        : String(timeout.durationSeconds)
    }`
    : "";
  const edgeId = `call_${source}__${resolvedTargetId}_${
    optionText ?? ""
  }${timeoutSuffix}`;
  addEdge(state, {
    id: edgeId,
    source,
    target: resolvedTargetId,
    kind: "call",
    label: isInOption ? (optionText ? `call: ${optionText}` : "call") : "call",
    condition: context.condition,
    timeout,
  });
  state.calledLabels.add(resolvedTargetId);
  if (!isInOption && scanState.currentLabelId) {
    addOutgoing(state, scanState.currentLabelId, "call");
    addIncoming(state, resolvedTargetId, "call");
  }
  state.pendingCallReturns.push({
    returnTargetId: source,
    callTargetId: resolvedTargetId,
  });
  if (isInOption) {
    state.calledFromMenuOptionTargets.add(resolvedTargetId);
    const menu = menuAtDepth(scanState.menuStack, scanState.menuStack.length);
    if (menu && menu.options) {
      const lastOpt = menu.options[menu.options.length - 1];
      if (lastOpt) {
        lastOpt.hasExit = true;
      }
    }
  }
}

export function parseDictLiteral(
  expression: string,
): Map<string, string> | null {
  const trimmed = expression.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const content = trimmed.substring(1, trimmed.length - 1);
  const result = new Map<string, string>();

  let i = 0;
  function skipWhitespace() {
    while (i < content.length && /\s/.test(content[i])) {
      i++;
    }
  }

  function parseStringLiteral(): string | null {
    if (i >= content.length) return null;
    const quoteChar = content[i];
    if (quoteChar !== '"' && quoteChar !== "'") return null;
    i++; // consume quote
    let str = "";
    while (i < content.length) {
      const char = content[i];
      if (char === "\\") {
        i++;
        if (i < content.length) {
          const nextChar = content[i];
          if (nextChar === "n") str += "\n";
          else if (nextChar === "t") str += "\t";
          else if (nextChar === "r") str += "\r";
          else str += nextChar;
          i++;
        }
      } else if (char === quoteChar) {
        i++; // consume closing quote
        return str;
      } else {
        str += char;
        i++;
      }
    }
    return null; // unclosed string
  }

  while (i < content.length) {
    skipWhitespace();
    if (i >= content.length) break;
    const key = parseStringLiteral();
    if (key === null) return null;

    skipWhitespace();
    if (i >= content.length || content[i] !== ":") return null;
    i++; // consume ':'

    skipWhitespace();
    const val = parseStringLiteral();
    if (val === null) return null;

    result.set(key, val);

    skipWhitespace();
    if (i < content.length) {
      if (content[i] !== ",") return null;
      i++; // consume ','
    }
  }

  return result.size > 0 ? result : null;
}

export function parseListLiteral(
  expression: string,
): string[] | null {
  const trimmed = expression.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const content = trimmed.substring(1, trimmed.length - 1);
  const result: string[] = [];

  let i = 0;
  function skipWhitespace() {
    while (i < content.length && /\s/.test(content[i])) {
      i++;
    }
  }

  function parseStringLiteral(): string | null {
    if (i >= content.length) return null;
    const quoteChar = content[i];
    if (quoteChar !== '"' && quoteChar !== "'") return null;
    i++; // consume quote
    let str = "";
    while (i < content.length) {
      const char = content[i];
      if (char === "\\") {
        i++;
        if (i < content.length) {
          const nextChar = content[i];
          if (nextChar === "n") str += "\n";
          else if (nextChar === "t") str += "\t";
          else if (nextChar === "r") str += "\r";
          else str += nextChar;
          i++;
        }
      } else if (char === quoteChar) {
        i++; // consume closing quote
        return str;
      } else {
        str += char;
        i++;
      }
    }
    return null; // unclosed string
  }

  while (i < content.length) {
    skipWhitespace();
    if (i >= content.length) break;
    const val = parseStringLiteral();
    if (val === null) return null;

    result.push(val);

    skipWhitespace();
    if (i < content.length) {
      if (content[i] !== ",") return null;
      i++; // consume ','
    }
  }

  return result.length > 0 ? result : null;
}

export function extractLiteralTarget(expression: string): string | null {
  const trimmed = expression.trim();
  const prefixMatch = /^(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[rR]|[uU]|[bB])?/
    .exec(trimmed);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  const rest = trimmed.substring(prefix.length);

  let quote: string;
  if (rest.startsWith('"""')) {
    quote = '"""';
  } else if (rest.startsWith("'''")) {
    quote = "'''";
  } else if (rest.startsWith('"')) {
    quote = '"';
  } else if (rest.startsWith("'")) {
    quote = "'";
  } else {
    return null;
  }

  if (!rest.endsWith(quote) || rest.length < quote.length * 2) {
    return null;
  }

  const inner = rest.substring(quote.length, rest.length - quote.length);
  const isRaw = prefix.toLowerCase().includes("r");
  let result = "";
  let i = 0;
  while (i < inner.length) {
    const char = inner[i];
    if (char === "\\" && !isRaw) {
      i++;
      if (i < inner.length) {
        const nextChar = inner[i];
        if (nextChar === "n") result += "\n";
        else if (nextChar === "t") result += "\t";
        else if (nextChar === "r") result += "\r";
        else result += nextChar;
        i++;
      } else {
        result += "\\";
      }
    } else {
      result += char;
      i++;
    }
  }

  if (result.trim().length === 0) return null;
  return result;
}

export function extractIdentifierTarget(expression: string): string | null {
  const trimmed = expression.trim();
  return IDENTIFIER_PATTERN.test(trimmed) ? trimmed : null;
}

export function resolveStaticTargetExpression(
  expression: string,
  scanState: ResolveTargetScanState,
  state?: ParseGraphState,
): string | null {
  const trimmed = expression.trim();
  const literal = extractLiteralTarget(trimmed);
  if (literal) return literal;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const identifier = extractIdentifierTarget(trimmed);
  if (identifier) {
    const localVal = scanState.labelVariableLiteralTargets.get(identifier);
    if (localVal !== undefined) return localVal;
    if (state) {
      const globalVal = state.globalLabelVariableLiteralTargets.get(identifier);
      if (globalVal !== undefined) return globalVal;
    }
    return null;
  }

  const dictMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]+)\s*\]$/.exec(
    trimmed,
  );
  if (dictMatch) {
    const dictName = dictMatch[1];
    const keyExpr = dictMatch[2].trim();
    const localDict = scanState.labelVariableDictTargets.get(dictName);
    const globalDict = state?.globalLabelVariableDictTargets.get(dictName);
    const dict = localDict || globalDict;
    if (dict) {
      const resolvedKey = resolveStaticTargetExpression(
        keyExpr,
        scanState,
        state,
      );
      if (resolvedKey) {
        return dict.get(resolvedKey) ?? null;
      }
    } else {
      const localList = scanState.labelVariableListTargets.get(dictName);
      const globalList = state?.globalLabelVariableListTargets.get(dictName);
      const list = localList || globalList;
      if (list) {
        const resolvedKey = resolveStaticTargetExpression(
          keyExpr,
          scanState,
          state,
        );
        if (resolvedKey) {
          const index = parseInt(resolvedKey, 10);
          if (Number.isInteger(index) && index >= 0 && index < list.length) {
            return list[index] ?? null;
          }
        }
      }
    }
  }

  return null;
}

export function resolveExpressionTargets(
  scanState: ParseScanState,
  expression: string,
  isPythonExpression: boolean,
  state?: ParseGraphState,
): string[] {
  const trimmed = expression.trim();
  const isExpr = isPythonExpression || scanState.waitForJumpExpressionTarget;

  if (isExpr) {
    const literal = extractLiteralTarget(trimmed);
    if (literal) {
      return [literal];
    }

    const identifier = extractIdentifierTarget(trimmed);
    if (identifier) {
      const localVal = scanState.labelVariableLiteralTargets.get(identifier);
      if (localVal !== undefined) {
        return [localVal];
      }
      if (state) {
        const globalVal = state.globalLabelVariableLiteralTargets.get(
          identifier,
        );
        if (globalVal !== undefined) {
          return [globalVal];
        }
      }
      return [];
    }

    const dictMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]+)\s*\]$/.exec(
      trimmed,
    );
    if (dictMatch) {
      const dictName = dictMatch[1];
      const keyExpr = dictMatch[2].trim();
      const localDict = scanState.labelVariableDictTargets.get(dictName);
      const globalDict = state?.globalLabelVariableDictTargets.get(dictName);
      const dict = localDict || globalDict;
      if (dict) {
        const resolvedKey = resolveStaticTargetExpression(
          keyExpr,
          scanState,
          state,
        );
        if (resolvedKey) {
          const val = dict.get(resolvedKey);
          return val ? [val] : [];
        } else {
          return Array.from(dict.values());
        }
      } else {
        const localList = scanState.labelVariableListTargets.get(dictName);
        const globalList = state?.globalLabelVariableListTargets.get(dictName);
        const list = localList || globalList;
        if (list) {
          const resolvedKey = resolveStaticTargetExpression(
            keyExpr,
            scanState,
            state,
          );
          if (resolvedKey) {
            const index = parseInt(resolvedKey, 10);
            if (Number.isInteger(index) && index >= 0 && index < list.length) {
              const val = list[index];
              return val ? [val] : [];
            }
          } else {
            return list.filter((val): val is string => !!val);
          }
        }
      }
    }

    return [];
  } else {
    return [trimmed];
  }
}
