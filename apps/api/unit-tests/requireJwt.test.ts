import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockJwtVerify = vi.fn();

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn().mockReturnValue('mock-jwks'),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));

process.env.CLERK_JWKS_URL = 'https://example.clerk.accounts.dev/.well-known/jwks.json';

const { requireJwt } = await import('../src/middleware/requireJwt.js');

function makeReq(authHeader?: string): Request {
  return { headers: authHeader ? { authorization: authHeader } : {} } as Request;
}

function makeRes(): Response {
  const res = {} as Response;
  (res as unknown as Record<string, unknown>).status = vi.fn().mockReturnValue(res);
  (res as unknown as Record<string, unknown>).json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireJwt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireJwt(req, res, next);

    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header does not start with "Bearer "', async () => {
    const req = makeReq('Basic dXNlcjpwYXNz');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireJwt(req, res, next);

    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token verification fails', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('JWTExpired'));

    const req = makeReq('Bearer invalid.jwt.token');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireJwt(req, res, next);

    expect((res as unknown as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches payload to req.auth on valid token', async () => {
    const payload = { sub: 'user_abc123', email: 'test@example.com' };
    mockJwtVerify.mockResolvedValueOnce({ payload });

    const req = makeReq('Bearer valid.jwt.token');
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await requireJwt(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as unknown as { auth: unknown }).auth).toEqual(payload);
  });
});
