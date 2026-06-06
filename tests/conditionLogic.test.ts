import { describe, expect, it } from 'vitest';
import { evaluateConditionExpression } from '../src/domain/conditionLogic';

describe('conditionLogic', () => {
  it('returns unknown when unsupported tokens remain after tokenization', () => {
    expect(evaluateConditionExpression('flag_a + 1', { flag_a: 'true' })).toBe('unknown');
  });

  it('evaluates supported boolean expressions as before', () => {
    expect(evaluateConditionExpression('flag_a and not flag_b', { flag_a: 'true', flag_b: 'false' })).toBe('true');
  });
});
