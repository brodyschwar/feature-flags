import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getFlagsCollection, docToFlag } from '../../db/collections.js';
import { requireJwt } from '../../middleware/requireJwt.js';
import { requireJwtOrApiKey } from '../../middleware/requireJwtOrApiKey.js';
import {
  CreateFlagBodySchema,
  UpdateFlagBodySchema,
  EvaluateBodySchema,
  BooleanRulesSchema,
  PercentageRulesSchema,
  UserSegmentedRulesSchema,
  type Flag,
} from '../../schemas/flag.schema.js';
import { evaluate, type FlagDefinition } from '@feature-flags/flag-evaluation';
import { computeEtag } from '../../utils/etag.js';

export const flagsRouter = Router();

// GET /flags
flagsRouter.get('/', async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (typeof req.query.type === 'string') {
    filter.type = req.query.type;
  }
  const docs = await getFlagsCollection().find(filter).toArray();
  const flags = docs.map(doc => {
    const flag = docToFlag(doc);
    return { id: flag.id, key: flag.key, name: flag.name, type: flag.type, rules: flag.rules, updatedAt: flag.updatedAt };
  });
  res.json(flags);
});

// POST /flags
flagsRouter.post('/', requireJwt, async (req, res) => {
  const result = CreateFlagBodySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues });
    return;
  }
  const body = result.data;
  const id = randomUUID();
  const now = Date.now();
  const doc = { _id: id, ...body, createdAt: now, updatedAt: now };

  try {
    await getFlagsCollection().insertOne(doc as Parameters<ReturnType<typeof getFlagsCollection>['insertOne']>[0]);
    res.status(201).json({ ...body, id, createdAt: now, updatedAt: now });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000) {
      res.status(409).json({ error: 'A flag with this key already exists' });
      return;
    }
    throw err;
  }
});

// GET /flags/definitions — evaluation-only payloads for all flags (no metadata).
// Must be registered before /:key to prevent "definitions" matching as a key parameter.
flagsRouter.get('/definitions', requireJwtOrApiKey, async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (typeof req.query.type === 'string') {
    filter.type = req.query.type;
  }
  // Sort by key for a deterministic ETag regardless of insertion order.
  const docs = await getFlagsCollection().find(filter).sort({ key: 1 }).toArray();
  const flags = docs.map(doc => ({ key: doc.key, type: doc.type, rules: doc.rules })) as FlagDefinition[];

  const etag = computeEtag(flags);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).send();
    return;
  }
  res.setHeader('ETag', etag);
  res.json({ flags });
});

// GET /flags/:key
flagsRouter.get('/:key', async (req, res) => {
  const doc = await getFlagsCollection().findOne({ key: req.params.key } as Parameters<ReturnType<typeof getFlagsCollection>['findOne']>[0]);
  if (!doc) {
    res.status(404).json({ error: 'Flag not found' });
    return;
  }
  res.json(docToFlag(doc));
});

// GET /flags/:key/definition — evaluation-only payload for a single flag.
flagsRouter.get('/:key/definition', requireJwtOrApiKey, async (req, res) => {
  const doc = await getFlagsCollection().findOne({ key: req.params.key } as Parameters<ReturnType<typeof getFlagsCollection>['findOne']>[0]);
  if (!doc) {
    res.status(404).json({ error: 'Flag not found' });
    return;
  }

  const definition = { key: doc.key, type: doc.type, rules: doc.rules } as FlagDefinition;
  const etag = computeEtag(definition);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).send();
    return;
  }
  res.setHeader('ETag', etag);
  res.json(definition);
});

// PATCH /flags/:key
flagsRouter.patch('/:key', requireJwt, async (req, res) => {
  const collection = getFlagsCollection();
  const doc = await collection.findOne({ key: req.params.key } as Parameters<typeof collection.findOne>[0]);
  if (!doc) {
    res.status(404).json({ error: 'Flag not found' });
    return;
  }

  const bodyResult = UpdateFlagBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues });
    return;
  }

  const body = bodyResult.data;
  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;

  if (body.rules !== undefined) {
    const rulesSchemas: Record<Flag['type'], typeof BooleanRulesSchema | typeof PercentageRulesSchema | typeof UserSegmentedRulesSchema> = {
      boolean: BooleanRulesSchema,
      percentage: PercentageRulesSchema,
      user_segmented: UserSegmentedRulesSchema,
    };
    const rulesResult = rulesSchemas[doc.type].safeParse(body.rules);
    if (!rulesResult.success) {
      res.status(400).json({ error: rulesResult.error.issues });
      return;
    }
    updates.rules = rulesResult.data;
  }

  await collection.updateOne({ key: req.params.key } as Parameters<typeof collection.updateOne>[0], { $set: updates });
  const updated = await collection.findOne({ key: req.params.key } as Parameters<typeof collection.findOne>[0]);
  res.json(docToFlag(updated!));
});

// DELETE /flags/:key
flagsRouter.delete('/:key', requireJwt, async (req, res) => {
  const collection = getFlagsCollection();
  const result = await collection.deleteOne({ key: req.params.key } as Parameters<typeof collection.deleteOne>[0]);
  if (result.deletedCount === 0) {
    res.status(404).json({ error: 'Flag not found' });
    return;
  }
  res.status(204).send();
});

// POST /flags/:key/evaluate
flagsRouter.post('/:key/evaluate', requireJwtOrApiKey, async (req, res) => {
  const collection = getFlagsCollection();
  const doc = await collection.findOne({ key: req.params.key } as Parameters<typeof collection.findOne>[0]);
  if (!doc) {
    res.status(404).json({ error: 'Flag not found' });
    return;
  }

  const bodyResult = EvaluateBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    res.status(400).json({ error: bodyResult.error.issues });
    return;
  }

  const flag = docToFlag(doc);
  const evalResult = evaluate(flag, bodyResult.data.context);
  res.json({ key: req.params.key, result: evalResult });
});
