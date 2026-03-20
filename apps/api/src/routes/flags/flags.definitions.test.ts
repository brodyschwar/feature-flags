import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { getFlagsCollection } from '../../db/collections.js';
import '../../test/mongoSetup.js';

vi.mock('../../middleware/requireJwtOrApiKey.js', () => ({
  requireJwtOrApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Seed helpers ─────────────────────────────────────────────────

const boolFlag = {
  _id: 'id-bool',
  key: 'bool-flag',
  name: 'Boolean Flag',
  description: 'A boolean flag',
  type: 'boolean' as const,
  rules: { enabled: true },
  createdAt: 1000,
  updatedAt: 2000,
};

const pctFlag = {
  _id: 'id-pct',
  key: 'pct-flag',
  name: 'Percentage Flag',
  description: 'A percentage flag',
  type: 'percentage' as const,
  rules: { percentage: 75 },
  createdAt: 1000,
  updatedAt: 2000,
};

const segFlag = {
  _id: 'id-seg',
  key: 'seg-flag',
  name: 'Segmented Flag',
  description: 'A segmented flag',
  type: 'user_segmented' as const,
  rules: {
    segments: [{ attribute: 'plan', operator: 'eq' as const, values: ['pro'], result: true }],
    defaultValue: false,
  },
  createdAt: 1000,
  updatedAt: 2000,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insert(doc: any) {
  await getFlagsCollection().insertOne(doc);
}

// ── GET /flags/definitions ────────────────────────────────────────

describe('GET /flags/definitions', () => {
  it('returns empty flags array when no flags exist', async () => {
    const res = await request(app).get('/flags/definitions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flags: [] });
  });

  it('returns all flags as FlagDefinition objects', async () => {
    await insert(boolFlag);
    await insert(pctFlag);
    const res = await request(app).get('/flags/definitions');
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(2);
  });

  it('excludes metadata fields from each flag', async () => {
    await insert(boolFlag);
    const res = await request(app).get('/flags/definitions');
    const flag = res.body.flags[0];
    expect(flag).not.toHaveProperty('id');
    expect(flag).not.toHaveProperty('name');
    expect(flag).not.toHaveProperty('description');
    expect(flag).not.toHaveProperty('createdAt');
    expect(flag).not.toHaveProperty('updatedAt');
  });

  it('returns correct shape for all three flag types', async () => {
    await insert(boolFlag);
    await insert(pctFlag);
    await insert(segFlag);
    const res = await request(app).get('/flags/definitions');
    const flags: { key: string; type: string; rules: unknown }[] = res.body.flags;

    const bool = flags.find(f => f.key === 'bool-flag')!;
    expect(bool).toEqual({ key: 'bool-flag', type: 'boolean', rules: { enabled: true } });

    const pct = flags.find(f => f.key === 'pct-flag')!;
    expect(pct).toEqual({ key: 'pct-flag', type: 'percentage', rules: { percentage: 75 } });

    const seg = flags.find(f => f.key === 'seg-flag')!;
    expect(seg).toEqual({
      key: 'seg-flag',
      type: 'user_segmented',
      rules: {
        segments: [{ attribute: 'plan', operator: 'eq', values: ['pro'], result: true }],
        defaultValue: false,
      },
    });
  });

  it('returns flags sorted by key', async () => {
    await insert(pctFlag);   // key: 'pct-flag'
    await insert(boolFlag);  // key: 'bool-flag'
    const res = await request(app).get('/flags/definitions');
    const keys = res.body.flags.map((f: { key: string }) => f.key);
    expect(keys).toEqual(['bool-flag', 'pct-flag']);
  });

  it('filters by ?type=boolean', async () => {
    await insert(boolFlag);
    await insert(pctFlag);
    const res = await request(app).get('/flags/definitions?type=boolean');
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].type).toBe('boolean');
  });

  it('filters by ?type=percentage', async () => {
    await insert(boolFlag);
    await insert(pctFlag);
    const res = await request(app).get('/flags/definitions?type=percentage');
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].type).toBe('percentage');
  });

  it('filters by ?type=user_segmented', async () => {
    await insert(boolFlag);
    await insert(segFlag);
    const res = await request(app).get('/flags/definitions?type=user_segmented');
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].type).toBe('user_segmented');
  });

  it('returns an ETag header in quoted-string format', async () => {
    await insert(boolFlag);
    const res = await request(app).get('/flags/definitions');
    expect(res.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('returns 304 Not Modified when If-None-Match matches the ETag', async () => {
    await insert(boolFlag);
    const first = await request(app).get('/flags/definitions');
    const etag = first.headers['etag'];

    const second = await request(app)
      .get('/flags/definitions')
      .set('If-None-Match', etag);
    expect(second.status).toBe(304);
  });

  it('returns 200 with body when If-None-Match does not match', async () => {
    await insert(boolFlag);
    const res = await request(app)
      .get('/flags/definitions')
      .set('If-None-Match', '"stale-etag"');
    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
  });

  it('ETag changes after flag rules are updated', async () => {
    await insert(boolFlag);
    const first = await request(app).get('/flags/definitions');
    const oldEtag = first.headers['etag'];

    await getFlagsCollection().updateOne(
      { key: 'bool-flag' } as Parameters<ReturnType<typeof getFlagsCollection>['updateOne']>[0],
      { $set: { rules: { enabled: false }, updatedAt: Date.now() } },
    );

    const second = await request(app)
      .get('/flags/definitions')
      .set('If-None-Match', oldEtag);
    expect(second.status).toBe(200);
    expect(second.headers['etag']).not.toBe(oldEtag);
  });

  it('ETag does not change when only metadata is updated', async () => {
    await insert(boolFlag);
    const first = await request(app).get('/flags/definitions');
    const oldEtag = first.headers['etag'];

    await getFlagsCollection().updateOne(
      { key: 'bool-flag' } as Parameters<ReturnType<typeof getFlagsCollection>['updateOne']>[0],
      { $set: { name: 'New Name', description: 'New description', updatedAt: Date.now() } },
    );

    const second = await request(app)
      .get('/flags/definitions')
      .set('If-None-Match', oldEtag);
    expect(second.status).toBe(304);
  });
});

// ── GET /flags/:key/definition ────────────────────────────────────

describe('GET /flags/:key/definition', () => {
  it('returns 404 for an unknown flag key', async () => {
    const res = await request(app).get('/flags/unknown-key/definition');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns FlagDefinition for a boolean flag', async () => {
    await insert(boolFlag);
    const res = await request(app).get('/flags/bool-flag/definition');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'bool-flag', type: 'boolean', rules: { enabled: true } });
  });

  it('returns FlagDefinition for a percentage flag', async () => {
    await insert(pctFlag);
    const res = await request(app).get('/flags/pct-flag/definition');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'pct-flag', type: 'percentage', rules: { percentage: 75 } });
  });

  it('returns FlagDefinition for a user_segmented flag', async () => {
    await insert(segFlag);
    const res = await request(app).get('/flags/seg-flag/definition');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      key: 'seg-flag',
      type: 'user_segmented',
      rules: {
        segments: [{ attribute: 'plan', operator: 'eq', values: ['pro'], result: true }],
        defaultValue: false,
      },
    });
  });

  it('excludes metadata fields from the response', async () => {
    await insert(boolFlag);
    const res = await request(app).get('/flags/bool-flag/definition');
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('name');
    expect(res.body).not.toHaveProperty('description');
    expect(res.body).not.toHaveProperty('createdAt');
    expect(res.body).not.toHaveProperty('updatedAt');
  });

  it('returns an ETag header in quoted-string format', async () => {
    await insert(boolFlag);
    const res = await request(app).get('/flags/bool-flag/definition');
    expect(res.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('returns 304 Not Modified when If-None-Match matches the ETag', async () => {
    await insert(boolFlag);
    const first = await request(app).get('/flags/bool-flag/definition');
    const etag = first.headers['etag'];

    const second = await request(app)
      .get('/flags/bool-flag/definition')
      .set('If-None-Match', etag);
    expect(second.status).toBe(304);
  });

  it('returns 200 with body when If-None-Match does not match', async () => {
    await insert(boolFlag);
    const res = await request(app)
      .get('/flags/bool-flag/definition')
      .set('If-None-Match', '"stale-etag"');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('key', 'bool-flag');
  });

  it('ETag changes after rules are updated', async () => {
    await insert(boolFlag);
    const first = await request(app).get('/flags/bool-flag/definition');
    const oldEtag = first.headers['etag'];

    await getFlagsCollection().updateOne(
      { key: 'bool-flag' } as Parameters<ReturnType<typeof getFlagsCollection>['updateOne']>[0],
      { $set: { rules: { enabled: false }, updatedAt: Date.now() } },
    );

    const second = await request(app)
      .get('/flags/bool-flag/definition')
      .set('If-None-Match', oldEtag);
    expect(second.status).toBe(200);
    expect(second.headers['etag']).not.toBe(oldEtag);
  });

  it('ETag does not change when only metadata is updated', async () => {
    await insert(boolFlag);
    const first = await request(app).get('/flags/bool-flag/definition');
    const oldEtag = first.headers['etag'];

    await getFlagsCollection().updateOne(
      { key: 'bool-flag' } as Parameters<ReturnType<typeof getFlagsCollection>['updateOne']>[0],
      { $set: { name: 'New Name', updatedAt: Date.now() } },
    );

    const second = await request(app)
      .get('/flags/bool-flag/definition')
      .set('If-None-Match', oldEtag);
    expect(second.status).toBe(304);
  });

  it('two different flags have different ETags', async () => {
    await insert(boolFlag);
    await insert(pctFlag);
    const boolRes = await request(app).get('/flags/bool-flag/definition');
    const pctRes = await request(app).get('/flags/pct-flag/definition');
    expect(boolRes.headers['etag']).not.toBe(pctRes.headers['etag']);
  });
});
