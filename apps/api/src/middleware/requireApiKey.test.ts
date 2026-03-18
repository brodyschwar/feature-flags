import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const mockFindOne = vi.fn();
const mockUpdateOne = vi.fn();

vi.mock('../db/collections.js', () => ({
  getApiKeysCollection: () => ({
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
  }),
}));

const { requireApiKey } = await import('./requireApiKey.js');

function makeReq(authHeader?: string): Request {
  return { headers: authHeader ? { authorization: authHeader } : {} } as Request;
}

function makeRes(): Response {
  const res = {} as Response;
  (res as unknown as Record<string, unknown>).status = vi.fn().mockReturnValue(res);
  (res as unknown as Record<string, unknown>).json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireApiKey(req, res, next);

    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when key does not have ff_ prefix', async () => {
    const req = makeReq('Bearer sk_not_a_feature_flag_key');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireApiKey(req, res, next);

    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when key is not found in the database', async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const req = makeReq('Bearer ff_unknownkeynotindatabase000');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireApiKey(req, res, next);

    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for a valid key and updates lastUsedAt', async () => {
    const plaintext = 'ff_validkeyabcdefghijklmnopqrstu';
    const hash = createHash('sha256').update(plaintext).digest('hex');

    mockFindOne.mockResolvedValueOnce({ _id: hash, name: 'test-key', createdAt: 1000, lastUsedAt: null });
    mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    const req = makeReq(`Bearer ${plaintext}`);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireApiKey(req, res, next);

    expect(mockFindOne).toHaveBeenCalledWith({ _id: hash });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: hash },
      { $set: { lastUsedAt: expect.any(Number) } },
    );
    expect(next).toHaveBeenCalled();
  });
});
