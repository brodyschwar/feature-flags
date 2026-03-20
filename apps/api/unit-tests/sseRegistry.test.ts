import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { FlagDefinition } from '@feature-flags/flag-evaluation';
import {
  registerClient,
  removeClient,
  notifyFlagUpdated,
  notifyFlagDeleted,
  clearAllClients,
  getClientCount,
} from '../src/routes/flags/sseRegistry.js';

// ── Helpers ───────────────────────────────────────────────────────

function makeRes() {
  return { write: vi.fn() } as unknown as Response;
}

const boolDef: FlagDefinition = { key: 'bool-flag', type: 'boolean', rules: { enabled: true } };
const pctDef: FlagDefinition = { key: 'pct-flag', type: 'percentage', rules: { percentage: 50 } };

afterEach(() => clearAllClients());

// ── registerClient / removeClient ─────────────────────────────────

describe('registerClient / removeClient', () => {
  it('registered client receives notifications', () => {
    const res = makeRes();
    registerClient(res, ['bool-flag']);
    notifyFlagUpdated(boolDef);
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('removed client no longer receives notifications', () => {
    const res = makeRes();
    const client = registerClient(res, ['bool-flag']);
    removeClient(client);
    notifyFlagUpdated(boolDef);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('getClientCount reflects registrations and removals', () => {
    expect(getClientCount()).toBe(0);
    const c1 = registerClient(makeRes(), []);
    const c2 = registerClient(makeRes(), []);
    expect(getClientCount()).toBe(2);
    removeClient(c1);
    expect(getClientCount()).toBe(1);
    removeClient(c2);
    expect(getClientCount()).toBe(0);
  });
});

// ── notifyFlagUpdated ─────────────────────────────────────────────

describe('notifyFlagUpdated', () => {
  it('writes a flag_updated event to a subscribed client', () => {
    const res = makeRes();
    registerClient(res, ['bool-flag']);
    notifyFlagUpdated(boolDef);
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: flag_updated'));
  });

  it('includes the full FlagDefinition in the data line', () => {
    const res = makeRes();
    registerClient(res, ['bool-flag']);
    notifyFlagUpdated(boolDef);
    const written = (res.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const dataLine = written.split('\n').find(l => l.startsWith('data:'))!;
    expect(JSON.parse(dataLine.slice('data: '.length))).toEqual(boolDef);
  });

  it('does not notify a client subscribed to a different key', () => {
    const res = makeRes();
    registerClient(res, ['pct-flag']);
    notifyFlagUpdated(boolDef);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('notifies a client subscribed to all keys (empty keys array)', () => {
    const res = makeRes();
    registerClient(res, []);
    notifyFlagUpdated(boolDef);
    notifyFlagUpdated(pctDef);
    expect(res.write).toHaveBeenCalledTimes(2);
  });

  it('notifies multiple clients subscribed to the same key', () => {
    const res1 = makeRes();
    const res2 = makeRes();
    registerClient(res1, ['bool-flag']);
    registerClient(res2, ['bool-flag']);
    notifyFlagUpdated(boolDef);
    expect(res1.write).toHaveBeenCalledTimes(1);
    expect(res2.write).toHaveBeenCalledTimes(1);
  });

  it('removes a client whose write throws (broken connection)', () => {
    const res = makeRes();
    (res.write as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('EPIPE'); });
    registerClient(res, ['bool-flag']);

    notifyFlagUpdated(boolDef); // throws internally → client removed
    notifyFlagUpdated(boolDef); // client already gone, no second attempt

    expect(res.write).toHaveBeenCalledTimes(1);
    expect(getClientCount()).toBe(0);
  });
});

// ── notifyFlagDeleted ─────────────────────────────────────────────

describe('notifyFlagDeleted', () => {
  it('writes a flag_deleted event to a subscribed client', () => {
    const res = makeRes();
    registerClient(res, ['bool-flag']);
    notifyFlagDeleted('bool-flag');
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: flag_deleted'));
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"key":"bool-flag"'));
  });

  it('does not notify a client subscribed to a different key', () => {
    const res = makeRes();
    registerClient(res, ['pct-flag']);
    notifyFlagDeleted('bool-flag');
    expect(res.write).not.toHaveBeenCalled();
  });

  it('notifies a client subscribed to all keys', () => {
    const res = makeRes();
    registerClient(res, []);
    notifyFlagDeleted('bool-flag');
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('removes a client whose write throws', () => {
    const res = makeRes();
    (res.write as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('EPIPE'); });
    registerClient(res, ['bool-flag']);

    notifyFlagDeleted('bool-flag');
    notifyFlagDeleted('bool-flag');

    expect(res.write).toHaveBeenCalledTimes(1);
    expect(getClientCount()).toBe(0);
  });
});
