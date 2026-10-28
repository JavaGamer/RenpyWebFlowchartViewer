import type { SyntaxNode } from "@lezer/common";

export const COMPARISON_OPS = new Set([
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "is",
  "is not",
  "in",
  "not in",
]);

/**
 * Evaluates truthiness according to Python semantics:
 * - None, False, 0, 0.0, "", empty collections ([], {}, set(), Map()) are falsy.
 * - All non-empty collections, non-zero numbers, non-empty strings are truthy.
 */
export function isPythonTruthy(val: unknown): boolean {
  if (val === null || val === undefined || val === false) return false;
  if (typeof val === "number") return val !== 0 && !isNaN(val);
  if (typeof val === "string") return val.length > 0;
  if (Array.isArray(val)) return val.length > 0;
  if (val instanceof Set || val instanceof Map) return val.size > 0;
  if (typeof val === "object") return Object.keys(val).length > 0;
  return Boolean(val);
}

/**
 * Tests whether an expression is a direct boolean negation of a specific variable name
 * (e.g. `not x`, `not (x)`, `not(x)`, `(not x)`).
 */
export function isVariableNegationOf(
  rawExpr: string,
  varName: string,
): boolean {
  const clean = rawExpr.replace(/#.*$/, "").trim();
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(?:\\(\\s*not\\s+${escaped}\\s*\\)|not\\s*\\(\\s*${escaped}\\s*\\)|not\\s+${escaped})$`,
  );
  return pattern.test(clean);
}

export function isOpNode(name: string): boolean {
  return (
    name === "ArithOp" ||
    name === "CompareOp" ||
    name === "LogicOp" ||
    name === "BitOp" ||
    name === "AssignOp" ||
    name === "UpdateOp" ||
    name === "+" ||
    name === "-" ||
    name === "*" ||
    name === "/" ||
    name === "%" ||
    name === "//" ||
    name === "**" ||
    name === "==" ||
    name === "!=" ||
    name === "<" ||
    name === ">" ||
    name === "<=" ||
    name === ">=" ||
    name === "and" ||
    name === "or" ||
    name === "is" ||
    name === "in" ||
    name === "not" ||
    name === "&" ||
    name === "|" ||
    name === "^" ||
    name === "<<" ||
    name === ">>" ||
    name === "~"
  );
}

export function unquoteString(text: string): string {
  let trimmed = text.trim();
  const prefixMatch =
    /^(?:[rR][bB]|[bB][rR]|[rR][uU]|[uU][rR]|[fF][rR]|[rR][fF]|[rR]|[uU]|[bB]|[fF])/
      .exec(trimmed);
  let prefix = "";
  if (prefixMatch) {
    const candidate = prefixMatch[0];
    const rest = trimmed.slice(candidate.length);
    if (rest.startsWith('"') || rest.startsWith("'")) {
      prefix = candidate;
      trimmed = rest;
    }
  }
  const isRaw = prefix.toLowerCase().includes("r");

  let rawInner: string;
  if (
    (trimmed.startsWith('"""') && trimmed.endsWith('"""') &&
      trimmed.length >= 6) ||
    (trimmed.startsWith("'''") && trimmed.endsWith("'''") &&
      trimmed.length >= 6)
  ) {
    rawInner = trimmed.slice(3, -3);
  } else if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    rawInner = trimmed.slice(1, -1);
  } else {
    return trimmed;
  }

  if (isRaw) return rawInner;

  let result = "";
  let i = 0;
  while (i < rawInner.length) {
    const char = rawInner[i]!;
    if (char === "\\") {
      i++;
      if (i < rawInner.length) {
        const nextChar = rawInner[i]!;
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

  return result;
}

export function extractNodeText(code: string, node: SyntaxNode): string {
  return code.slice(node.from, node.to);
}

export function extractStringLiteral(
  code: string,
  node: SyntaxNode | null,
): string | undefined {
  if (!node) return undefined;
  if (node.name === "String" || node.name === "FormatString") {
    return unquoteString(extractNodeText(code, node));
  }
  return undefined;
}

export function extractListLiteral(
  code: string,
  node: SyntaxNode | null,
): string[] | undefined {
  if (!node) return undefined;
  if (node.name !== "ArrayExpression" && node.name !== "TupleExpression") {
    return undefined;
  }
  const items: string[] = [];
  let child = node.firstChild;
  while (child) {
    if (
      child.name !== "(" &&
      child.name !== ")" &&
      child.name !== "[" &&
      child.name !== "]" &&
      child.name !== "," &&
      child.name !== "Comment"
    ) {
      const val = extractStringLiteral(code, child);
      if (val !== undefined) {
        items.push(val);
      }
    }
    child = child.nextSibling;
  }
  return items;
}

export function extractDictLiteral(
  code: string,
  node: SyntaxNode | null,
): Map<string, string> | undefined {
  if (!node || node.name !== "DictionaryExpression") return undefined;
  const dict = new Map<string, string>();
  let child = node.firstChild;
  let prevChild: SyntaxNode | null = null;
  while (child) {
    if (child.name === ":" && prevChild) {
      const nextChild = child.nextSibling;
      if (nextChild) {
        const key = extractStringLiteral(code, prevChild);
        const val = extractStringLiteral(code, nextChild);
        if (key !== undefined && val !== undefined) {
          dict.set(key, val);
        }
      }
    }
    if (
      child.name !== "{" &&
      child.name !== "}" &&
      child.name !== "," &&
      child.name !== ":" &&
      child.name !== "Comment"
    ) {
      prevChild = child;
    }
    child = child.nextSibling;
  }
  return dict;
}

export function getNonSeparatorChildren(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    if (
      child.name !== "(" &&
      child.name !== ")" &&
      child.name !== "[" &&
      child.name !== "]" &&
      child.name !== "{" &&
      child.name !== "}" &&
      child.name !== "," &&
      child.name !== ":" &&
      child.name !== "Comment"
    ) {
      result.push(child);
    }
    child = child.nextSibling;
  }
  return result;
}
