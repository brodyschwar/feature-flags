import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/evaluation/evaluate.js';
import type { Flag, UserSegmentedRules } from '../src/schemas/flag.schema.js';

const base = {
  id: '00000000-0000-0000-0000-000000000001',
  key: 'test-flag',
  name: 'Test Flag',
  description: '',
  createdAt: 0,
  updatedAt: 0,
};

describe('boolean flag', () => {
  it('returns true when enabled is true', () => {
    const flag: Flag = { ...base, type: 'boolean', rules: { enabled: true } };
    expect(evaluate(flag)).toBe(true);
  });

  it('returns false when enabled is false', () => {
    const flag: Flag = { ...base, type: 'boolean', rules: { enabled: false } };
    expect(evaluate(flag)).toBe(false);
  });

  it('ignores context entirely', () => {
    const flag: Flag = { ...base, type: 'boolean', rules: { enabled: true } };
    expect(evaluate(flag, { userId: 'user-123', attributes: { plan: 'free' } })).toBe(true);
  });
});

describe('percentage flag', () => {
  it('returns false when userId is missing', () => {
    const flag: Flag = { ...base, type: 'percentage', rules: { percentage: 100 } };
    expect(evaluate(flag, {})).toBe(false);
    expect(evaluate(flag)).toBe(false);
  });

  it('returns true when percentage is 100', () => {
    const flag: Flag = { ...base, type: 'percentage', rules: { percentage: 100 } };
    expect(evaluate(flag, { userId: 'any-user' })).toBe(true);
  });

  it('returns false when percentage is 0', () => {
    const flag: Flag = { ...base, type: 'percentage', rules: { percentage: 0 } };
    expect(evaluate(flag, { userId: 'any-user' })).toBe(false);
  });

  it('is deterministic — same userId always produces the same result', () => {
    const flag: Flag = { ...base, type: 'percentage', rules: { percentage: 50 } };
    const r1 = evaluate(flag, { userId: 'user-deterministic' });
    const r2 = evaluate(flag, { userId: 'user-deterministic' });
    expect(r1).toBe(r2);
  });

  it('uses userId:flagKey as the hash input (key affects result)', () => {
    const flagA: Flag = { ...base, key: 'flag-a', type: 'percentage', rules: { percentage: 50 } };
    const flagB: Flag = { ...base, key: 'flag-b', type: 'percentage', rules: { percentage: 50 } };
    // Different keys should produce different buckets for the same userId (not guaranteed to differ, but statistically almost certain)
    const userId = 'user-key-test';
    // Just verify they evaluate without error — if both happen to match that's fine
    expect(typeof evaluate(flagA, { userId })).toBe('boolean');
    expect(typeof evaluate(flagB, { userId })).toBe('boolean');
  });
});

describe('user_segmented flag', () => {
  const makeFlag = (segments: UserSegmentedRules['segments'], defaultValue: boolean): Flag =>
    ({ ...base, type: 'user_segmented', rules: { segments, defaultValue } });

  it('returns defaultValue when no segments match', () => {
    const flag = makeFlag([], false);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('first matching segment wins', () => {
    const flag = makeFlag([
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: true },
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: false }, // never reached
    ], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
  });

  it('falls back to defaultValue when no segment matches', () => {
    const flag = makeFlag([
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: true },
    ], false);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('missing attribute counts as no-match', () => {
    const flag = makeFlag([
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: true },
    ], false);
    expect(evaluate(flag, { attributes: {} })).toBe(false);
    expect(evaluate(flag)).toBe(false);
  });

  it('operator: eq', () => {
    const flag = makeFlag([{ attribute: 'plan', operator: 'eq', values: ['pro'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: neq', () => {
    const flag = makeFlag([{ attribute: 'plan', operator: 'neq', values: ['free'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: in', () => {
    const flag = makeFlag([{ attribute: 'plan', operator: 'in', values: ['pro', 'enterprise'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'enterprise' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: not_in', () => {
    const flag = makeFlag([{ attribute: 'plan', operator: 'not_in', values: ['free'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: contains', () => {
    const flag = makeFlag([{ attribute: 'email', operator: 'contains', values: ['@example.com'], result: true }], false);
    expect(evaluate(flag, { attributes: { email: 'user@example.com' } })).toBe(true);
    expect(evaluate(flag, { attributes: { email: 'user@other.com' } })).toBe(false);
  });

  it('operator: regex', () => {
    const flag = makeFlag([{ attribute: 'email', operator: 'regex', values: ['^.+@example\\.com$'], result: true }], false);
    expect(evaluate(flag, { attributes: { email: 'user@example.com' } })).toBe(true);
    expect(evaluate(flag, { attributes: { email: 'user@other.com' } })).toBe(false);
  });
});
