/**
 * src/parser/utils.ts
 *
 * Lightweight string, Python syntax, and literal parsing utilities.
 */

export function stripPythonComments(text: string): string {
  let result = "";
  let activeQuote: '"' | "'" | null = null;
  let tripleQuoted = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (activeQuote) {
      if (char === "\\") {
        result += char;
        if (i + 1 < text.length) {
          result += text[i + 1];
          i += 2;
          continue;
        }
      }
      if (tripleQuoted) {
        if (
          i + 2 < text.length &&
          char === activeQuote &&
          text[i + 1] === activeQuote &&
          text[i + 2] === activeQuote
        ) {
          result += char + text[i + 1] + text[i + 2];
          i += 3;
          activeQuote = null;
          tripleQuoted = false;
          continue;
        }
      } else if (char === activeQuote) {
        result += char;
        i += 1;
        activeQuote = null;
        continue;
      }
      result += char;
      i += 1;
    } else {
      if (char === '"' || char === "'") {
        activeQuote = char;
        if (
          i + 2 < text.length &&
          text[i + 1] === char &&
          text[i + 2] === char
        ) {
          tripleQuoted = true;
          result += char + char + char;
          i += 3;
          continue;
        }
        result += char;
        i += 1;
      } else if (char === "#") {
        while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
          i += 1;
        }
      } else {
        result += char;
        i += 1;
      }
    }
  }
  return result;
}

export function extractLiteralTarget(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = /^(?:[ruf]|fr|rf|ur|ru)?("""|'''|"|')([\s\S]*)\1$/i.exec(
    trimmed,
  );
  if (!match) return null;

  let content = match[2]!;
  if (!content) return null;

  const isRaw = /^(?:r|ur|ru|fr|rf)/i.test(trimmed);
  if (!isRaw) {
    content = content
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }

  return content;
}

export function parseDictLiteral(input: string): Map<string, string> | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  const inner = trimmed.slice(1, -1).trim();
  const result = new Map<string, string>();
  if (!inner) return result;

  // Tokenize key-value entries split by commas at top level
  const entries: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let i = 0;

  while (i < inner.length) {
    const c = inner[i]!;
    if (inQuote) {
      if (c === "\\") {
        current += c;
        if (i + 1 < inner.length) {
          current += inner[i + 1];
          i += 2;
          continue;
        }
      } else if (c === inQuote) {
        inQuote = null;
      }
      current += c;
      i++;
    } else {
      if (c === '"' || c === "'") {
        inQuote = c;
        current += c;
        i++;
      } else if (c === ",") {
        entries.push(current);
        current = "";
        i++;
      } else {
        current += c;
        i++;
      }
    }
  }
  if (current.trim()) {
    entries.push(current);
  }

  for (const entry of entries) {
    const trimmedEntry = entry.trim();
    if (!trimmedEntry) continue;

    let colonIdx = -1;
    let quoteChar: string | null = null;
    for (let j = 0; j < trimmedEntry.length; j++) {
      const ch = trimmedEntry[j]!;
      if (quoteChar) {
        if (ch === "\\") {
          j++;
        } else if (ch === quoteChar) {
          quoteChar = null;
        }
      } else if (ch === '"' || ch === "'") {
        quoteChar = ch;
      } else if (ch === ":") {
        colonIdx = j;
        break;
      }
    }

    if (colonIdx === -1) return null;

    const rawKey = trimmedEntry.slice(0, colonIdx).trim();
    const rawVal = trimmedEntry.slice(colonIdx + 1).trim();

    if (!rawKey || !rawVal) return null;

    const keyLit = (rawKey === '""' || rawKey === "''" || rawKey === '""""""' ||
        rawKey === "''''''")
      ? ""
      : extractLiteralTarget(rawKey);
    const valLit = (rawVal === '""' || rawVal === "''" || rawVal === '""""""' ||
        rawVal === "''''''")
      ? ""
      : extractLiteralTarget(rawVal);

    if (keyLit !== null && valLit !== null) {
      result.set(keyLit, valLit);
    }
  }

  return result;
}

export function computeLineIndent(line: string): number {
  let indent = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") indent += 1;
    else if (ch === "\t") indent += 8 - (indent % 8);
    else break;
  }
  return indent;
}

export function parseTimedChoice(
  text: string,
): { duration: number; target: string; title?: string } | null {
  const stripped = text.replace(/#.*$/, "").trim();
  const trimmed = stripped.replace(/^\$\s*/, "").trim();
  if (!/^timedchoice\b/i.test(trimmed)) return null;

  const parenMatch = /^timedchoice\s*\((.*)\)\s*$/i.exec(trimmed);
  if (parenMatch) {
    const argsStr = parenMatch[1]!.trim();
    let duration: number | undefined;
    let target: string | undefined;
    let title: string | undefined;

    const timeKw =
      /(?:time|duration|timeout)\s*=\s*([0-9]+(?:\.[0-9]*)?|\.[0-9]+)/i.exec(
        argsStr,
      );
    const targetKw =
      /(?:target)\s*=\s*["']?(\.?[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)["']?/i
        .exec(argsStr);
    const titleKw = /(?:title|label)\s*=\s*["']([^"']*)["']/i
      .exec(argsStr);

    if (timeKw) duration = parseFloat(timeKw[1]!);
    if (targetKw) target = targetKw[1]!;
    if (titleKw) title = titleKw[1]!;

    if (duration !== undefined && target !== undefined) {
      return {
        duration,
        target,
        title: title || `Timeout (${duration}s)`,
      };
    }

    const posMatch =
      /^\s*([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s*,\s*["']?(\.?[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)["']?(?:\s*,\s*["']([^"']*)["'])?\s*$/i
        .exec(argsStr);
    if (posMatch) {
      const dur = parseFloat(posMatch[1]!);
      const tgt = posMatch[2]!;
      const ttl = posMatch[3] || `Timeout (${dur}s)`;
      return { duration: dur, target: tgt, title: ttl };
    }
  }

  const stmtMatch =
    /^timedchoice\s+([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s+["']?(\.?[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)["']?(?:\s+(?:"([^"]*)"|'([^']*)'|(\S+)))?/i
      .exec(trimmed);
  if (stmtMatch) {
    const dur = parseFloat(stmtMatch[1]!);
    const tgt = stmtMatch[2]!;
    const rawTitle = stmtMatch[3] ?? stmtMatch[4] ?? stmtMatch[5];
    const ttl = rawTitle ? rawTitle.trim() : `Timeout (${dur}s)`;
    return { duration: dur, target: tgt, title: ttl };
  }

  return null;
}

export function extractSceneAsset(line: string): string {
  const noComment = line.replace(/#.*$/, "").trim();
  if (/^(?:scene|show|hide)$/i.test(noComment)) return "";
  let asset = noComment.replace(/^(?:scene|show|hide)\s+/i, "").trim();
  asset = asset.replace(/:$/, "").trim();
  asset = asset.replace(/\s+(?:with|at|behind|zorder|as)\b.*$/i, "").trim();
  return asset.replace(/^["'](.*)["']$/, "$1").trim();
}

export const PARSER_TOKENS = {
  kwShow: 1,
  kwHide: 2,
};

export function createGraphState(): Record<string, unknown> {
  return {
    nodes: [],
    edges: [],
    nodeMap: new Map(),
    edgeMap: new Map(),
    globalCharacters: new Set(["e", "character.m", "narrator"]),
    globalScreens: new Set(),
    globalLabelVariableLiteralTargets: new Map<string, string>(),
    globalLabelVariableDictTargets: new Map<string, Map<string, string>>(),
    diagnostics: [],
  };
}

export function preParseInitialization(
  files: Array<{ name: string; content?: string | Uint8Array }> | unknown,
  state: Record<string, unknown>,
): void {
  if (!state.globalCharacters) {
    state.globalCharacters = new Set(["e", "character.m", "narrator"]);
  }
  const literalTargets =
    (state.globalLabelVariableLiteralTargets as Map<string, string>) ||
    new Map<string, string>();
  state.globalLabelVariableLiteralTargets = literalTargets;

  const dictTargets = (state.globalLabelVariableDictTargets as Map<
    string,
    Map<string, string>
  >) ||
    new Map<string, Map<string, string>>();
  state.globalLabelVariableDictTargets = dictTargets;

  const fileList = Array.isArray(files) ? files : [files];
  for (const f of fileList) {
    if (
      !f || typeof f !== "object" || !("content" in f) ||
      typeof f.content !== "string"
    ) continue;
    const cleanContent = stripPythonComments(f.content);
    const assignRegex =
      /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"\n]*)"|'([^'\n]*)')/g;
    let m: RegExpExecArray | null;
    while ((m = assignRegex.exec(cleanContent)) !== null) {
      const val = m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
      literalTargets.set(m[1]!, val);
    }

    const dictRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\{([^}]+)\}/g;
    while ((m = dictRegex.exec(cleanContent)) !== null) {
      const varName = m[1]!;
      const inner = m[2]!;
      const dict = new Map<string, string>();
      const entryRegex = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
      let em: RegExpExecArray | null;
      while ((em = entryRegex.exec(inner)) !== null) {
        dict.set(em[1]!, em[2]!);
      }
      dictTargets.set(varName, dict);
    }
  }
}
