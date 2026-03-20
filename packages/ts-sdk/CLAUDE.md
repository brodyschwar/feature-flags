# CLAUDE.md — TypeScript SDK (`packages/ts-sdk`)

## Overview

A lightweight TypeScript SDK for evaluating feature flags against the feature flags API. Designed for Node.js services and server-side applications. Authenticates via an `ff_` API key, not a Clerk JWT.

The SDK has two main entry points:

- **`FeatureFlagClient`** — thin HTTP wrapper around the flag evaluation and definition endpoints.
- **`CachedFlagEvaluator`** — stateful wrapper that caches flag definitions locally and evaluates them without a per-call network round-trip. Supports TTL-based polling and optional live updates via SSE.

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript | Type safety for consumers; matches monorepo convention |
| Runtime | Node.js | Primary target; browser support is out of scope |
| HTTP | `fetch` (native) | No extra dependencies; available in Node 18+ |
| Bundler | `tsup` | Zero-config dual CJS/ESM output |
| Test runner | Vitest | Consistent with `apps/api` |

---

## Project Structure

```
packages/ts-sdk/
├── src/
│   ├── index.ts              # Public API — re-exports all classes and types
│   ├── client.ts             # FeatureFlagClient class
│   ├── cached-evaluator.ts   # CachedFlagEvaluator class
│   └── types.ts              # Shared TypeScript types
│
├── tests/
│   ├── client.test.ts
│   ├── cached-evaluator.test.ts
│   └── cached-evaluator-live.test.ts
│
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

The SDK depends on `@feature-flags/flag-evaluation` (a sibling monorepo package) for the shared `FlagDefinition` types and the pure evaluation logic used by `CachedFlagEvaluator`.

---

## `FeatureFlagClient`

The HTTP client. Initialized once with a base URL and API key, then reused across calls.

```ts
import { FeatureFlagClient } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: "https://your-api-host.com",
  apiKey: "ff_...",
});
```

### Constructor options

```ts
interface FeatureFlagClientOptions {
  /** Base URL of the feature flags API, no trailing slash. */
  baseUrl: string;
  /** ff_ prefixed API key. Used in the Authorization header on every request. */
  apiKey: string;
}
```

### `client.evaluate(flagKey, context?)`

Calls `POST /flags/:key/evaluate` and returns the boolean result.

```ts
const result: boolean = await client.evaluate("new-transaction-flow", {
  userId: "user_123",
  attributes: { plan: "pro" },
});
```

Throws `FeatureFlagError` on non-2xx responses or network failures.

### `client.safeEvaluate(flagKey, defaultValue, context?)`

Same as `evaluate()` but returns `defaultValue` instead of throwing. Use in route handlers where a flag outage should degrade gracefully.

### `client.getDefinitions(opts?)`

Fetches `GET /flags/definitions`. Returns evaluation-only flag payloads — no metadata.

```ts
getDefinitions(opts?: {
  type?: "boolean" | "percentage" | "user_segmented";
  keys?: string[];
  ifNoneMatch?: string;
}): Promise<{ flags: FlagDefinition[]; etag: string } | null>
```

- Returns `{ flags, etag }` on `200 OK`.
- Returns `null` on `304 Not Modified` — the caller's existing data is still current.
- Throws `FeatureFlagError` on other non-2xx responses.

Sends `If-None-Match: <etag>` when `ifNoneMatch` is provided, enabling conditional requests. The ETag is computed over `{ key, type, rules }` only — metadata changes do not bust the cache.

### `client.getDefinition(flagKey, opts?)`

Fetches `GET /flags/:key/definition` for a single flag. Same `null`-on-304 / throw-on-error contract as `getDefinitions`.

### `client.streamDefinitions(opts?)`

Opens an SSE connection to `GET /flags/stream` and returns an `AsyncGenerator` of parsed events.

```ts
streamDefinitions(opts?: {
  keys?: string[];
  signal?: AbortSignal;
}): AsyncGenerator<FlagStreamEvent>
```

- Throws `FeatureFlagError` if the initial connection is rejected (non-2xx).
- Silently ends the generator when `signal` is aborted.
- Uses `fetch()` with `ReadableStream` to parse the SSE wire format — no `EventSource` dependency, compatible with Node.js 18+.

Most callers should use `CachedFlagEvaluator` with `liveUpdates: true` instead of calling this directly.

---

## `CachedFlagEvaluator`

A stateful wrapper that owns a local cache of flag definitions. Evaluates flags locally using the same logic as the API (via `@feature-flags/flag-evaluation`), so there is no per-evaluation network call once the cache is warm.

`CachedFlagEvaluator` is generic on `T extends string` — the union of flag keys the service uses. TypeScript infers `T` automatically from the `flags` array when `as const` is used.

### Constructor

```ts
interface CachedFlagEvaluatorOptions<T extends string> {
  /** The HTTP client used to fetch definitions. */
  client: FeatureFlagClient;
  /**
   * The flag keys this service uses.
   * - Runtime: sent as ?keys=... on GET /flags/definitions.
   * - Compile time: with `as const`, constrains evaluate() to only accept these keys.
   */
  flags: readonly T[];
  /** How long (ms) cached definitions are fresh. Default: 30_000. */
  ttl?: number;
  /**
   * When true, serve the stale cached value while a background refresh runs.
   * When false (default), block until the refresh completes.
   */
  staleWhileRevalidate?: boolean;
  /**
   * When true, open a persistent SSE connection to GET /flags/stream and
   * update the cache immediately on flag changes. TTL polling continues as a backstop.
   * Default: false.
   */
  liveUpdates?: boolean;
}
```

### `evaluator.evaluate(flagKey, context?)`

Evaluates a flag locally using the cached definition. `flagKey` is constrained to the union `T` — passing an unknown key is a compile-time error.

- **Cold cache:** awaits a cache refresh before evaluating.
- **Stale cache (default):** awaits a refresh before evaluating.
- **Stale cache + `staleWhileRevalidate`:** returns the cached value immediately; triggers a background refresh.
- **Cache miss after bulk refresh:** falls back to `getDefinition(key)`. Throws `FeatureFlagError` if the flag cannot be found.

### `evaluator.safeEvaluate(flagKey, defaultValue, context?)`

Same as `evaluate()` but returns `defaultValue` instead of throwing.

### `evaluator.warm()`

Pre-populates the cache by fetching definitions for the configured keys. Call once at startup to avoid cold-start latency on the first `evaluate()`. When `liveUpdates: true`, also calls `connect()` after the cache is populated.

### `evaluator.refresh()`

Forces an immediate cache refresh bypassing the TTL. Single-flight: concurrent calls share the same in-flight request rather than issuing multiple.

### `evaluator.connect()`

Opens the SSE connection for live updates. Idempotent — a no-op when already connected or in a reconnect cycle. Only relevant when `liveUpdates: true`; `warm()` calls this automatically in that case.

### `evaluator.disconnect()`

Closes the SSE connection and cancels any pending reconnect timer. The cache is preserved; the evaluator falls back to TTL polling. Safe to call when not connected.

---

## SSE Live Updates

When `liveUpdates: true`, the evaluator keeps a persistent connection to `GET /flags/stream` and applies events directly to the cache:

| Event | Behaviour |
|---|---|
| `flag_updated` | Writes the new `FlagDefinition` into the cache; resets `fetchedAt`. |
| `flag_deleted` | Removes the flag from the cache. The next `evaluate()` falls back to `getDefinition()`. |
| `heartbeat` | No-op — connection keep-alive only. |

TTL polling continues to run as a backstop regardless of SSE state.

### Reconnection

On any connection failure (initial or mid-stream):

1. The cache is **not** cleared — `evaluate()` continues serving cached values.
2. A reconnect is scheduled with exponential backoff: `1s → 2s → 4s → 8s → 16s → 30s → 30s → ...`
3. On reconnect: `refresh()` is called first to fill any gap, then the stream resumes and the backoff resets to 1s.
4. `disconnect()` cancels any pending reconnect timer. Calling `connect()` afterwards restarts with a fresh backoff.

### Known limitations

- **Multi-instance API deployments:** the API's subscriber registry is in-process. In a load-balanced deployment, only clients connected to the instance that processed the update receive the SSE event. TTL polling is the only mechanism that guarantees eventual consistency across all instances.
- **No `Last-Event-ID` replay:** the server does not buffer past events. The reconnect `refresh()` is the sole gap-recovery mechanism.
- **One connection per evaluator instance:** each `CachedFlagEvaluator` with `liveUpdates: true` holds one persistent HTTP connection.

---

## Error Handling

- Non-2xx HTTP responses → `FeatureFlagError` with `status` set to the HTTP status code and `message` from the response body if parseable.
- Network failures → `FeatureFlagError` with `status` undefined.
- The SDK does **not** swallow errors silently — callers decide how to handle failures (e.g., fall back to `false`, or use `safeEvaluate`).

```ts
class FeatureFlagError extends Error {
  /** HTTP status code, or undefined for network errors. */
  status?: number;
}
```

---

## Types

```ts
interface EvaluationContext {
  /** Required for percentage flags. Ignored by boolean flags. */
  userId?: string;
  /** Arbitrary key-value pairs for user_segmented flags. */
  attributes?: Record<string, string>;
}

type FlagStreamEvent =
  | { type: "flag_updated"; definition: FlagDefinition }
  | { type: "flag_deleted"; key: string }
  | { type: "heartbeat" };
```

`FlagDefinition` is exported from `@feature-flags/flag-evaluation`.

---

## Usage Examples

### Direct HTTP evaluation

```ts
const client = new FeatureFlagClient({
  baseUrl: process.env.FLAGS_API_URL!,
  apiKey: process.env.FLAGS_API_KEY!,
});

const enabled = await client.evaluate("new-transaction-flow", {
  userId: session.userId,
  attributes: { plan: session.plan },
});
```

### Cached local evaluation (recommended for high-traffic services)

```ts
// lib/flags.ts — module-level singleton
const client = new FeatureFlagClient({
  baseUrl: process.env.FLAGS_API_URL!,
  apiKey: process.env.FLAGS_API_KEY!,
});

export const flags = new CachedFlagEvaluator({
  client,
  flags: ["new-transaction-flow", "pro-number-range"] as const,
  ttl: 30_000,
});
```

```ts
// In a Server Component or Route Handler
import { flags } from "@/lib/flags";

export default async function Page() {
  const showNewFlow = await flags.evaluate("new-transaction-flow", {
    userId: session.userId,
    attributes: { plan: session.plan },
  });
}
```

Create the evaluator once at the module level and reuse it. Creating a new instance per request defeats the cache. If cold-start latency matters, call `warm()` in a startup hook (e.g., `instrumentation.ts` in Next.js).

### With live updates

```ts
export const flags = new CachedFlagEvaluator({
  client,
  flags: ["new-transaction-flow", "kill-switch"] as const,
  ttl: 300_000,   // 5-minute backstop
  liveUpdates: true,
});

// warm() populates the cache, then automatically calls connect()
await flags.warm();

// On graceful shutdown
flags.disconnect();
```

---

## Testing

All tests are unit tests — no real HTTP calls.

- **`tests/client.test.ts`** — mocks `global.fetch` to test all `FeatureFlagClient` methods including `streamDefinitions` (uses `ReadableStream` to simulate SSE chunks).
- **`tests/cached-evaluator.test.ts`** — mocks `FeatureFlagClient` directly to test TTL logic, single-flight coalescing, stale-while-revalidate, and cache miss fallback.
- **`tests/cached-evaluator-live.test.ts`** — mocks `FeatureFlagClient` with a controllable async iterable to test SSE event handling, reconnection, and exponential backoff. Uses `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` to control reconnect delays.
