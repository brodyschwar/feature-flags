import { MongoClient } from 'mongodb';

let client: MongoClient;

const DB_NAME = process.env.MONGO_DB_NAME ?? 'feature_flags';

export async function connectToMongo(uri: string): Promise<void> {
  client = new MongoClient(uri);
  await client.connect();
  // Ensure unique index on flags.key
  await getDb().collection('flags').createIndex({ key: 1 }, { unique: true });
}

export async function disconnectFromMongo(): Promise<void> {
  await client?.close();
}

export function getDb() {
  return client.db(DB_NAME);
}

export async function clearAllCollections(): Promise<void> {
  const db = getDb();
  const collections = await db.listCollections().toArray();
  await Promise.all(collections.map(c => db.collection(c.name).deleteMany({})));
}
