import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import './mongoSetup.js';

vi.mock('../src/middleware/requireJwt.js', () => ({
  requireJwt: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe('POST /api-keys', () => {
  it('creates an API key and returns it once with ff_ prefix', async () => {
    const res = await request(app).post('/api-keys').send({ name: 'production' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^ff_/);
    expect(res.body.name).toBe('production');
    expect(res.body.id).toBeTruthy(); // SHA-256 hash
    expect(res.body.createdAt).toBeTypeOf('number');
    // key is 35 chars: "ff_" + 32 base64url chars
    expect(res.body.key).toHaveLength(35);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api-keys').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is empty', async () => {
    const res = await request(app).post('/api-keys').send({ name: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api-keys', () => {
  it('lists all keys with metadata but never returns the key value or hash as key field', async () => {
    await request(app).post('/api-keys').send({ name: 'key-one' });
    await request(app).post('/api-keys').send({ name: 'key-two' });

    const res = await request(app).get('/api-keys');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    for (const k of res.body) {
      expect(k).toHaveProperty('id');
      expect(k).toHaveProperty('name');
      expect(k).toHaveProperty('createdAt');
      expect(k).toHaveProperty('lastUsedAt');
      expect(k).not.toHaveProperty('key'); // plaintext never returned after creation
    }
  });

  it('returns an empty array when no keys exist', async () => {
    const res = await request(app).get('/api-keys');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('DELETE /api-keys/:id', () => {
  it('revokes a key and returns 204', async () => {
    const createRes = await request(app).post('/api-keys').send({ name: 'to-revoke' });
    const { id } = createRes.body as { id: string };

    const deleteRes = await request(app).delete(`/api-keys/${id}`);
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app).get('/api-keys');
    expect(listRes.body).toHaveLength(0);
  });

  it('returns 404 when key does not exist', async () => {
    const res = await request(app).delete('/api-keys/nonexistenthash');
    expect(res.status).toBe(404);
  });
});
