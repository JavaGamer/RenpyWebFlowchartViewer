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

  it('includes only Jump and Call predefined rules for the renpy variant', () => {
    const renpyRules = getPredefinedScreenActionRules('renpy');
    expect(renpyRules).toHaveLength(2);
    expect(renpyRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionName: 'Jump', actionKind: 'jump' }),
        expect.objectContaining({ actionName: 'Call', actionKind: 'call' }),
      ]),
    );
  });

  it('allows custom rules to override predefined rules', () => {
    const rules = mergeScreenActionRules('st', [{ actionName: 'title', actionKind: 'call' }]);
    expect(rules).toEqual(expect.arrayContaining([expect.objectContaining({ actionName: 'title', actionKind: 'call' })]));
  });

  it('mergeScreenActionRules with empty custom rules returns only predefined rules', () => {
    const rules = mergeScreenActionRules('renpy', []);
    expect(rules).toHaveLength(2);
  });

  it('mergeScreenActionRules with undefined custom rules returns only predefined rules', () => {
    const rules = mergeScreenActionRules('renpy', undefined);
    expect(rules).toHaveLength(2);
  });

  it('mergeScreenActionRules discards rules with an invalid actionKind', () => {
    const rules = mergeScreenActionRules('renpy', [
      { actionName: 'Warp', actionKind: 'teleport' as 'jump' },
    ]);
    // 'Warp' should not be added because its kind is invalid.
    expect(rules.some((r) => r.actionName === 'Warp')).toBe(false);
  });

  it('mergeScreenActionRules discards rules with an empty actionName after trimming', () => {
    const rules = mergeScreenActionRules('renpy', [{ actionName: '   ', actionKind: 'jump' }]);
    expect(rules).toHaveLength(2); // only predefined Jump and Call
  });

  it('normalizes rule lookup keys for matching', () => {
    const ruleMap = toScreenActionRuleMap('renpy', [{ actionName: 'Warp', actionKind: 'jump' }]);
    expect(ruleMap.get('warp')).toBe('jump');
  });

  it('toScreenActionRuleMap with undefined variant defaults to renpy predefined rules', () => {
    const ruleMap = toScreenActionRuleMap(undefined, undefined);
    expect(ruleMap.get('jump')).toBe('jump');
    expect(ruleMap.get('call')).toBe('call');
  });

  it('toScreenActionRuleMap with undefined customRules still returns predefined rules', () => {
    const ruleMap = toScreenActionRuleMap('renpy', undefined);
    expect(ruleMap.size).toBe(2);
  });
});
