import { describe, it, expect } from 'vitest';
import { computeEtag } from '../src/utils/etag.js';

describe('computeEtag', () => {
  it('returns a quoted hex string', () => {
    const etag = computeEtag({ foo: 'bar' });
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('is deterministic for the same input', () => {
    const payload = { key: 'test', type: 'boolean', rules: { enabled: true } };
    expect(computeEtag(payload)).toBe(computeEtag(payload));
  });

  it('differs when rules change', () => {
    const a = computeEtag({ key: 'test', type: 'boolean', rules: { enabled: true } });
    const b = computeEtag({ key: 'test', type: 'boolean', rules: { enabled: false } });
    expect(a).not.toBe(b);
  });

  it('differs when type changes', () => {
    const a = computeEtag({ key: 'test', type: 'boolean', rules: { enabled: true } });
    const b = computeEtag({ key: 'test', type: 'percentage', rules: { percentage: 50 } });
    expect(a).not.toBe(b);
  });

  it('differs when key changes', () => {
    const a = computeEtag({ key: 'flag-a', type: 'boolean', rules: { enabled: true } });
    const b = computeEtag({ key: 'flag-b', type: 'boolean', rules: { enabled: true } });
    expect(a).not.toBe(b);
  });

  it('differs for arrays with different contents', () => {
    const a = computeEtag([{ key: 'flag-a', type: 'boolean', rules: { enabled: true } }]);
    const b = computeEtag([{ key: 'flag-b', type: 'boolean', rules: { enabled: true } }]);
    expect(a).not.toBe(b);
  });

  it('is stable for equal arrays in the same order', () => {
    const flags = [
      { key: 'flag-a', type: 'boolean', rules: { enabled: true } },
      { key: 'flag-b', type: 'percentage', rules: { percentage: 50 } },
    ];
    expect(computeEtag(flags)).toBe(computeEtag(flags));
  });

  it('differs for arrays in different order', () => {
    const a = computeEtag([{ key: 'x' }, { key: 'y' }]);
    const b = computeEtag([{ key: 'y' }, { key: 'x' }]);
    expect(a).not.toBe(b);
  });

  it('handles an empty array', () => {
    const etag = computeEtag([]);
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  });
});
