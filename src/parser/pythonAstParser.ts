/**
 * src/parser/pythonAstParser.ts
 *
 * Lightweight Python AST tokenizer and expression scanner for Ren'Py Python blocks.
 * Parses dictionary-driven state jumps (e.g. ROUTER[key]()), renpy.call_in_new_context(),
 * renpy.pop_call(), and function-wrapped jumps inside python blocks.
 */

export interface ExtractedPythonCall {
  type: "jump" | "call" | "call_in_new_context" | "pop_call" | "dict_jump";
  targetExpression?: string;
  dictName?: string;
  dictKey?: string;
  functionName?: string;
  index: number;
}

export interface ExtractedPythonFunctionDef {
  name: string;
  args: string[];
  body: string;
  startIndex: number;
}

function splitPythonArgs(rawArgs: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inQuote: '"' | "'" | null = null;

  for (let i = 0; i < rawArgs.length; i++) {
    const char = rawArgs[i]!;
    if (inQuote) {
      current += char;
      if (char === "\\") {
        if (i + 1 < rawArgs.length) {
          current += rawArgs[++i];
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
    if (char === "(" || char === "[" || char === "{") {
      depth++;
      current += char;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth--;
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

/**
 * Extracts function definitions (`def func_name(...):`) from Python code text.
 */
export function extractPythonFunctionDefs(pythonCode: string): ExtractedPythonFunctionDef[] {
  const defs: ExtractedPythonFunctionDef[] = [];
  const defRegex = /^[ \t]*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let match: RegExpExecArray | null;

  while ((match = defRegex.exec(pythonCode)) !== null) {
    const name = match[1]!;
    const startIndex = match.index;
    let depth = 1;
    let endParen = match.index + match[0].length;
    let inQuote: '"' | "'" | null = null;

    while (endParen < pythonCode.length && depth > 0) {
      const char = pythonCode[endParen]!;
      if (inQuote) {
        if (char === "\\") {
          endParen += 2;
          continue;
        }
        if (char === inQuote) inQuote = null;
      } else {
        if (char === '"' || char === "'") inQuote = char;
        else if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
      }
      endParen += 1;
    }

    const rawArgs = pythonCode.slice(match.index + match[0].length, endParen - 1);
    const args = splitPythonArgs(rawArgs);

    // Find body lines by indent
    const lineEnd = pythonCode.indexOf("\n", endParen);
    const bodyStart = lineEnd === -1 ? pythonCode.length : lineEnd + 1;
    const lines = pythonCode.slice(bodyStart).split(/\r?\n/);
    let bodyText = "";

    for (const line of lines) {
      if (line.trim().length === 0 || line.trim().startsWith("#")) {
        bodyText += line + "\n";
        continue;
      }
      const indent = line.search(/\S/);
      if (indent > 0) {
        bodyText += line + "\n";
      } else {
        break;
      }
    }

    defs.push({
      name,
      args,
      body: bodyText,
      startIndex,
    });
  }

  return defs;
}

/**
 * Extracts renpy.call_in_new_context, renpy.pop_call, and dictionary jump expressions.
 */
export function parsePythonBlockAst(pythonCode: string): ExtractedPythonCall[] {
  const results: ExtractedPythonCall[] = [];

  // 1. renpy.call_in_new_context(...)
  const callInNewContextStart = /\brenpy\.call_in_new_context\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callInNewContextStart.exec(pythonCode)) !== null) {
    const startParen = match.index + match[0].length - 1;
    let depth = 1;
    let endParen = startParen + 1;
    let inQuote: '"' | "'" | null = null;

    while (endParen < pythonCode.length && depth > 0) {
      const char = pythonCode[endParen]!;
      if (inQuote) {
        if (char === "\\") {
          endParen += 2;
          continue;
        }
        if (char === inQuote) inQuote = null;
      } else {
        if (char === '"' || char === "'") inQuote = char;
        else if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
      }
      endParen += 1;
    }
    const argText = pythonCode.slice(startParen + 1, endParen - 1).trim();
    results.push({
      type: "call_in_new_context",
      targetExpression: argText,
      index: match.index,
    });
  }

  // 2. renpy.pop_call()
  const popCallRegex = /\brenpy\.pop_call\s*\(\s*\)/g;
  while ((match = popCallRegex.exec(pythonCode)) !== null) {
    results.push({
      type: "pop_call",
      index: match.index,
    });
  }

  // 3. Dictionary state jumps: DICT_NAME[key]() or ROUTER.get(key, "default")()
  const dictJumpRegex = /\b([A-Za-z_][A-Za-z0-9_]*)(?:\[\s*(['"][^'"]+['"]|[A-Za-z_][A-Za-z0-9_.]*)\s*\]|\.get\(\s*[^,]+,\s*(['"][^'"]+['"]|[A-Za-z_][A-Za-z0-9_.]*)\s*\))\s*\(\s*\)/g;
  while ((match = dictJumpRegex.exec(pythonCode)) !== null) {
    const dictName = match[1];
    const targetExpression = match[2] || match[3];
    results.push({
      type: "dict_jump",
      dictName,
      targetExpression,
      index: match.index,
    });
  }

  results.sort((a, b) => a.index - b.index);
  return results;
}
