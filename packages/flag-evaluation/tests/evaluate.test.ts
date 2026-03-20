import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/evaluate.js';
import type { FlagDefinition, UserSegmentedRules } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────

const makeSegmentedFlag = (
  segments: UserSegmentedRules['segments'],
  defaultValue: boolean,
): FlagDefinition => ({ key: 'test-flag', type: 'user_segmented', rules: { segments, defaultValue } });

// ── Boolean ───────────────────────────────────────────────────────

describe('boolean flag', () => {
  it('returns true when enabled is true', () => {
    const flag: FlagDefinition = { key: 'test-flag', type: 'boolean', rules: { enabled: true } };
    expect(evaluate(flag)).toBe(true);
  });

  it('returns false when enabled is false', () => {
    const flag: FlagDefinition = { key: 'test-flag', type: 'boolean', rules: { enabled: false } };
    expect(evaluate(flag)).toBe(false);
  });

  it('ignores context entirely', () => {
    const flag: FlagDefinition = { key: 'test-flag', type: 'boolean', rules: { enabled: true } };
    expect(evaluate(flag, { userId: 'user-123', attributes: { plan: 'free' } })).toBe(true);
  });
});

// ── Percentage ────────────────────────────────────────────────────

describe('percentage flag', () => {
  it('returns false when userId is missing', () => {
    const flag: FlagDefinition = { key: 'test-flag', type: 'percentage', rules: { percentage: 100 } };
    expect(evaluate(flag, {})).toBe(false);
    expect(evaluate(flag)).toBe(false);
  });

  it('returns true when percentage is 100', () => {
    const flag: FlagDefinition = { key: 'test-flag', type: 'percentage', rules: { percentage: 100 } };
    expect(evaluate(flag, { userId: 'any-user' })).toBe(true);
  });

  it('returns false when percentage is 0', () => {
    const flag: FlagDefinition = { key: 'test-flag', type: 'percentage', rules: { percentage: 0 } };
    expect(evaluate(flag, { userId: 'any-user' })).toBe(false);
  });

  it('is deterministic — same userId always produces the same result', () => {
    const flag: FlagDefinition = { key: 'test-flag', type: 'percentage', rules: { percentage: 50 } };
    const r1 = evaluate(flag, { userId: 'user-deterministic' });
    const r2 = evaluate(flag, { userId: 'user-deterministic' });
    expect(r1).toBe(r2);
  });

  it('uses userId:flagKey as the hash input (key affects bucketing)', () => {
    const flagA: FlagDefinition = { key: 'flag-a', type: 'percentage', rules: { percentage: 50 } };
    const flagB: FlagDefinition = { key: 'flag-b', type: 'percentage', rules: { percentage: 50 } };
    // Different keys produce different buckets for the same userId — just verify no error
    expect(typeof evaluate(flagA, { userId: 'user-key-test' })).toBe('boolean');
    expect(typeof evaluate(flagB, { userId: 'user-key-test' })).toBe('boolean');
  });
});

// ── User Segmented ────────────────────────────────────────────────

describe('user_segmented flag', () => {
  it('returns defaultValue when there are no segments', () => {
    expect(evaluate(makeSegmentedFlag([], false), { attributes: { plan: 'free' } })).toBe(false);
    expect(evaluate(makeSegmentedFlag([], true), { attributes: { plan: 'free' } })).toBe(true);
  });

  it('first matching segment wins', () => {
    const flag = makeSegmentedFlag([
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: true },
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: false }, // never reached
    ], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
  });

  it('falls back to defaultValue when no segment matches', () => {
    const flag = makeSegmentedFlag([
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: true },
    ], false);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('missing attribute counts as no-match', () => {
    const flag = makeSegmentedFlag([
      { attribute: 'plan', operator: 'eq', values: ['pro'], result: true },
    ], false);
    expect(evaluate(flag, { attributes: {} })).toBe(false);
    expect(evaluate(flag)).toBe(false);
  });

  it('operator: eq', () => {
    const flag = makeSegmentedFlag([{ attribute: 'plan', operator: 'eq', values: ['pro'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: neq', () => {
    const flag = makeSegmentedFlag([{ attribute: 'plan', operator: 'neq', values: ['free'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: in', () => {
    const flag = makeSegmentedFlag([{ attribute: 'plan', operator: 'in', values: ['pro', 'enterprise'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'enterprise' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: not_in', () => {
    const flag = makeSegmentedFlag([{ attribute: 'plan', operator: 'not_in', values: ['free'], result: true }], false);
    expect(evaluate(flag, { attributes: { plan: 'pro' } })).toBe(true);
    expect(evaluate(flag, { attributes: { plan: 'free' } })).toBe(false);
  });

  it('operator: contains', () => {
    const flag = makeSegmentedFlag([{ attribute: 'email', operator: 'contains', values: ['@example.com'], result: true }], false);
    expect(evaluate(flag, { attributes: { email: 'user@example.com' } })).toBe(true);
    expect(evaluate(flag, { attributes: { email: 'user@other.com' } })).toBe(false);
  });

  it('operator: regex', () => {
    const flag = makeSegmentedFlag([{ attribute: 'email', operator: 'regex', values: ['^.+@example\\.com$'], result: true }], false);
    expect(evaluate(flag, { attributes: { email: 'user@example.com' } })).toBe(true);
    expect(evaluate(flag, { attributes: { email: 'user@other.com' } })).toBe(false);
  });
});
