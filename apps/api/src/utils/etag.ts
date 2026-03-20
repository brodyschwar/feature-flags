import { createHash } from 'crypto';

/**
 * Compute a deterministic ETag from a serialisable payload.
 * Returns a quoted string as required by the HTTP spec (RFC 9110 §8.8.3).
 */
export function computeEtag(payload: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `"${hash}"`;
}
