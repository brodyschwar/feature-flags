import { app } from './app.js';
import { connectToMongo } from './db/client.js';

const PORT = process.env.PORT ?? 3001;
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/feature_flags';

async function start() {
  await connectToMongo(MONGO_URI);
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
