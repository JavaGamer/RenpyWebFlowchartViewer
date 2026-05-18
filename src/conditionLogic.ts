export type MockFlagValue = 'true' | 'false' | 'unknown';
export type ConditionEvaluationResult = 'true' | 'false' | 'unknown';

const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'true',
  'false',
  'none',
  'if',
  'elif',
  'else',
]);
const WHITESPACE_PATTERN = /\s/;
const CONDITION_TOKEN_PATTERN = /(\(|\)|==|!=|&&|\|\||!|and\b|or\b|not\b|True\b|False\b|[A-Za-z_][A-Za-z0-9_]*)/y;

export function extractConditionFlagRefs(expression: string | undefined): string[] {
  if (!expression) return [];
  const refs = new Set<string>();
  const matches = expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g);
  for (const match of matches) {
    const identifier = match[0];
    if (!identifier) continue;
    const lowered = identifier.toLowerCase();
    if (KEYWORDS.has(lowered)) continue;
    refs.add(identifier);
  }
  return Array.from(refs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

interface ParseState {
  tokens: string[];
  index: number;
  flags: Record<string, MockFlagValue>;
  supported: boolean;
}

function tokenizeCondition(expression: string): { tokens: string[]; fullyTokenized: boolean } {
  const tokens: string[] = [];
  const tokenPattern = CONDITION_TOKEN_PATTERN;
  tokenPattern.lastIndex = 0;
  let index = 0;
  while (index < expression.length) {
    while (index < expression.length && WHITESPACE_PATTERN.test(expression[index])) {
      index += 1;
    }
    if (index >= expression.length) break;
    tokenPattern.lastIndex = index;
    const match = tokenPattern.exec(expression);
    if (!match?.[1]) {
      return { tokens, fullyTokenized: false };
    }
    tokens.push(match[1]);
    index = tokenPattern.lastIndex;
  }
  return { tokens, fullyTokenized: true };
}

function resolveIdentifierValue(identifier: string, flags: Record<string, MockFlagValue>): ConditionEvaluationResult {
  const value = flags[identifier];
  if (value === 'true' || value === 'false') return value;
  return 'unknown';
}

function consume(state: ParseState, expected?: string): string | null {
  const token = state.tokens[state.index] ?? null;
  if (token === null) return null;
  if (expected !== undefined && token !== expected) return null;
  state.index += 1;
  return token;
}

function parsePrimary(state: ParseState): ConditionEvaluationResult {
  const token = state.tokens[state.index];
  if (!token) return 'unknown';
  if (consume(state, '(')) {
    const value = parseOr(state);
    if (!consume(state, ')')) state.supported = false;
    return value;
  }
  if (token === 'True' || token === 'true') {
    state.index += 1;
    return 'true';
  }
  if (token === 'False' || token === 'false') {
    state.index += 1;
    return 'false';
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
    state.index += 1;
    const left = resolveIdentifierValue(token, state.flags);
    const operator = state.tokens[state.index];
    if (operator === '==' || operator === '!=') {
      state.index += 1;
      const rightToken = state.tokens[state.index];
      if (!rightToken) {
        state.supported = false;
        return 'unknown';
      }
      state.index += 1;
      const rightLower = rightToken.toLowerCase();
      const right =
        rightLower === 'true'
          ? 'true'
          : rightLower === 'false'
            ? 'false'
            : /^[A-Za-z_][A-Za-z0-9_]*$/.test(rightToken)
              ? resolveIdentifierValue(rightToken, state.flags)
              : 'unknown';
      if (left === 'unknown' || right === 'unknown') return 'unknown';
      const equal = left === right;
      return operator === '==' ? (equal ? 'true' : 'false') : (equal ? 'false' : 'true');
    }
    return left;
  }
  state.supported = false;
  state.index += 1;
  return 'unknown';
}

function negate(value: ConditionEvaluationResult): ConditionEvaluationResult {
  if (value === 'unknown') return 'unknown';
  return value === 'true' ? 'false' : 'true';
}

function parseNot(state: ParseState): ConditionEvaluationResult {
  const token = state.tokens[state.index];
  if (token === '!' || token === 'not') {
    state.index += 1;
    return negate(parseNot(state));
  }
  return parsePrimary(state);
}

function andValues(a: ConditionEvaluationResult, b: ConditionEvaluationResult): ConditionEvaluationResult {
  if (a === 'false' || b === 'false') return 'false';
  if (a === 'true' && b === 'true') return 'true';
  return 'unknown';
}

function orValues(a: ConditionEvaluationResult, b: ConditionEvaluationResult): ConditionEvaluationResult {
  if (a === 'true' || b === 'true') return 'true';
  if (a === 'false' && b === 'false') return 'false';
  return 'unknown';
}

function parseAnd(state: ParseState): ConditionEvaluationResult {
  let value = parseNot(state);
  while (state.tokens[state.index] === 'and' || state.tokens[state.index] === '&&') {
    state.index += 1;
    value = andValues(value, parseNot(state));
  }
  return value;
}

function parseOr(state: ParseState): ConditionEvaluationResult {
  let value = parseAnd(state);
  while (state.tokens[state.index] === 'or' || state.tokens[state.index] === '||') {
    state.index += 1;
    value = orValues(value, parseAnd(state));
  }
  return value;
}

export function evaluateConditionExpression(
  expression: string | undefined,
  flags: Record<string, MockFlagValue>,
): ConditionEvaluationResult {
  if (!expression || expression.trim().length === 0) return 'unknown';
  const tokenized = tokenizeCondition(expression);
  const tokens = tokenized.tokens;
  if (tokens.length === 0) return 'unknown';
  if (!tokenized.fullyTokenized) return 'unknown';
  const state: ParseState = { tokens, index: 0, flags, supported: true };
  const result = parseOr(state);
  if (!state.supported) return 'unknown';
  if (state.index !== tokens.length) return 'unknown';
  return result;
}
