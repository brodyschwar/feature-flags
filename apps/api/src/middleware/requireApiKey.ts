import { createHash } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getApiKeysCollection } from '../db/collections.js';

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ff_')) {
    res.status(401).json({ error: 'Missing or invalid API key' });
    return;
  }
  const plaintext = authHeader.slice(7); // "Bearer " is 7 chars
  const hash = createHash('sha256').update(plaintext).digest('hex');

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
}
