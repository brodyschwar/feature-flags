import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import '../../test/mongoSetup.js';

vi.mock('../../middleware/requireJwt.js', () => ({
  requireJwt: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../middleware/requireApiKey.js', () => ({
  requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const booleanFlag = {
  key: 'my-boolean-flag',
  name: 'My Boolean Flag',
  description: 'A test flag',
  type: 'boolean',
  rules: { enabled: true },
};

const percentageFlag = {
  key: 'my-percentage-flag',
  name: 'My Percentage Flag',
  description: '',
  type: 'percentage',
  rules: { percentage: 50 },
};

const segmentedFlag = {
  key: 'my-segmented-flag',
  name: 'My Segmented Flag',
  description: '',
  type: 'user_segmented',
  rules: {
    segments: [{ attribute: 'plan', operator: 'eq', values: ['pro'], result: true }],
    defaultValue: false,
  },
};

describe('POST /flags', () => {
  it('creates a boolean flag and returns 201', async () => {
    const res = await request(app).post('/flags').send(booleanFlag);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: 'my-boolean-flag', type: 'boolean', rules: { enabled: true } });
    expect(res.body.id).toBeTruthy();
    expect(res.body.createdAt).toBeTypeOf('number');
  });

  it('creates a percentage flag and returns 201', async () => {
    const res = await request(app).post('/flags').send(percentageFlag);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'percentage', rules: { percentage: 50 } });
  });

  it('creates a user_segmented flag and returns 201', async () => {
    const res = await request(app).post('/flags').send(segmentedFlag);
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('user_segmented');
  });

  it('returns 400 for invalid body (missing type)', async () => {
    const res = await request(app).post('/flags').send({ key: 'x', name: 'X', description: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rules do not match type', async () => {
    const res = await request(app).post('/flags').send({
      key: 'bad-flag', name: 'Bad', description: '', type: 'boolean', rules: { percentage: 50 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when key already exists', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).post('/flags').send(booleanFlag);
    expect(res.status).toBe(409);
  });
});

describe('GET /flags', () => {
  it('returns all flags', async () => {
    await request(app).post('/flags').send(booleanFlag);
    await request(app).post('/flags').send(percentageFlag);
    const res = await request(app).get('/flags');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('filters by type', async () => {
    await request(app).post('/flags').send(booleanFlag);
    await request(app).post('/flags').send(percentageFlag);
    const res = await request(app).get('/flags?type=boolean');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe('boolean');
  });

  it('returns summary fields only', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).get('/flags');
    const flag = res.body[0];
    expect(flag).toHaveProperty('key');
    expect(flag).toHaveProperty('name');
    expect(flag).toHaveProperty('type');
    expect(flag).toHaveProperty('rules');
    expect(flag).not.toHaveProperty('description');
    expect(flag).not.toHaveProperty('createdAt');
  });
});

describe('GET /flags/:key', () => {
  it('returns the full flag', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).get('/flags/my-boolean-flag');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'my-boolean-flag', type: 'boolean' });
    expect(res.body.createdAt).toBeTypeOf('number');
    expect(res.body.id).toBeTruthy();
  });

  it('returns 404 for a missing flag', async () => {
    const res = await request(app).get('/flags/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /flags/:key', () => {
  it('updates name and description', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).patch('/flags/my-boolean-flag').send({ name: 'Updated Name', description: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.description).toBe('Updated');
  });

  it('updates rules', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).patch('/flags/my-boolean-flag').send({ rules: { enabled: false } });
    expect(res.status).toBe(200);
    expect(res.body.rules.enabled).toBe(false);
  });

  it('rejects rules that do not match the flag type', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).patch('/flags/my-boolean-flag').send({ rules: { percentage: 50 } });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a missing flag', async () => {
    const res = await request(app).patch('/flags/does-not-exist').send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /flags/:key', () => {
  it('deletes a flag and returns 204', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).delete('/flags/my-boolean-flag');
    expect(res.status).toBe(204);
    const getRes = await request(app).get('/flags/my-boolean-flag');
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for a missing flag', async () => {
    const res = await request(app).delete('/flags/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /flags/:key/evaluate', () => {
  it('evaluates a boolean flag', async () => {
    await request(app).post('/flags').send(booleanFlag);
    const res = await request(app).post('/flags/my-boolean-flag/evaluate').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'my-boolean-flag', result: true });
  });

  it('evaluates a percentage flag with userId', async () => {
    await request(app).post('/flags').send(percentageFlag);
    const res = await request(app)
      .post('/flags/my-percentage-flag/evaluate')
      .send({ context: { userId: 'user-123' } });
    expect(res.status).toBe(200);
    expect(typeof res.body.result).toBe('boolean');
  });

  it('evaluates a percentage flag without userId → false', async () => {
    await request(app).post('/flags').send(percentageFlag);
    const res = await request(app).post('/flags/my-percentage-flag/evaluate').send({});
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(false);
  });

  it('evaluates a user_segmented flag', async () => {
    await request(app).post('/flags').send(segmentedFlag);
    const res = await request(app)
      .post('/flags/my-segmented-flag/evaluate')
      .send({ context: { attributes: { plan: 'pro' } } });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(true);
  });

  it('returns 404 for a missing flag', async () => {
    const res = await request(app).post('/flags/does-not-exist/evaluate').send({});
    expect(res.status).toBe(404);
  });
});
