import type {
  ParseGraphState,
  ParseScanState,
  ResolveTargetScanState,
} from "../pipelineTypes.ts";
import { resolveDynamicTargetWithDataflow } from "../dataflowAnalysis.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

  function parseDictKey(): string | null {
    if (i >= content.length) return null;
    const quoteChar = content[i];
    if (quoteChar === '"' || quoteChar === "'") {
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
      return null;
    }
    const numMatch = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      content.slice(i),
    );
    if (numMatch) {
      i += numMatch[0].length;
      return numMatch[0];
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(content.slice(i));
    if (match) {
      i += match[0].length;
      return match[0];
    }
    return null;
  }

  function parseDictValue(): string | null {
    if (i >= content.length) return null;
    const quoteChar = content[i];
    if (quoteChar === '"' || quoteChar === "'") {
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
      return null;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(content.slice(i));
    if (match) {
      i += match[0].length;
      return match[0];
    }
    return null;
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
    const key = parseDictKey();
    if (key === null) {
      skipValueExpression();
      if (i < content.length && content[i] === ",") i++;
      continue;
    }

    skipWhitespace();
    if (i >= content.length || content[i] !== ":") break;
    i++; // consume ':'

    skipWhitespace();
    const val = parseDictValue();
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

  function parseStringLiteralOrIdentifier(): string | null {
    if (i >= content.length) return null;
    const quoteChar = content[i];
    if (quoteChar === '"' || quoteChar === "'") {
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
      return null;
    }
    const numMatch = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      content.slice(i),
    );
    if (numMatch) {
      i += numMatch[0].length;
      return numMatch[0];
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(content.slice(i));
    if (match) {
      i += match[0].length;
      return match[0];
    }
    return null;
  }

  while (i < content.length) {
    skipWhitespace();
    if (i >= content.length) break;
    const val = parseStringLiteralOrIdentifier();
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
    if (rest.startsWith(quote, i)) {
      let backslashCount = 0;
      let bi = i - 1;
      while (bi >= 0 && rest[bi] === "\\") {
        backslashCount++;
        bi--;
      }
      const isEscaped = backslashCount % 2 === 1;
      if (!isEscaped) {
        const remainder = rest.substring(i + quote.length).trim();
        if (remainder.length === 0) {
          return result.length > 0 ? result : null;
        }
        return null;
      }
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
  if (!trimmed) return [];
  const isExpr = isPythonExpression || scanState.waitForJumpExpressionTarget;

  if (isExpr) {
    const literal = extractLiteralTarget(trimmed);
    if (literal) {
      return [literal];
    }

    const ruleTargets = resolvePatternMatches(trimmed, scanState, state);
    if (ruleTargets.length > 0) {
      return ruleTargets;
    }

    const dataflowTargets = resolveDynamicTargetWithDataflow(
      trimmed,
      scanState,
      state,
    );
    if (dataflowTargets.length > 0) {
      return dataflowTargets;
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
      const initDict = state?.initVariables?.get(dictName)?.value;
      const dict = localDict || globalDict ||
        (initDict && typeof initDict === "object" && !Array.isArray(initDict)
          ? initDict instanceof Map
            ? (initDict as Map<string, string>)
            : new Map(
              Object.entries(initDict as unknown as Record<string, string>),
            )
          : undefined);
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
        const initList = state?.initVariables?.get(dictName)?.value;
        const list = localList || globalList ||
          (Array.isArray(initList)
            ? initList.filter((v): v is string => typeof v === "string")
            : undefined);
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

export function resolvePatternMatches(
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

  const cleanExpr = trimmed.replace(/^\s*\(\s*|\s*\)\s*$/g, "").trim();

  // If this is a ternary conditional expression ("a" if cond else "b"),
  // let dataflow and AST evaluation resolve both branches instead of prefix/suffix matching.
  if (/\bif\b.+\belse\b/.test(cleanExpr)) {
    return [];
  }

  let prefix = "";
  let suffix = "";

  // 1. Check for f-strings: f"prefix_{var}_suffix"
  const fStringMatch = /^[fF]["']([^"'{]*)(?:\{[^}]+\})+(.*?)["']$/.exec(
    cleanExpr,
  );
  if (fStringMatch) {
    prefix = fStringMatch[1] ?? "";
    suffix = fStringMatch[2] ?? "";
  }

  // 2. Extract string literals from expression
  if (!prefix && !suffix) {
    const stringLiterals: Array<{ value: string; index: number; end: number }> =
      [];
    const stringRegex =
      /(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[fF][rR]|[rR][fF]|[rR]|[uU]|[bB]|[fF])?["']([^"'\n\\]*(?:\\.[^"'\n\\]*)*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = stringRegex.exec(cleanExpr)) !== null) {
      stringLiterals.push({
        value: m[1]!,
        index: m.index,
        end: m.index + m[0].length,
      });
    }

    if (stringLiterals.length === 1) {
      const lit = stringLiterals[0]!;
      if (lit.index === 0) {
        prefix = lit.value;
      } else if (
        lit.end >= cleanExpr.length - 1 ||
        cleanExpr.slice(lit.end).trim() === ""
      ) {
        suffix = lit.value;
      }
    } else if (stringLiterals.length >= 2) {
      const first = stringLiterals[0]!;
      const last = stringLiterals[stringLiterals.length - 1]!;
      if (first.index === 0) {
        prefix = first.value;
      }
      if (
        last.end >= cleanExpr.length - 1 ||
        cleanExpr.slice(last.end).trim() === ""
      ) {
        suffix = last.value;
      }
    }
  }

  if ((prefix || suffix) && state) {
    const candidates = new Set<string>();
    const allLabels: string[] = [];
    if (state.canonicalLabelIdByName) {
      for (const labelName of state.canonicalLabelIdByName.keys()) {
        allLabels.push(labelName);
      }
    }
    if (state.allLabelIds) {
      for (const labelId of state.allLabelIds) {
        allLabels.push(labelId);
      }
    }

    for (const label of allLabels) {
      if (prefix && suffix) {
        if (
          label.startsWith(prefix) && label.endsWith(suffix) &&
          label.length >= prefix.length + suffix.length
        ) {
          candidates.add(label);
        }
      } else if (prefix) {
        if (label.startsWith(prefix)) {
          candidates.add(label);
        }
      } else if (suffix) {
        if (label.endsWith(suffix)) {
          candidates.add(label);
        }
      }
    }

    if (candidates.size > 0) return Array.from(candidates);
  }

  return [];
}
