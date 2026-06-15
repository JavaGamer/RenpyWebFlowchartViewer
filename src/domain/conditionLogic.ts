import { Parser } from 'expr-eval-fork';

export type MockFlagValue = 'true' | 'false' | 'unknown';
export type ConditionEvaluationResult = 'true' | 'false' | 'unknown';

const parser = new Parser({
  operators: {
    logical: true,
    comparison: true,
    add: false,
    subtract: false,
    multiply: false,
    divide: false,
    remainder: false,
    power: false,
    concatenate: false,
  },
});

const flagRefsCache = new Map<string, string[]>();

export function extractConditionFlagRefs(expression: string | undefined): string[] {
  if (!expression || expression.trim().length === 0) return [];
  try {
    let refs = flagRefsCache.get(expression);
    if (!refs) {
      const vars = parser.parse(expression).variables();
      const KEYWORDS = new Set(['true', 'false', 'none', 'and', 'or', 'not']);
      refs = vars
        .filter((v) => !KEYWORDS.has(v.toLowerCase()))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      flagRefsCache.set(expression, refs);
    }
    return refs;
  } catch {
    return [];
  }
}

interface EvalInstruction {
  type: string;
  value?: unknown;
}

function evaluateInstructions(instructions: EvalInstruction[], flags: Record<string, MockFlagValue>): ConditionEvaluationResult {
  const stack: ConditionEvaluationResult[] = [];

  for (const inst of instructions) {
    if (inst.type === 'IVAR') {
      const val = typeof inst.value === 'string' ? inst.value : '';
      const lower = val.toLowerCase();
      if (lower === 'true') {
        stack.push('true');
      } else if (lower === 'false') {
        stack.push('false');
      } else if (val) {
        const flagVal = flags[val];
        stack.push(flagVal === 'true' || flagVal === 'false' ? flagVal : 'unknown');
      } else {
        stack.push('unknown');
      }
    } else if (inst.type === 'ISTR') {
      const val = typeof inst.value === 'string' ? inst.value : '';
      const lower = val.toLowerCase();
      if (lower === 'true') {
        stack.push('true');
      } else if (lower === 'false') {
        stack.push('false');
      } else {
        stack.push('unknown');
      }
    } else if (inst.type === 'INUM') {
      stack.push('unknown');
    } else if (inst.type === 'IEXPR') {
      if (Array.isArray(inst.value)) {
        stack.push(evaluateInstructions(inst.value as EvalInstruction[], flags));
      } else {
        stack.push('unknown');
      }
    } else if (inst.type === 'IOP1') {
      const val = stack.pop();
      if (!val) throw new Error('Stack underflow');
      stack.push(val === 'unknown' ? 'unknown' : val === 'true' ? 'false' : 'true');
    } else if (inst.type === 'IOP2') {
      const right = stack.pop();
      const left = stack.pop();
      if (!left || !right) throw new Error('Stack underflow');

      const op = typeof inst.value === 'string' ? inst.value : '';
      if (op === 'and' || op === '&&') {
        if (left === 'false' || right === 'false') {
          stack.push('false');
        } else if (left === 'true' && right === 'true') {
          stack.push('true');
        } else {
          stack.push('unknown');
        }
      } else if (op === 'or' || op === '||') {
        if (left === 'true' || right === 'true') {
          stack.push('true');
        } else if (left === 'false' && right === 'false') {
          stack.push('false');
        } else {
          stack.push('unknown');
        }
      } else if (op === '==' || op === '!=') {
        if (left === 'unknown' || right === 'unknown') {
          stack.push('unknown');
        } else {
          const equal = left === right;
          const res = op === '==' ? equal : !equal;
          stack.push(res ? 'true' : 'false');
        }
      } else {
        stack.push('unknown');
      }
    }
  }

  return stack.pop() ?? 'unknown';
}

const parsedExpressionCache = new Map<string, EvalInstruction[]>();

export function evaluateConditionExpression(
  expression: string | undefined,
  flags: Record<string, MockFlagValue>,
): ConditionEvaluationResult {
  if (!expression || expression.trim().length === 0) return 'unknown';
  try {
    let tokens = parsedExpressionCache.get(expression);
    if (!tokens) {
      const expr = parser.parse(expression);
      tokens = (expr as unknown as { tokens: EvalInstruction[] }).tokens;
      parsedExpressionCache.set(expression, tokens);
    }
    return evaluateInstructions(tokens, flags);
  } catch {
    return 'unknown';
  }
}
