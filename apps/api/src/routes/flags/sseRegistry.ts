import type { Response } from 'express';
import type { FlagDefinition } from '@feature-flags/flag-evaluation';

interface SseClient {
  res: Response;
  /** Flag keys this client subscribed to. Empty = subscribe to all flags. */
  keys: Set<string>;
}

const clients = new Set<SseClient>();

export function registerClient(res: Response, keys: string[]): SseClient {
  const client: SseClient = { res, keys: new Set(keys) };
  clients.add(client);
  return client;
}

export function removeClient(client: SseClient): void {
  clients.delete(client);
}

function isSubscribed(client: SseClient, key: string): boolean {
  return client.keys.size === 0 || client.keys.has(key);
}

function writeToClient(client: SseClient, payload: string): void {
  try {
    client.res.write(payload);
  } catch {
    // The TCP connection was dropped without a clean close event.
    // Remove the stale client so future notifications don't attempt the write again.
    clients.delete(client);
  }
}

export function notifyFlagUpdated(definition: FlagDefinition): void {
  const payload = `event: flag_updated\ndata: ${JSON.stringify(definition)}\n\n`;
  for (const client of clients) {
    if (isSubscribed(client, definition.key)) {
      writeToClient(client, payload);
    }
  }
}

export function notifyFlagDeleted(key: string): void {
  const payload = `event: flag_deleted\ndata: ${JSON.stringify({ key })}\n\n`;
  for (const client of clients) {
    if (isSubscribed(client, key)) {
      writeToClient(client, payload);
    }
  }
}

/** Returns the number of currently registered clients. Exposed for tests. */
export function getClientCount(): number {
  return clients.size;
}

/** Removes all registered clients. Use in tests only. */
export function clearAllClients(): void {
  clients.clear();
}
