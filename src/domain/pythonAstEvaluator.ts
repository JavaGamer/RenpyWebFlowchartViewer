import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";

export interface PythonAssignment {
  variable: string;
  typeAnnotation?: string;
  valueExpression?: string;
  valueLiteral?: string;
  valueDict?: Map<string, string>;
  valueList?: string[];
  startIndex: number;
}

export interface PythonDirectCall {
  functionName: "jump" | "call";
  targetExpression: string;
  startIndex: number;
  endIndex: number;
}

export interface PythonParsedBlock {
  assignments: PythonAssignment[];
  directCalls: PythonDirectCall[];
}

export interface PythonAstEvaluationResult {
  value: unknown;
  isStaticallyEvaluated: boolean;
  stringCandidates: string[];
}

function isOpNode(name: string): boolean {
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
    if (child.name === "String" || child.name === "FormatString") {
      items.push(unquoteString(extractNodeText(code, child)));
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
      if (
        (prevChild.name === "String" || prevChild.name === "FormatString") &&
        nextChild &&
        (nextChild.name === "String" || nextChild.name === "FormatString")
      ) {
        const key = unquoteString(extractNodeText(code, prevChild));
        const val = unquoteString(extractNodeText(code, nextChild));
        dict.set(key, val);
      }
    }
    prevChild = child;
    child = child.nextSibling;
  }
  return dict;
}

function getNonSeparatorChildren(node: SyntaxNode): SyntaxNode[] {
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

/**
 * Parses Python code using @lezer/python and extracts top-level assignments
 * (including multi-variable tuple/list unpacking and chained assignments) and direct renpy.jump/call calls.
 */
export function parsePythonBlock(rawCode: string): PythonParsedBlock {
  const code = rawCode.replace(/^(\s*)\$\s*/gm, "$1");
  const tree = parser.parse(code);
  const assignments: PythonAssignment[] = [];
  const directCalls: PythonDirectCall[] = [];

  tree.iterate({
    enter(nodeRef) {
      const node = nodeRef.node;

      // Handle AssignStatement, UpdateStatement, and AugmentedAssignStatement (e.g. x = "val", count += 1, x, y = 1, 2)
      if (
        node.name === "AssignStatement" ||
        node.name === "UpdateStatement" ||
        node.name === "AugmentedAssignStatement"
      ) {
        let typeAnnotation: string | undefined;

        let child = node.firstChild;
        while (child) {
          if (child.name === "TypeDef") {
            typeAnnotation = extractNodeText(code, child);
          }
          child = child.nextSibling;
        }

        const allChildren: SyntaxNode[] = [];
        let curr = node.firstChild;
        let assignOpIndex = -1;
        while (curr) {
          if (
            curr.name === "AssignOp" ||
            curr.name === "UpdateOp" ||
            curr.name.includes("=")
          ) {
            assignOpIndex = allChildren.length;
          } else if (
            curr.name !== "(" &&
            curr.name !== ")" &&
            curr.name !== "[" &&
            curr.name !== "]" &&
            curr.name !== "{" &&
            curr.name !== "}" &&
            curr.name !== "," &&
            curr.name !== ":" &&
            curr.name !== "Comment"
          ) {
            allChildren.push(curr);
          }
          curr = curr.nextSibling;
        }

        if (assignOpIndex > 0 && assignOpIndex < allChildren.length) {
          const lhsChildren = allChildren.slice(0, assignOpIndex);
          const rhsChildren = allChildren.slice(assignOpIndex);

          const lhsVars: SyntaxNode[] = [];
          for (const c of lhsChildren) {
            if (c.name === "TupleExpression" || c.name === "ArrayExpression") {
              lhsVars.push(
                ...getNonSeparatorChildren(c).filter((n) =>
                  n.name === "VariableName"
                ),
              );
            } else if (c.name === "VariableName") {
              lhsVars.push(c);
            }
          }

          const rhsVals: SyntaxNode[] = [];
          for (const c of rhsChildren) {
            if (c.name === "TupleExpression" || c.name === "ArrayExpression") {
              rhsVals.push(...getNonSeparatorChildren(c));
            } else {
              rhsVals.push(c);
            }
          }

          if (lhsVars.length > 1 && lhsVars.length === rhsVals.length) {
            for (let i = 0; i < lhsVars.length; i++) {
              const varNode = lhsVars[i]!;
              const valNode = rhsVals[i]!;
              const varName = extractNodeText(code, varNode);
              const valueExpression = extractNodeText(code, valNode).trim();
              const valueLiteral = extractStringLiteral(code, valNode);
              const valueList = extractListLiteral(code, valNode);
              const valueDict = extractDictLiteral(code, valNode);

              assignments.push({
                variable: varName,
                typeAnnotation,
                valueExpression,
                valueLiteral,
                valueList,
                valueDict,
                startIndex: node.from,
              });
            }
          } else if (lhsVars.length > 0 && rhsChildren.length > 0) {
            const firstRhs = rhsChildren[0]!;
            const lastRhs = rhsChildren[rhsChildren.length - 1]!;
            const valueExpression = code.slice(firstRhs.from, lastRhs.to)
              .trim();
            const valueLiteral = extractStringLiteral(code, lastRhs);
            const valueList = extractListLiteral(code, lastRhs);
            const valueDict = extractDictLiteral(code, lastRhs);

            for (const varNode of lhsVars) {
              const variableName = extractNodeText(code, varNode);
              assignments.push({
                variable: variableName,
                typeAnnotation,
                valueExpression,
                valueLiteral,
                valueList,
                valueDict,
                startIndex: node.from,
              });
            }
          }
        }
      }

      // Handle CallExpression (e.g. renpy.jump(...), renpy.call(...))
      if (node.name === "CallExpression") {
        const calleeNode = node.firstChild;
        if (calleeNode && calleeNode.name === "MemberExpression") {
          const calleeText = extractNodeText(code, calleeNode);
          if (
            calleeText === "renpy.jump" ||
            calleeText === "renpy.call" ||
            calleeText === "renpy.jump_out_of_context"
          ) {
            const funcKind = (calleeText === "renpy.jump" ||
                calleeText === "renpy.jump_out_of_context")
              ? "jump"
              : "call";
            const argListNode = calleeNode.nextSibling;
            if (argListNode && argListNode.name === "ArgList") {
              const argListText = extractNodeText(code, argListNode).trim();
              if (argListText.startsWith("(") && argListText.endsWith(")")) {
                const targetExpression = argListText.slice(1, -1).trim();
                directCalls.push({
                  functionName: funcKind,
                  targetExpression,
                  startIndex: node.from,
                  endIndex: node.to,
                });
              }
            }
          }
        }
      }
    },
  });

  return { assignments, directCalls };
}

/**
 * Evaluates a Python expression AST statically using @lezer/python.
 * Correctly evaluates condition expressions, ternary operations, function calls,
 * arithmetic, comparison, and logical operators.
 */
export function evaluatePythonAstExpression(
  expressionText: string,
  environment: Record<string, unknown> = {},
): PythonAstEvaluationResult {
  const trimmed = expressionText.trim();
  if (!trimmed) {
    return {
      value: undefined,
      isStaticallyEvaluated: false,
      stringCandidates: [],
    };
  }

  try {
    const tree = parser.parse(trimmed);
    const root = tree.topNode;

    const stringCandidates: string[] = [];

    const evalNode = (node: SyntaxNode): { value: unknown; ok: boolean } => {
      if (!node) return { value: undefined, ok: false };

      const nodeKind = node.name;

      if (nodeKind === "Script" || nodeKind === "ExpressionStatement") {
        const child = node.firstChild;
        return child ? evalNode(child) : { value: undefined, ok: false };
      }

      if (nodeKind === "ParenthesizedExpression") {
        const children = getNonSeparatorChildren(node);
        return children[0]
          ? evalNode(children[0])
          : { value: undefined, ok: false };
      }

      if (nodeKind === "String" || nodeKind === "FormatString") {
        const strVal = unquoteString(extractNodeText(trimmed, node));
        stringCandidates.push(strVal);
        return { value: strVal, ok: true };
      }

      if (nodeKind === "Number") {
        const text = extractNodeText(trimmed, node);
        const num = Number(text);
        return { value: num, ok: !isNaN(num) };
      }

      if (nodeKind === "Boolean" || nodeKind === "VariableName") {
        const text = extractNodeText(trimmed, node);
        if (text === "True" || text === "true") {
          return { value: true, ok: true };
        }
        if (text === "False" || text === "false") {
          return { value: false, ok: true };
        }
        if (text === "None" || text === "none") {
          return { value: null, ok: true };
        }

        if (Object.prototype.hasOwnProperty.call(environment, text)) {
          const envVal = environment[text];
          if (typeof envVal === "string") stringCandidates.push(envVal);
          return { value: envVal, ok: true };
        }
        return { value: undefined, ok: false };
      }

      // Handle MemberExpression (e.g. persistent.flag, stats.hp)
      if (nodeKind === "MemberExpression") {
        const fullText = extractNodeText(trimmed, node);
        if (Object.prototype.hasOwnProperty.call(environment, fullText)) {
          const envVal = environment[fullText];
          if (typeof envVal === "string") stringCandidates.push(envVal);
          return { value: envVal, ok: true };
        }
        const objChild = node.firstChild;
        const propChild = node.lastChild;
        if (objChild && propChild && objChild !== propChild) {
          const objRes = evalNode(objChild);
          const propName = extractNodeText(trimmed, propChild);
          if (
            objRes.ok &&
            typeof objRes.value === "object" &&
            objRes.value !== null
          ) {
            const val = (objRes.value as Record<string, unknown>)[propName];
            if (typeof val === "string") stringCandidates.push(val);
            return { value: val, ok: true };
          }
        }
        return { value: undefined, ok: false };
      }

      // Handle Ternary: ConditionalExpression (consequence if test else alternative)
      if (nodeKind === "ConditionalExpression") {
        let consequenceNode: SyntaxNode | null = null;
        let testNode: SyntaxNode | null = null;
        let alternativeNode: SyntaxNode | null = null;

        let child = node.firstChild;
        let mode: "consequence" | "test" | "alternative" = "consequence";

        while (child) {
          const cName = child.name;
          if (cName === "if") {
            mode = "test";
          } else if (cName === "else") {
            mode = "alternative";
          } else if (cName !== "(" && cName !== ")" && cName !== "Comment") {
            if (mode === "consequence" && !consequenceNode) {
              consequenceNode = child;
            } else if (mode === "test" && !testNode) testNode = child;
            else if (mode === "alternative" && !alternativeNode) {
              alternativeNode = child;
            }
          }
          child = child.nextSibling;
        }

        if (consequenceNode && testNode && alternativeNode) {
          const testRes = evalNode(testNode);
          if (testRes.ok) {
            const isTruthy = Boolean(testRes.value);
            return isTruthy
              ? evalNode(consequenceNode)
              : evalNode(alternativeNode);
          } else {
            const cRes = evalNode(consequenceNode);
            const aRes = evalNode(alternativeNode);
            if (cRes.ok && typeof cRes.value === "string") {
              stringCandidates.push(cRes.value);
            }
            if (aRes.ok && typeof aRes.value === "string") {
              stringCandidates.push(aRes.value);
            }
            return { value: undefined, ok: false };
          }
        }
      }

      // Handle CallExpression
      if (nodeKind === "CallExpression") {
        const calleeNode = node.firstChild;
        if (calleeNode) {
          const calleeText = extractNodeText(trimmed, calleeNode);
          let argListNode: SyntaxNode | null = null;
          let curr = node.firstChild;
          while (curr) {
            if (curr.name === "ArgList") {
              argListNode = curr;
              break;
            }
            curr = curr.nextSibling;
          }

          const argNodes = argListNode
            ? getNonSeparatorChildren(argListNode)
            : [];
          const evaluatedArgs: unknown[] = [];
          let allArgsOk = true;

          for (const argNode of argNodes) {
            const argRes = evalNode(argNode);
            if (argRes.ok) {
              evaluatedArgs.push(argRes.value);
            } else {
              allArgsOk = false;
            }
          }

          if (calleeText === "str" && argNodes.length === 1 && allArgsOk) {
            return { value: String(evaluatedArgs[0]), ok: true };
          }
          if (calleeText === "int" && argNodes.length === 1 && allArgsOk) {
            const num = Number(evaluatedArgs[0]);
            return { value: num, ok: !isNaN(num) };
          }
          if (calleeText === "bool" && argNodes.length === 1 && allArgsOk) {
            return { value: Boolean(evaluatedArgs[0]), ok: true };
          }
          if (calleeText === "len" && argNodes.length === 1 && allArgsOk) {
            const argVal = evaluatedArgs[0];
            if (typeof argVal === "string" || Array.isArray(argVal)) {
              return { value: argVal.length, ok: true };
            }
            if (argVal instanceof Set || argVal instanceof Map) {
              return { value: argVal.size, ok: true };
            }
          }

          return { value: undefined, ok: false };
        }
      }

      // Handle BinaryExpression
      if (nodeKind === "BinaryExpression") {
        let leftNode: SyntaxNode | null = null;
        let rightNode: SyntaxNode | null = null;

        let child = node.firstChild;
        while (child) {
          if (
            child.name !== "(" &&
            child.name !== ")" &&
            child.name !== "Comment" &&
            !isOpNode(child.name)
          ) {
            if (!leftNode) {
              leftNode = child;
            } else if (!rightNode && child.from >= leftNode.to) {
              rightNode = child;
            }
          }
          child = child.nextSibling;
        }

        if (leftNode && rightNode) {
          const op = trimmed.slice(leftNode.to, rightNode.from).trim();

          const lRes = evalNode(leftNode);
          const rRes = evalNode(rightNode);

          if (op === "and") {
            if (lRes.ok && !lRes.value) return { value: lRes.value, ok: true };
            if (lRes.ok && rRes.ok) {
              return { value: lRes.value && rRes.value, ok: true };
            }
          } else if (op === "or") {
            if (lRes.ok && lRes.value) return { value: lRes.value, ok: true };
            if (lRes.ok && rRes.ok) {
              return { value: lRes.value || rRes.value, ok: true };
            }
          } else if (lRes.ok && rRes.ok) {
            const lv = lRes.value as number | string | boolean;
            const rv = rRes.value as number | string | boolean;

            if (op === "+") {
              if (typeof lv === "string" || typeof rv === "string") {
                return { value: String(lv) + String(rv), ok: true };
              }
              const num = (lv as number) + (rv as number);
              return { value: num, ok: !isNaN(num) };
            }
            if (op === "-") {
              const num = (lv as number) - (rv as number);
              return { value: num, ok: !isNaN(num) };
            }
            if (op === "*") {
              if (
                typeof lv === "string" &&
                typeof rv === "number" &&
                Number.isInteger(rv) &&
                rv >= 0
              ) {
                return { value: lv.repeat(Math.min(rv, 1000)), ok: true };
              }
              const num = (lv as number) * (rv as number);
              return { value: num, ok: !isNaN(num) };
            }
            if (op === "/") {
              return {
                value: (rv as number) !== 0
                  ? (lv as number) / (rv as number)
                  : undefined,
                ok: (rv as number) !== 0,
              };
            }
            if (op === "%") {
              return {
                value: (rv as number) !== 0
                  ? (lv as number) % (rv as number)
                  : undefined,
                ok: (rv as number) !== 0,
              };
            }
            if (op === "//") {
              return {
                value: (rv as number) !== 0
                  ? Math.floor((lv as number) / (rv as number))
                  : undefined,
                ok: (rv as number) !== 0,
              };
            }
            if (op === "**") {
              return {
                value: Math.pow(lv as number, rv as number),
                ok: true,
              };
            }
            if (op === "==") return { value: lv === rv, ok: true };
            if (op === "!=") return { value: lv !== rv, ok: true };
            if (op === "<") return { value: lv < rv, ok: true };
            if (op === ">") return { value: lv > rv, ok: true };
            if (op === "<=") return { value: lv <= rv, ok: true };
            if (op === ">=") return { value: lv >= rv, ok: true };
            if (op === "is") return { value: lv === rv, ok: true };
            if (op === "is not") return { value: lv !== rv, ok: true };
            if (op === "in" || op === "not in") {
              let contained = false;
              if (Array.isArray(rv)) {
                contained = rv.includes(lv);
              } else if (typeof rv === "string") {
                contained = rv.includes(String(lv));
              } else if (typeof rv === "object" && rv !== null) {
                const obj = rv as
                  | Set<unknown>
                  | Map<unknown, unknown>
                  | Record<string, unknown>;
                if (obj instanceof Set) {
                  contained = obj.has(lv);
                } else if (obj instanceof Map) {
                  contained = obj.has(String(lv));
                } else {
                  contained = Object.prototype.hasOwnProperty.call(
                    obj,
                    String(lv),
                  );
                }
              }
              const val = op === "in" ? contained : !contained;
              return { value: val, ok: true };
            }
            if (op === "&") {
              return {
                value: (lv as number) & (rv as number),
                ok: true,
              };
            }
            if (op === "|") {
              return {
                value: (lv as number) | (rv as number),
                ok: true,
              };
            }
            if (op === "^") {
              return {
                value: (lv as number) ^ (rv as number),
                ok: true,
              };
            }
            if (op === "<<") {
              return {
                value: (lv as number) << (rv as number),
                ok: true,
              };
            }
            if (op === ">>") {
              return {
                value: (lv as number) >> (rv as number),
                ok: true,
              };
            }
          }
        }
      }

      // Handle UnaryExpression
      if (nodeKind === "UnaryExpression") {
        const children = getNonSeparatorChildren(node);
        if (children.length >= 1) {
          const opText = extractNodeText(trimmed, node).trim();
          const targetNode = children[children.length - 1]!;
          const res = evalNode(targetNode);
          if (res.ok) {
            if (opText.startsWith("not")) {
              return { value: !res.value, ok: true };
            }
            if (opText.startsWith("-")) {
              return { value: -(res.value as number), ok: true };
            }
            if (opText.startsWith("+")) {
              return { value: +(res.value as number), ok: true };
            }
            if (opText.startsWith("~")) {
              return { value: ~(res.value as number), ok: true };
            }
          }
        }
      }

      return { value: undefined, ok: false };
    };

    const res = evalNode(root);
    return {
      value: res.value,
      isStaticallyEvaluated: res.ok,
      stringCandidates: Array.from(new Set(stringCandidates)),
    };
  } catch {
    return {
      value: undefined,
      isStaticallyEvaluated: false,
      stringCandidates: [],
    };
  }
}
