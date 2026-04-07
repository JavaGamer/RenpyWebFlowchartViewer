import { describe, expect, it } from 'vitest';
import {
  getPredefinedScreenActionRules,
  mergeScreenActionRules,
  toScreenActionRuleMap,
} from '../src/config/parserRules';

describe('parser rule variants', () => {
  it('includes ST default mappings in st variant', () => {
    const stRules = getPredefinedScreenActionRules('st');
    expect(stRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionName: 'timedchoice' }),
        expect.objectContaining({ actionName: 'gameover' }),
        expect.objectContaining({ actionName: 'title' }),
        expect.objectContaining({ actionName: 'placeholder' }),
        expect.objectContaining({ actionName: 'routename' }),
      ]),
    );
  });

  it('allows custom rules to override predefined rules', () => {
    const rules = mergeScreenActionRules('st', [{ actionName: 'title', actionKind: 'call' }]);
    expect(rules).toEqual(expect.arrayContaining([expect.objectContaining({ actionName: 'title', actionKind: 'call' })]));
  });

  it('normalizes rule lookup keys for matching', () => {
    const ruleMap = toScreenActionRuleMap('renpy', [{ actionName: 'Warp', actionKind: 'jump' }]);
    expect(ruleMap.get('warp')).toBe('jump');
  });
});
