import type { CallArgument, LabelParameter } from "../../domain/index.ts";

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
      } else if (inQuote.length === 3) {
        if (
          char === inQuote[0] &&
          i + 2 < text.length &&
          text[i + 1] === char &&
          text[i + 2] === char
        ) {
          current += char + char;
          i += 2;
          inQuote = null;
        }
      } else if (char === inQuote) {
        inQuote = null;
      }
      continue;
    }

    if (
      (char === '"' || char === "'") &&
      i + 2 < text.length &&
      text[i + 1] === char &&
      text[i + 2] === char
    ) {
      inQuote = char.repeat(3);
      current += inQuote;
      i += 2;
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
  prefixRegex: RegExp,
): string | null {
  const match = prefixRegex.exec(lineText);
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
      } else if (inQuote.length === 3) {
        if (
          char === inQuote[0] &&
          i + 2 < lineText.length &&
          lineText[i + 1] === char &&
          lineText[i + 2] === char
        ) {
          content += char + char;
          i += 2;
          inQuote = null;
        }
      } else if (char === inQuote) {
        inQuote = null;
      }
      continue;
    }

    if (
      (char === '"' || char === "'") &&
      i + 2 < lineText.length &&
      lineText[i + 1] === char &&
      lineText[i + 2] === char
    ) {
      inQuote = char.repeat(3);
      content += inQuote;
      i += 2;
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
    /call\s+(?:expression\s+.*?\s+pass\s+|[A-Za-z_][A-Za-z0-9_]*\s+pass\s+|[A-Za-z_][A-Za-z0-9_]*\s*)/i,
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
