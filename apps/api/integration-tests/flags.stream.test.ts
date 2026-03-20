import { createServer, get as httpGet, type Server } from 'node:http';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { getFlagsCollection } from '../src/db/collections.js';
import { clearAllClients, getClientCount } from '../src/routes/flags/sseRegistry.js';
import '../../test/mongoSetup.js';

vi.mock('../../middleware/requireJwtOrApiKey.js', () => ({
  requireJwtOrApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../middleware/requireJwt.js', () => ({
  requireJwt: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Real HTTP server ──────────────────────────────────────────────
//
// supertest's in-process mode doesn't support long-lived SSE connections.
// We start a real TCP server so the SSE client can hold an open connection
// while mutations are triggered via supertest (in-process). Both paths share
// the same module instances, so the SSE registry is shared between them.

let server: Server;
let baseUrl: string;

beforeAll(() => new Promise<void>(resolve => {
  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${(server.address() as { port: number }).port}`;
    resolve();
  });
}));

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

afterEach(() => clearAllClients());

// ── Helpers ───────────────────────────────────────────────────────

interface SseStream {
  headers: Record<string, string>;
  buffer: string;
  close: () => void;
}

function openSseStream(path: string): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    const stream: SseStream = { headers: {}, buffer: '', close: () => {} };
    const req = httpGet(`${baseUrl}${path}`, res => {
      stream.headers = res.headers as Record<string, string>;
      stream.close = () => req.destroy();
      res.on('data', (chunk: Buffer) => { stream.buffer += chunk.toString(); });
      resolve(stream);
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ECONNRESET') reject(err);
    });
  });
}

/** Poll until `fn()` returns true or the timeout (ms) is exceeded. */
function waitFor(fn: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() > deadline) return reject(new Error('Timeout waiting for condition'));
      setTimeout(check, 20);
    };
    check();
  });
}

// ── Seed helpers ──────────────────────────────────────────────────

const boolFlagDoc = {
  _id: 'id-bool',
  key: 'bool-flag',
  name: 'Boolean Flag',
  description: '',
  type: 'boolean' as const,
  rules: { enabled: true },
  createdAt: 1000,
  updatedAt: 2000,
};

async function insert(doc: unknown) {
  await getFlagsCollection().insertOne(doc as never);
}

// ── Tests ─────────────────────────────────────────────────────────

describe('GET /flags/stream — response setup', () => {
  it('responds with text/event-stream content type', async () => {
    const stream = await openSseStream('/flags/stream');
    expect(stream.headers['content-type']).toContain('text/event-stream');
    stream.close();
  });

  it('responds with cache-control: no-cache', async () => {
    const stream = await openSseStream('/flags/stream');
    expect(stream.headers['cache-control']).toBe('no-cache');
    stream.close();
  });

  it('sends a connected event immediately on connection', async () => {
    const stream = await openSseStream('/flags/stream');
    await waitFor(() => stream.buffer.includes('event: connected'));
    expect(stream.buffer).toContain('event: connected');
    stream.close();
  });

  it('connected event data contains empty subscribedKeys when no ?keys= given', async () => {
    const stream = await openSseStream('/flags/stream');
    await waitFor(() => stream.buffer.includes('event: connected'));
    const dataLine = stream.buffer.split('\n').find(l => l.startsWith('data:'))!;
    expect(JSON.parse(dataLine.slice('data: '.length))).toEqual({ subscribedKeys: [] });
    stream.close();
  });

  it('connected event data reflects ?keys= subscription', async () => {
    const stream = await openSseStream('/flags/stream?keys=flag-a,flag-b');
    await waitFor(() => stream.buffer.includes('event: connected'));
    const dataLine = stream.buffer.split('\n').find(l => l.startsWith('data:'))!;
    expect(JSON.parse(dataLine.slice('data: '.length))).toEqual({
      subscribedKeys: ['flag-a', 'flag-b'],
    });
    stream.close();
  });

  it('registers the client in the SSE registry', async () => {
    const stream = await openSseStream('/flags/stream');
    await waitFor(() => stream.buffer.includes('event: connected'));
    expect(getClientCount()).toBe(1);
    stream.close();
  });

  it('removes the client from the registry when the connection closes', async () => {
    const stream = await openSseStream('/flags/stream');
    await waitFor(() => stream.buffer.includes('event: connected'));
    expect(getClientCount()).toBe(1);
    stream.close();
    await waitFor(() => getClientCount() === 0);
    expect(getClientCount()).toBe(0);
  });
});

describe('GET /flags/stream — flag mutation events', () => {
  it('sends flag_updated when a flag is PATCHed', async () => {
    await insert(boolFlagDoc);
    const stream = await openSseStream('/flags/stream');
    await waitFor(() => stream.buffer.includes('event: connected'));

    await request(app)
      .patch('/flags/bool-flag')
      .send({ rules: { enabled: false } });

    await waitFor(() => stream.buffer.includes('event: flag_updated'));
    expect(stream.buffer).toContain('"key":"bool-flag"');
    expect(stream.buffer).toContain('"enabled":false');
    stream.close();
  });

  it('sends flag_updated when a flag is created via POST', async () => {
    const stream = await openSseStream('/flags/stream');
    await waitFor(() => stream.buffer.includes('event: connected'));

    await request(app).post('/flags').send({
      key: 'new-flag',
      name: 'New Flag',
      description: '',
      type: 'boolean',
      rules: { enabled: true },
    });

    await waitFor(() => stream.buffer.includes('event: flag_updated'));
    expect(stream.buffer).toContain('"key":"new-flag"');
    stream.close();
  });

  it('sends flag_deleted when a flag is DELETEd', async () => {
    await insert(boolFlagDoc);
    const stream = await openSseStream('/flags/stream');
    await waitFor(() => stream.buffer.includes('event: connected'));

    await request(app).delete('/flags/bool-flag');

    await waitFor(() => stream.buffer.includes('event: flag_deleted'));
    expect(stream.buffer).toContain('"key":"bool-flag"');
    stream.close();
  });

  it('does not send an event to a client subscribed to a different key', async () => {
    await insert(boolFlagDoc);
    const stream = await openSseStream('/flags/stream?keys=other-flag');
    await waitFor(() => stream.buffer.includes('event: connected'));

    const bufferBefore = stream.buffer;
    await request(app)
      .patch('/flags/bool-flag')
      .send({ rules: { enabled: false } });

    // Give it time to deliver if it was going to
    await new Promise(r => setTimeout(r, 100));
    expect(stream.buffer).toBe(bufferBefore);
    stream.close();
  });

  it('sends the event to all connected clients subscribed to the updated key', async () => {
    await insert(boolFlagDoc);
    const stream1 = await openSseStream('/flags/stream?keys=bool-flag');
    const stream2 = await openSseStream('/flags/stream?keys=bool-flag');
    await waitFor(() => stream1.buffer.includes('event: connected'));
    await waitFor(() => stream2.buffer.includes('event: connected'));

    await request(app)
      .patch('/flags/bool-flag')
      .send({ rules: { enabled: false } });

    await waitFor(() => stream1.buffer.includes('event: flag_updated'));
    await waitFor(() => stream2.buffer.includes('event: flag_updated'));
    stream1.close();
    stream2.close();
  });
});
