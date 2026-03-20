import { MongoMemoryServer } from "mongodb-memory-server";
import { connectToMongo, disconnectFromMongo, clearAllCollections } from "../db/client.js";

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
