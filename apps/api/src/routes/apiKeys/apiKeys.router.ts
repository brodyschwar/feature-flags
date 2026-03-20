import { Router } from 'express';
import { randomBytes, createHash } from 'crypto';
import { getApiKeysCollection } from '../../db/collections.js';
import { requireJwt } from '../../middleware/requireJwt.js';

export const apiKeysRouter = Router();

// POST /api-keys
apiKeysRouter.post('/', requireJwt, async (req, res) => {
  const { name } = req.body as { name?: unknown };
  if (typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: '`name` is required and must be a non-empty string' });
    return;
  }

  // ff_ prefix + 32 URL-safe base64 characters (24 random bytes)
  const random = randomBytes(24).toString('base64url');
  const plaintext = `ff_${random}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');

  const doc = {
    _id: hash,
    name: name.trim(),
    createdAt: Date.now(),
    lastUsedAt: null,
    deletable: true,
  };

  const collection = getApiKeysCollection();
  await collection.insertOne(doc as Parameters<typeof collection.insertOne>[0]);

  // Return plaintext once — never stored, never retrievable again
  res.status(201).json({ id: hash, name: doc.name, createdAt: doc.createdAt, deletable: true, key: plaintext });
});

// GET /api-keys
apiKeysRouter.get('/', requireJwt, async (_req, res) => {
  const docs = await getApiKeysCollection().find({}).toArray();
  const keys = docs.map(({ _id, name, createdAt, lastUsedAt, deletable }) => ({
    id: _id,
    name,
    createdAt,
    lastUsedAt,
    deletable: deletable ?? true,
  }));
  res.json(keys);
});

// DELETE /api-keys/:id
apiKeysRouter.delete('/:id', requireJwt, async (req, res) => {
  const collection = getApiKeysCollection();
  const doc = await collection.findOne({ _id: req.params.id } as Parameters<typeof collection.findOne>[0]);
  if (!doc) {
    res.status(404).json({ error: 'API key not found' });
    return;
  }
  if (doc.deletable === false) {
    res.status(403).json({ error: 'This API key is protected and cannot be deleted' });
    return;
  }
  await collection.deleteOne({ _id: req.params.id } as Parameters<typeof collection.deleteOne>[0]);
  res.status(204).send();
});
