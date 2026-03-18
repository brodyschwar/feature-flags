import type { Collection } from 'mongodb';
import { getDb } from './client.js';
import type { Flag } from '../schemas/flag.schema.js';
import type { ApiKey } from '../schemas/apiKey.schema.js';

// Flags are stored with _id = UUID (no separate id field)
export type FlagDoc = Omit<Flag, 'id'> & { _id: string };

export function getFlagsCollection(): Collection<FlagDoc> {
  return getDb().collection<FlagDoc>('flags');
}

export function getApiKeysCollection(): Collection<ApiKey> {
  return getDb().collection<ApiKey>('api_keys');
}

export function docToFlag(doc: FlagDoc): Flag {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id } as Flag;
}
