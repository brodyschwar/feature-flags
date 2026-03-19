import express from 'express';
import { flagsRouter } from './routes/flags/flags.router.js';
import { apiKeysRouter } from './routes/apiKeys/apiKeys.router.js';

const app = express();

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/flags', flagsRouter);
app.use('/api-keys', apiKeysRouter);

export { app };
