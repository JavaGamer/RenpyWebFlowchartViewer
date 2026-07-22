import { parser } from '@lezer/python';

export interface ExtractedPythonCall {
  type: 'jump' | 'call' | 'call_in_new_context' | 'pop_call' | 'dict_jump';
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
  let current = '';
  let depth = 0;
  let inQuote: '"""' | "'''" | '"' | "'" | null = null;

  for (let i = 0; i < rawArgs.length; i++) {
    const char = rawArgs[i]!;

    // Check for triple quotes
    if (!inQuote) {
      if (rawArgs.slice(i, i + 3) === '"""') {
        inQuote = '"""';
        current += '"""';
        i += 2;
        continue;
      }
      if (rawArgs.slice(i, i + 3) === "'''") {
        inQuote = "'''";
        current += "'''";
        i += 2;
        continue;
      }
    } else if (inQuote === '"""' && rawArgs.slice(i, i + 3) === '"""') {
      inQuote = null;
      current += '"""';
      i += 2;
      continue;
    } else if (inQuote === "'''" && rawArgs.slice(i, i + 3) === "'''") {
      inQuote = null;
      current += "'''";
      i += 2;
      continue;
    }

    if (inQuote) {
      current += char;
      if (char === '\\') {
        if (i + 1 < rawArgs.length) {
          current += rawArgs[++i];
        }
      } else if (inQuote === char) {
        inQuote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = char;
      current += char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth++;
      current += char;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = '';
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
 * Uses Lezer Python parser to extract function definitions (`def func(...):`).
 */
export function extractPythonFunctionDefs(pythonCode: string): ExtractedPythonFunctionDef[] {
  const defs: ExtractedPythonFunctionDef[] = [];
  if (!pythonCode || !pythonCode.trim()) return defs;

  try {
    const tree = parser.parse(pythonCode);

    tree.iterate({
      enter(node) {
        if (node.name === 'FunctionDefinition') {
          const fnText = pythonCode.slice(node.from, node.to);
          const startIndex = node.from;

          // Parse function name and parameters
          const match = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:->\s*[^:]+)?\s*:/m.exec(fnText);
          if (match) {
            const name = match[1]!;
            const rawArgs = match[2] || '';
            const args = splitPythonArgs(rawArgs);

            // Extract body (code following the header match[0])
            const rawBody = fnText.slice(match[0].length);
            const rawBodyLines = rawBody.split('\n');
            const bodyLines: string[] = [];
            for (const line of rawBodyLines) {
              if (bodyLines.length === 0 && !line.trim()) continue;
              bodyLines.push(line);
            }

            defs.push({
              name,
              args,
              body: bodyLines.join('\n').trim(),
              startIndex,
            });
          }
        }
      },
    });
  } catch {
    // Fallback if parsing fails
  }

  return defs;
}

/**
 * Uses Lezer Python parser to extract call expressions (jumps, calls, dict jumps).
 */
export function parsePythonBlockAst(pythonCode: string): ExtractedPythonCall[] {
  const results: ExtractedPythonCall[] = [];
  if (!pythonCode || !pythonCode.trim()) return results;

  try {
    const tree = parser.parse(pythonCode);
    tree.iterate({
      enter(node) {
        if (node.name === 'CallExpression') {
          const callText = pythonCode.slice(node.from, node.to);
          const index = node.from;

          // Ignore call expressions inside String or Comment nodes
          const parentName = node.node.parent?.name;
          if (parentName === 'String' || parentName === 'Comment') {
            return;
          }

          if (/^\brenpy\.call_in_new_context\b/.test(callText.trim())) {
            const cleanCallText = callText.replace(/#.*$/, '').trim();
            const argText = cleanCallText
              .replace(/^renpy\.call_in_new_context\s*\(/, '')
              .replace(/\)$/, '')
              .trim();
            results.push({
              type: 'call_in_new_context',
              targetExpression: argText,
              index,
            });
          } else if (/^\brenpy\.pop_call\b/.test(callText.trim())) {
            results.push({
              type: 'pop_call',
              index,
            });
          } else {
            // Check for dict jump pattern e.g. ROUTER[key]() or ROUTER[key](arg1, arg2)
            const cleanCallText = callText.replace(/#.*$/, '').trim();
            const dictMatch = /^\b([A-Za-z_][A-Za-z0-9_]*)(?:\[\s*(.*?)\s*\]|\.get\(\s*[^,]+\s*,\s*(.*?)\s*\))\s*\([\s\S]*?\)$/.exec(cleanCallText);
            if (dictMatch) {
              results.push({
                type: 'dict_jump',
                dictName: dictMatch[1],
                targetExpression: dictMatch[2] || dictMatch[3],
                index,
              });
            }
          }
        }
      },
    });
  } catch {
    // Fallback scan if error occurs
  }

  results.sort((a, b) => a.index - b.index);
  return results;
}
