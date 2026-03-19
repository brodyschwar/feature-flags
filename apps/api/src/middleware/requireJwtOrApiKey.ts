import { createHash } from 'crypto';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { getApiKeysCollection } from '../db/collections.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    const url = process.env.CLERK_JWKS_URL;
    if (!url) throw new Error('CLERK_JWKS_URL environment variable is not set');
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

export async function requireJwtOrApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const credential = authHeader.slice(7);

  // API key path — ff_ prefix
  if (credential.startsWith('ff_')) {
    const hash = createHash('sha256').update(credential).digest('hex');
    const collection = getApiKeysCollection();
    const key = await collection.findOne({ _id: hash } as Parameters<typeof collection.findOne>[0]);
    if (!key) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
    await collection.updateOne(
      { _id: hash } as Parameters<typeof collection.updateOne>[0],
      { $set: { lastUsedAt: Date.now() } },
    );
    next();
    return;
  }

  // JWT path — Clerk token
  try {
    const { payload } = await jwtVerify(credential, getJwks());
    (req as Request & { auth: unknown }).auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
