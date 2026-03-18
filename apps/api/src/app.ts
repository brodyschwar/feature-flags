import express from 'express';
import { flagsRouter } from './routes/flags/flags.router.js';
import { apiKeysRouter } from './routes/apiKeys/apiKeys.router.js';

const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/flags', flagsRouter);
app.use('/api-keys', apiKeysRouter);

export { app };
