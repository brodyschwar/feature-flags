# CLAUDE.md — TypeScript SDK (`packages/ts-sdk`)

## Overview

A lightweight TypeScript SDK for evaluating feature flags against the feature flags API. Designed to be consumed by Node.js services and server-side applications. The SDK is the primary machine caller for the evaluate endpoint — it authenticates via an `ff_` API key, not a Clerk JWT.

v1 covers **server-side evaluation only** — a thin HTTP wrapper around `POST /flags/:key/evaluate`. v2 adds client-side evaluation with a local cache backed by the flag definition endpoints.

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript | Type safety for consumers; matches monorepo convention |
| Runtime | Node.js | Primary target; browser support is out of scope for v1 |
| HTTP | `fetch` (native) | No extra dependencies; available in Node 18+ |
| Bundler | `tsup` | Zero-config dual CJS/ESM output |
| Test runner | Vitest | Consistent with `apps/api` |

---

## Project Structure

```
products/ts-sdk/
├── src/
│   ├── index.ts              # Public API — re-exports FeatureFlagClient and types
│   ├── client.ts             # FeatureFlagClient class
│   └── types.ts              # Shared TypeScript types
│
├── tests/
│   └── client.test.ts        # Unit tests for FeatureFlagClient
│
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

---

## Public API

### `FeatureFlagClient`

The single entry point for all SDK consumers. Initialized once with a base URL and API key, then reused across calls.

```ts
import { FeatureFlagClient } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: "https://your-api-host.com",
  apiKey: "ff_...",
});
```

#### Constructor options

```ts
interface FeatureFlagClientOptions {
  /** Base URL of the feature flags API, no trailing slash. */
  baseUrl: string;
  /** ff_ prefixed API key. Used in the Authorization header on every request. */
  apiKey: string;
}
```

#### `client.evaluate(flagKey, context?)`

Evaluates a single flag and returns its boolean result.

```ts
const result: boolean = await client.evaluate("new-transaction-flow", {
  userId: "user_123",
  attributes: { plan: "pro", email: "user@example.com" },
});
```

Signature:

```ts
evaluate(
  flagKey: string,
  context?: EvaluationContext
): Promise<boolean>
```

Throws `FeatureFlagError` if the API returns a non-2xx response or the network request fails.

#### Types

```ts
interface EvaluationContext {
  /** Required for percentage flags. Ignored by boolean flags. */
  userId?: string;
  /** Arbitrary key-value pairs for user_segmented flags. */
  attributes?: Record<string, string>;
}

class FeatureFlagError extends Error {
  /** HTTP status code, or undefined for network errors. */
  status?: number;
}
```

---

## API Interaction

The SDK calls a single endpoint:

```
POST /flags/:key/evaluate
Authorization: Bearer ff_<apiKey>
Content-Type: application/json

{ "context": { "userId": "...", "attributes": { ... } } }
```

Response:

```json
{ "key": "my-flag", "result": true }
```

The SDK returns `result` directly. See `apps/api/CLAUDE.md` for full evaluation semantics per flag type.

---

## Error Handling

- Non-2xx HTTP responses → throw `FeatureFlagError` with `status` set to the HTTP status code and `message` from the response body if parseable, otherwise a generic message.
- Network failures (DNS, timeout, etc.) → throw `FeatureFlagError` with `status` undefined.
- The SDK does **not** swallow errors or return default values silently — callers decide how to handle failures (e.g., fall back to `false`).

---

## What Is Out of Scope

| Feature | Notes |
|---|---|
| Batching multiple evaluations | Not planned |
| Flag CRUD (create/update/delete) | Admin dashboard responsibility, not SDK |
| Browser support | Node.js only; CORS and bundle size not considered yet |
| Streaming / SSE | Planned — real-time flag update notifications for SDK consumers (see Future Development) |

---

## Testing

Unit tests only in v1. No real HTTP calls — use `vi.mock` or intercept `fetch` with a test double.

```ts
// tests/client.test.ts
import { FeatureFlagClient } from "../src/client";

it("evaluate returns true when API responds with result: true", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ key: "my-flag", result: true }),
  });

  const client = new FeatureFlagClient({ baseUrl: "http://localhost:3001", apiKey: "ff_test" });
  expect(await client.evaluate("my-flag")).toBe(true);
});
```

All test files live in `../tests/` at the SDK package root. Imports reference source via `../src/`.

---

---

## v2: Cached Client-Side Evaluation

### Motivation

v1 makes one HTTP call per `evaluate()` call. This works fine for low-traffic services, but has two problems at scale:

1. **Latency** — every flag check adds a network round-trip.
2. **Load** — a high-traffic service hitting `evaluate` 10k times/second hammers the API unnecessarily. Flag definitions change rarely; there is no reason to re-fetch them on every check.

The fix is to fetch flag definitions once, cache them locally, and evaluate using the exact same logic the server uses. The cache is kept fresh via TTL-based polling with ETag-based conditional requests — most refreshes cost only a round-trip with no body transfer.

---

### Shared Evaluation Library

**Correctness risk:** if the SDK's evaluation logic diverges from the API's even slightly, a flag could evaluate to `true` server-side but `false` in the SDK. For a cached evaluator this would be a silent bug — no error is thrown, the wrong value is silently returned.

The fix is to share a single evaluation implementation that both `apps/api` and `products/ts-sdk` depend on.

#### New monorepo package: `packages/flag-evaluation`

```
packages/flag-evaluation/
├── src/
│   ├── index.ts          # Public exports
│   ├── evaluate.ts       # evaluate(definition, context) — pure, no I/O
│   └── types.ts          # FlagDefinition, EvaluationContext, operator types
├── package.json          # name: @feature-flags/flag-evaluation
└── tsconfig.json
```

`pnpm-workspace.yaml` must include `packages/*`.

**Exports:**

```ts
// Pure evaluation function — identical logic for server and client
export function evaluate(definition: FlagDefinition, context?: EvaluationContext): boolean;

// Types consumed by both API and SDK
export type { FlagDefinition, EvaluationContext, BooleanRules, PercentageRules, UserSegmentedRules };
```

**Dependency graph after migration:**

```
packages/flag-evaluation   ← pure logic, no runtime deps
         ↑           ↑
  apps/api      products/ts-sdk
```

`apps/api` replaces its `src/evaluation/evaluate.ts` with an import from the shared package. The API's existing test suite still covers the evaluation logic; the shared package itself gets its own unit tests.

**Important:** The percentage hash uses Node's `crypto.createHash('sha256')` — this is fine since the SDK targets Node.js only (v1 scope). If browser support is added later, the hash implementation must switch to `SubtleCrypto` or a pure-JS SHA-256.

---

### `FeatureFlagClient` additions

`FeatureFlagClient` gains two new methods that fetch the evaluation-only flag payloads introduced in `apps/api` v2. These are pure HTTP methods — no caching, no state. `CachedFlagEvaluator` builds on top of them.

#### `client.getDefinitions(opts?)`

Fetches `GET /flags/definitions`. Handles the ETag/304 exchange so callers don't have to.

```ts
getDefinitions(opts?: {
  /** Filters by flag type. */
  type?: "boolean" | "percentage" | "user_segmented";
  /** ETag from a previous response. Triggers a conditional request. */
  ifNoneMatch?: string;
}): Promise<{ flags: FlagDefinition[]; etag: string } | null>
```

- Returns `{ flags, etag }` on `200 OK`.
- Returns `null` on `304 Not Modified` — the caller's existing data is still current.
- Throws `FeatureFlagError` on non-2xx responses (other than 304).

#### `client.getDefinition(flagKey, opts?)`

Fetches `GET /flags/:key/definition` for a single flag.

```ts
getDefinition(
  flagKey: string,
  opts?: { ifNoneMatch?: string }
): Promise<{ flag: FlagDefinition; etag: string } | null>
```

Same `null`-on-304, throw-on-error contract as `getDefinitions`.

#### Updated `FeatureFlagClientOptions`

No changes to the constructor — `baseUrl` and `apiKey` are sufficient.

---

### `CachedFlagEvaluator`

A stateful wrapper that owns the local cache. It takes a `FeatureFlagClient` as a constructor dependency so it can be unit-tested without real HTTP calls.

#### Constructor

```ts
interface CachedFlagEvaluatorOptions {
  /** The HTTP client used to fetch definitions. */
  client: FeatureFlagClient;
  /**
   * How long (ms) cached definitions are considered fresh before a refresh
   * is triggered. Default: 30_000 (30 seconds).
   */
  ttl?: number;
  /**
   * When true, serve the last-known cached value while a refresh runs in
   * the background. Callers get a result immediately but may briefly receive
   * a stale value.
   *
   * When false (default), callers await the refresh before receiving a result.
   * This guarantees freshness at the cost of one extra round-trip on TTL expiry.
   *
   * Use true for latency-sensitive paths where a brief stale window is
   * acceptable. Use false (default) when evaluation accuracy is critical.
   */
  staleWhileRevalidate?: boolean;
}

class CachedFlagEvaluator {
  constructor(options: CachedFlagEvaluatorOptions);
}
```

#### Public methods

```ts
/**
 * Evaluate a flag locally using the cached definition.
 *
 * If the cache is cold or the TTL has expired:
 *   - staleWhileRevalidate=false (default): awaits a cache refresh first.
 *   - staleWhileRevalidate=true: returns the stale cached value immediately
 *     and triggers a background refresh for subsequent calls.
 *
 * If the flag key is not found after a bulk refresh, falls back to
 * getDefinition(key) to handle flags created since the last bulk fetch.
 *
 * Throws FeatureFlagError if the flag cannot be found after both attempts.
 */
evaluate(flagKey: string, context?: EvaluationContext): Promise<boolean>;

/**
 * Pre-populate the cache with all flag definitions. Call this once at
 * startup to eliminate cold-start latency on the first evaluate() call.
 */
warm(): Promise<void>;

/**
 * Force an immediate cache refresh, bypassing the TTL.
 * Respects single-flight — if a refresh is already in progress this
 * returns the same Promise rather than issuing a second request.
 */
refresh(): Promise<void>;
```

#### Usage

```ts
import { FeatureFlagClient, CachedFlagEvaluator } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: "https://your-api-host.com",
  apiKey: "ff_...",
});

const evaluator = new CachedFlagEvaluator({
  client,
  ttl: 60_000, // refresh every 60 seconds
});

// Optional: warm the cache at startup to avoid cold-start latency
await evaluator.warm();

// Evaluate locally — no HTTP call if the cache is warm and fresh
const enabled = await evaluator.evaluate("new-transaction-flow", {
  userId: "user_123",
  attributes: { plan: "pro" },
});
```

---

### Single-Flight Coalescing

**The problem:** The `CachedFlagEvaluator` is intended to be a module-level singleton (one instance per process). If the TTL expires while 50 concurrent callers are waiting for an `evaluate()` call, all 50 trigger a cache refresh simultaneously. Without coordination, 50 HTTP requests go to the API for the same data.

**The solution:** A single-flight lock. The first caller to see a stale cache stores the refresh `Promise` on the instance. Every subsequent caller awaits that same `Promise` instead of starting a new request. When the refresh resolves, all callers unblock together.

```ts
// Conceptual implementation inside CachedFlagEvaluator
private inflightRefresh: Promise<void> | null = null;

async refresh(): Promise<void> {
  if (this.inflightRefresh) return this.inflightRefresh;    // Already in flight — share it.
  this.inflightRefresh = this._doRefresh().finally(() => {
    this.inflightRefresh = null;
  });
  return this.inflightRefresh;
}
```

**Is this needed in Next.js?** Yes. Next.js's built-in `fetch()` deduplication (React `cache()`) operates within a single request's render tree, not across concurrent server requests. A single Next.js server handles many requests simultaneously; they all share the same module-level `CachedFlagEvaluator` instance. Single-flight prevents thundering herd when the TTL expires under load.

---

### ETag Integration

`CachedFlagEvaluator` stores the last `etag` returned by `getDefinitions()`. On every TTL-triggered refresh it sends `If-None-Match: <etag>` and:

- **`304 Not Modified`** → `getDefinitions()` returns `null`; the evaluator keeps its current definitions and resets `fetchedAt` to now (the TTL window restarts).
- **`200 OK`** → the evaluator replaces its definitions with the new payload and stores the new `etag`.

This means a periodic refresh costs only a round-trip (no body) when nothing has changed, regardless of how many flags exist. The ETag is computed over `{ key, type, rules }` only — metadata changes (name, description, updatedAt) do not bust the SDK's cache.

---

### Internal State

```ts
// Inside CachedFlagEvaluator
private cache: Map<string, FlagDefinition>;  // key → definition
private etag: string | null;                  // last etag from getDefinitions()
private fetchedAt: number | null;             // Date.now() at last successful refresh
private inflightRefresh: Promise<void> | null; // single-flight lock
```

The `fetchedAt` timestamp drives TTL staleness checks. `etag` is passed on every refresh request.

---

### Next.js Usage Pattern

`CachedFlagEvaluator` should be created **once** at the module level and reused across all requests. Creating a new instance per request defeats the cache.

```ts
// lib/flags.ts — module-level singleton
import { FeatureFlagClient, CachedFlagEvaluator } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: process.env.FLAGS_API_URL!,
  apiKey: process.env.FLAGS_API_KEY!,
});

export const flags = new CachedFlagEvaluator({ client, ttl: 30_000 });
```

```ts
// In a Server Component or Route Handler
import { flags } from "@/lib/flags";

export default async function Page() {
  const showNewFlow = await flags.evaluate("new-transaction-flow", {
    userId: session.userId,
    attributes: { plan: session.plan },
  });
  // ...
}
```

**Note:** Next.js does not call module-level code at startup — `warm()` should be called in a startup hook (e.g., `instrumentation.ts`) if cold-start latency matters.

---

### Updated Project Structure (v2)

```
packages/
└── flag-evaluation/          # NEW — shared evaluation logic
    ├── src/
    │   ├── index.ts
    │   ├── evaluate.ts
    │   └── types.ts
    ├── tests/
    │   └── evaluate.test.ts
    └── package.json

products/ts-sdk/
├── src/
│   ├── index.ts              # Adds CachedFlagEvaluator to exports
│   ├── client.ts             # Adds getDefinition / getDefinitions methods
│   ├── cached-evaluator.ts   # NEW — CachedFlagEvaluator class
│   └── types.ts              # Adds CachedFlagEvaluatorOptions
│
├── tests/
│   ├── client.test.ts
│   └── cached-evaluator.test.ts  # NEW
│
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

---

### Testing Strategy (v2)

All tests remain unit tests — no real HTTP, no real DB.

**`packages/flag-evaluation/tests/evaluate.test.ts`**
Test the pure evaluation logic in isolation. This is the authoritative test suite for evaluation correctness — all flag types, all operators, edge cases.

**`products/ts-sdk/tests/client.test.ts`**
Extend existing tests to cover `getDefinitions` and `getDefinition`:
- Returns `{ flags, etag }` on 200
- Returns `null` on 304
- Throws `FeatureFlagError` on non-2xx

Mock `global.fetch`; assert the correct `If-None-Match` header is sent when `ifNoneMatch` is provided.

**`products/ts-sdk/tests/cached-evaluator.test.ts`**
Mock `FeatureFlagClient` directly (inject a mock instance). Test:

| Scenario | What to verify |
|---|---|
| Cold cache → evaluate() | Calls `getDefinitions()`, evaluates locally |
| Warm cache within TTL | Does NOT call `getDefinitions()` |
| Stale cache (default mode) | Awaits refresh before returning result |
| Stale cache (staleWhileRevalidate) | Returns stale value immediately; refresh called in background |
| 304 Not Modified on refresh | Cache entries unchanged; `fetchedAt` updated |
| 200 on refresh | Cache entries replaced with new definitions |
| Single-flight: concurrent calls on stale cache | `getDefinitions()` called exactly once |
| Cache miss after bulk refresh | Falls back to `getDefinition(key)` |
| `warm()` | Calls `getDefinitions()`, populates all keys |
| `refresh()` while refresh in flight | Returns same Promise; no second HTTP call |

---

## Future Development

### Real-time flag update notifications (SSE)

The goal is to allow SDK consumers to subscribe to flag changes and react without polling. When a flag is updated via the API, connected SDK clients should be notified immediately.

Likely shape:

```ts
const unsubscribe = client.onFlagUpdated("new-transaction-flow", (result) => {
  // re-evaluate or update local state
  console.log("flag changed:", result);
});

// later
unsubscribe();
```

Implementation notes (to be decided during design):
- API would expose a `GET /flags/:key/stream` SSE endpoint; SDK connects and listens for update events.
- `onFlagUpdated` manages the `EventSource` (or `fetch` with a streaming body in Node) and calls the callback with the new evaluated result when an event arrives.
- Connection lifecycle (reconnect on drop, cleanup on unsubscribe) needs to be designed carefully.
- This will require the API to push events — the backend design should be planned alongside the SDK interface.
