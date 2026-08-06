import type {
  ParseGraphState,
  ParseScanState,
  ResolveTargetScanState,
  TokenMetaFlags,
} from "../pipelineTypes.ts";
import {
  type CallArgument,
  type ConditionMetadata,
  type FlowEdge,
  type LabelParameter,
  type SourceLocation,
} from "../../domain/index.ts";
import { menuAtDepth } from "../scanTransitions.ts";
import { addEdge, addIncoming, addOutgoing } from "../graphMutations.ts";
import { addParseDiagnostic } from "../diagnostics.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function splitBalancedArguments(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inQuote: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuote) {
      current += char;
      if (char === "\\") {
        if (i + 1 < text.length) {
          current += text[i + 1]!;
          i++;
        }
      } else if (char === inQuote) {
        inQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      current += char;
      continue;
    }

    if (char === "(") parenDepth++;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "{") braceDepth++;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);

    if (
      char === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0
    ) {
      if (current.trim()) result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

export function extractParenthesizedArguments(
  lineText: string,
  prefixPattern: RegExp,
): string | null {
  const match = prefixPattern.exec(lineText);
  if (!match) return null;
  const startIdx = match.index + match[0].length;
  if (lineText[startIdx] !== "(") return null;

  let parenDepth = 0;
  let inQuote: string | null = null;
  let content = "";

  for (let i = startIdx; i < lineText.length; i++) {
    const char = lineText[i]!;
    if (inQuote) {
      content += char;
      if (char === "\\") {
        if (i + 1 < lineText.length) {
          content += lineText[i + 1]!;
          i++;
        }
      } else if (char === inQuote) {
        inQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      content += char;
      continue;
    }

    if (char === "(") {
      parenDepth++;
      if (parenDepth > 1) content += char;
    } else if (char === ")") {
      parenDepth--;
      if (parenDepth === 0) return content;
      content += char;
    } else {
      content += char;
    }
  }

  return null;
}

export function parseLabelParameters(
  lineText: string,
): LabelParameter[] | undefined {
  const argText = extractParenthesizedArguments(
    lineText,
    /label\s+[A-Za-z_][A-Za-z0-9_]*\s*/i,
  );
  if (!argText || !argText.trim()) return undefined;
  const rawParams = splitBalancedArguments(argText);
  const params: LabelParameter[] = [];
  for (const raw of rawParams) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const name = trimmed.substring(0, eqIdx).trim();
      const defaultValue = trimmed.substring(eqIdx + 1).trim();
      params.push({ name, defaultValue });
    } else {
      params.push({ name: trimmed });
    }
  }
  return params.length > 0 ? params : undefined;
}

export function parseCallArguments(
  lineText: string,
): CallArgument[] | undefined {
  const argText = extractParenthesizedArguments(
    lineText,
    /call\s+(?:expression\s+.*?\s+pass\s+|expression\s+.*?\s+|[A-Za-z_][A-Za-z0-9_]*\s+pass\s+|[A-Za-z_][A-Za-z0-9_]*\s*)/i,
  );
  if (!argText || !argText.trim()) return undefined;
  const rawArgs = splitBalancedArguments(argText);
  const args: CallArgument[] = [];
  for (const raw of rawArgs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (
      eqIdx !== -1 &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed.substring(0, eqIdx).trim())
    ) {
      const name = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      args.push({ name, value });
    } else {
      args.push({ value: trimmed });
    }
  }
  return args.length > 0 ? args : undefined;
}

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
  currentChapter?: string,
): { resolvedTargetId: string } {
  const targetName = targetExpression.trim();
  if (currentChapter) {
    const localId = state.labelsByChapter?.get(currentChapter)?.get(targetName);
    if (localId) {
      return { resolvedTargetId: localId };
    }
    for (const node of state.nodeMap.values()) {
      if (
        node.type === "LABEL" &&
        node.chapter === currentChapter &&
        (node.label === targetName || node.id === targetName)
      ) {
        return { resolvedTargetId: node.id };
      }
    }
  }
  if (state.nodeMap.has(targetName) || state.allLabelIds.has(targetName)) {
    return { resolvedTargetId: targetName };
  }
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
    sourceLocation?: SourceLocation;
  },
  suppressFallthrough: boolean,
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (source) {
    const sourceNode = state.nodeMap.get(source);
    const currentChapter = sourceNode?.chapter ??
      (scanState.currentLabelId
        ? state.nodeMap.get(scanState.currentLabelId)?.chapter
        : undefined);
    const { resolvedTargetId } = resolveTargetLabelId(
      state,
      target,
      currentChapter,
    );
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
      sourceLocation: context.sourceLocation,
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

      if (!context.condition) {
        const menu = menuAtDepth(
          scanState.menuStack,
          scanState.menuStack.length,
        );
        if (menu && menu.options) {
          const lastOpt = menu.options[menu.options.length - 1];
          if (lastOpt) {
            lastOpt.hasExit = true;
          }
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
    sourceLocation?: SourceLocation;
  },
  callArgs?: CallArgument[],
  timeout?: FlowEdge["timeout"],
) {
  const { isInOption, source, optionText } = context;
  if (!source) return;
  const sourceNode = state.nodeMap.get(source);
  const currentChapter = sourceNode?.chapter ??
    (scanState.currentLabelId
      ? state.nodeMap.get(scanState.currentLabelId)?.chapter
      : undefined);
  const { resolvedTargetId } = resolveTargetLabelId(
    state,
    target,
    currentChapter,
  );
  const timeoutSuffix = timeout?.isTimeout === true
    ? `_timeout_${
      timeout.durationSeconds === undefined
        ? "unknown"
        : String(timeout.durationSeconds)
    }`
    : "";
  const lineSuffix = context.sourceLocation?.start.line !== undefined
    ? `_L${context.sourceLocation.start.line}`
    : "";
  const edgeId = `call_${source}__${resolvedTargetId}_${
    optionText ?? ""
  }${lineSuffix}${timeoutSuffix}`;
  const callContextId = `ctx_${edgeId}`;
  const callContext = {
    callContextId,
    callEdgeId: edgeId,
    callSiteId: source,
    returnTargetId: source,
    arguments: callArgs,
  };
  addEdge(state, {
    id: edgeId,
    source,
    target: resolvedTargetId,
    kind: "call",
    label: isInOption ? (optionText ? `call: ${optionText}` : "call") : "call",
    condition: context.condition,
    timeout,
    sourceLocation: context.sourceLocation,
    arguments: callArgs,
    callContext,
  });
  state.calledLabels.add(resolvedTargetId);
  if (!isInOption && scanState.currentLabelId) {
    addOutgoing(state, scanState.currentLabelId, "call");
    addIncoming(state, resolvedTargetId, "call");
  }
  state.pendingCallReturns.push({
    returnTargetId: source,
    callTargetId: resolvedTargetId,
    callEdgeId: edgeId,
    callContextId,
    arguments: callArgs,
  });
  if (isInOption) {
    state.calledFromMenuOptionTargets.add(resolvedTargetId);
    if (!context.condition) {
      const menu = menuAtDepth(scanState.menuStack, scanState.menuStack.length);
      if (menu && menu.options) {
        const lastOpt = menu.options[menu.options.length - 1];
        if (lastOpt) {
          lastOpt.hasExit = true;
        }
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

  function skipValueExpression() {
    let braceCount = 0;
    let bracketCount = 0;
    let parenCount = 0;
    let inQuote: string | null = null;

    while (i < content.length) {
      const char = content[i];
      if (inQuote) {
        if (char === "\\") {
          i += 2;
          continue;
        }
        if (char === inQuote) {
          inQuote = null;
        }
        i++;
        continue;
      }

      if (char === '"' || char === "'") {
        inQuote = char;
        i++;
        continue;
      }

      if (char === "{") braceCount++;
      else if (char === "}") {
        if (braceCount === 0) break;
        braceCount--;
      } else if (char === "[") bracketCount++;
      else if (char === "]") {
        if (bracketCount === 0) break;
        bracketCount--;
      } else if (char === "(") parenCount++;
      else if (char === ")") {
        if (parenCount === 0) break;
        parenCount--;
      } else if (
        char === "," && braceCount === 0 && bracketCount === 0 &&
        parenCount === 0
      ) {
        break;
      }
      i++;
    }
  }

  while (i < content.length) {
    skipWhitespace();
    if (i >= content.length) break;
    const key = parseStringLiteral();
    if (key === null) {
      skipValueExpression();
      if (i < content.length && content[i] === ",") i++;
      continue;
    }

    skipWhitespace();
    if (i >= content.length || content[i] !== ":") break;
    i++; // consume ':'

    skipWhitespace();
    const val = parseStringLiteral();
    if (val !== null) {
      result.set(key, val);
    } else {
      skipValueExpression();
    }

    skipWhitespace();
    if (i < content.length) {
      if (content[i] !== ",") break;
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
  const prefixMatch =
    /^(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[fF][rR]|[rR][fF]|[rR]|[uU]|[bB]|[fF])?/
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

  const isRaw = prefix.toLowerCase().includes("r");
  let i = quote.length;
  let result = "";

  while (i < rest.length) {
    if (
      rest.startsWith(quote, i) &&
      (i === 0 || rest[i - 1] !== "\\" || (i >= 2 && rest[i - 2] === "\\"))
    ) {
      const remainder = rest.substring(i + quote.length).trim();
      if (remainder.length === 0) {
        return result.trim() || null;
      }
      return null;
    }

    const char = rest[i]!;
    if (char === "\\" && !isRaw) {
      i++;
      if (i < rest.length) {
        const nextChar = rest[i]!;
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

  return null;
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

    const ruleTargets = resolvePatternMatches(trimmed, scanState, state);
    if (ruleTargets.length > 0) {
      return ruleTargets;
    }

    return [];
  } else {
    return [trimmed];
  }
}

function resolvePatternMatches(
  trimmed: string,
  _scanState: ParseScanState,
  state?: ParseGraphState,
): string[] {
  if (state?.dynamicJumpRules) {
    for (const rule of state.dynamicJumpRules) {
      const isMatch = typeof rule.expressionPattern === "string"
        ? trimmed.includes(rule.expressionPattern)
        : rule.expressionPattern.test(trimmed);
      if (isMatch) {
        const targets = typeof rule.targets === "function"
          ? rule.targets(trimmed, state)
          : rule.targets;
        if (targets.length > 0) return targets;
      }
    }
  }

  let prefix = "";
  const prefixMatch =
    /(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[fF][rR]|[rR][fF]|[rR]|[uU]|[bB]|[fF])?["']([^"'\n{]+)/
      .exec(trimmed);
  if (prefixMatch) {
    prefix = prefixMatch[1];
  }

  if (prefix && state) {
    const candidates = new Set<string>();
    if (state.canonicalLabelIdByName) {
      for (const labelName of state.canonicalLabelIdByName.keys()) {
        if (labelName.startsWith(prefix)) {
          candidates.add(labelName);
        }
      }
    }
    if (state.allLabelIds) {
      for (const labelId of state.allLabelIds) {
        if (labelId.startsWith(prefix)) {
          candidates.add(labelId);
        }
      }
    }
    if (candidates.size > 0) return Array.from(candidates);
  }

  return [];
}
