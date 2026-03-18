import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    const url = process.env.CLERK_JWKS_URL;
    if (!url) throw new Error('CLERK_JWKS_URL environment variable is not set');
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

export async function requireJwt(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, getJwks());
    (req as Request & { auth: unknown }).auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
