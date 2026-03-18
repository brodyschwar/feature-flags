import { beforeAll, afterEach, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectToMongo, disconnectFromMongo, clearAllCollections } from '../src/db/client.js';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectToMongo(mongo.getUri());
});

afterEach(async () => {
  await clearAllCollections();
});

afterAll(async () => {
  await disconnectFromMongo();
  await mongo.stop();
});
