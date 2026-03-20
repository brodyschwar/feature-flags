import { app } from "./app.js";
import { connectToMongo } from "./db/client.js";
import { flags } from "./flags.js";

const PORT = process.env.PORT ?? "3002";
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/demo_app";

async function start() {
  await connectToMongo(MONGO_URI);
  await flags.warm().catch((err: unknown) => {
    console.warn("[flags] Cache warm-up failed, will retry on first request:", err);
  });
  const server = app.listen(Number(PORT), () => {
    console.log(`Demo API listening on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    flags.disconnect();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

start().catch(console.error);
