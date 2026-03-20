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
  /**
   * Return only definitions for the listed flag keys.
   * Sent as `?keys=flag-a,flag-b` on the request.
   * Unknown keys are silently omitted by the server.
   */
  keys?: string[];
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

`CachedFlagEvaluator` is generic on `T extends string`, which is the union of flag keys that a service cares about. TypeScript infers `T` automatically from the `flags` array when `as const` is used — no explicit type annotation needed.

```ts
interface CachedFlagEvaluatorOptions<T extends string> {
  /** The HTTP client used to fetch definitions. */
  client: FeatureFlagClient;
  /**
   * The flag keys this service uses. Serves dual purpose:
   *
   * - **Runtime:** sent as `?keys=...` to `GET /flags/definitions`, so only
   *   relevant flag definitions are fetched and cached.
   * - **Compile time:** with `as const`, TypeScript infers the literal union type `T`
   *   and constrains `evaluate()` to only accept those keys.
   *
   * Pass `as const` to get literal-type inference:
   *   flags: ["flag-a", "flag-b"] as const
   */
  flags: readonly T[];
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

class CachedFlagEvaluator<T extends string> {
  constructor(options: CachedFlagEvaluatorOptions<T>);
}
```

#### Public methods

```ts
/**
 * Evaluate a flag locally using the cached definition.
 *
 * `flagKey` is constrained to the union `T` — passing a key not listed in
 * `flags` is a compile-time error.
 *
 * If the cache is cold or the TTL has expired:
 *   - staleWhileRevalidate=false (default): awaits a cache refresh first.
 *   - staleWhileRevalidate=true: returns the stale cached value immediately
 *     and triggers a background refresh for subsequent calls.
 *
 * If the flag key is not found after a bulk refresh (e.g. the flag was just
 * created), falls back to getDefinition(key) as a safety net.
 *
 * Throws FeatureFlagError if the flag cannot be found after both attempts.
 */
evaluate(flagKey: T, context?: EvaluationContext): Promise<boolean>;

/**
 * Pre-populate the cache with the flag definitions for the configured keys.
 * Call once at startup to eliminate cold-start latency on the first evaluate().
 * Only fetches the flags listed in the `flags` constructor option.
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

// `as const` lets TypeScript infer the literal union type from the array.
// T is inferred as "new-transaction-flow" | "pro-number-range" | "extended-color-palette".
const evaluator = new CachedFlagEvaluator({
  client,
  flags: ["new-transaction-flow", "pro-number-range", "extended-color-palette"] as const,
  ttl: 60_000, // refresh every 60 seconds
});

// Optional: warm the cache at startup to avoid cold-start latency.
// Only fetches the three flags listed above — not the full DB.
await evaluator.warm();

// Evaluate locally — no HTTP call if the cache is warm and fresh.
// Only keys in the `flags` array are accepted — others are compile errors.
const enabled = await evaluator.evaluate("new-transaction-flow", {
  userId: "user_123",
  attributes: { plan: "pro" },
});

// ✗ Compile error — "unknown-flag" is not in the flags array
const bad = await evaluator.evaluate("unknown-flag", context);
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
// Inside CachedFlagEvaluator<T>
private readonly flagKeys: readonly T[];       // keys to fetch — from constructor options
private cache: Map<string, FlagDefinition>;   // key → definition
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
| Cold cache → evaluate() | Calls `getDefinitions({ keys })`, evaluates locally |
| Warm cache within TTL | Does NOT call `getDefinitions()` |
| Stale cache (default mode) | Awaits refresh before returning result |
| Stale cache (staleWhileRevalidate) | Returns stale value immediately; refresh called in background |
| 304 Not Modified on refresh | Cache entries unchanged; `fetchedAt` updated |
| 200 on refresh | Cache entries replaced with new definitions |
| Single-flight: concurrent calls on stale cache | `getDefinitions()` called exactly once |
| Cache miss after bulk refresh | Falls back to `getDefinition(key)` |
| `warm()` | Calls `getDefinitions({ keys })` with the configured keys; populates only those |
| `refresh()` while refresh in flight | Returns same Promise; no second HTTP call |
| `getDefinitions` called with correct `keys` | `?keys=` query param matches the `flags` array passed to the constructor |

---

## v3: Live Flag Updates via SSE

### Motivation

v2's TTL-based polling means a flag change takes up to `ttl` milliseconds to reach a running service. For most workloads this is acceptable, but some use cases need faster propagation — a kill-switch that disables a broken feature should take effect in seconds, not minutes.

v3 adds an opt-in live-update mode to `CachedFlagEvaluator`. When enabled, the evaluator opens a persistent SSE connection to `GET /flags/stream` and updates its cache immediately when the API pushes a `flag_updated` or `flag_deleted` event. TTL polling continues to run as a backstop.

---

### `FeatureFlagClient` additions

#### `client.streamDefinitions(opts?)`

Opens an SSE connection to `GET /flags/stream` and returns an `AsyncIterable` of parsed events. This is a low-level method — most callers should use `CachedFlagEvaluator` with `liveUpdates: true` instead of calling this directly.

```ts
interface FlagStreamEvent =
  | { type: "flag_updated"; definition: FlagDefinition }
  | { type: "flag_deleted"; key: string }
  | { type: "heartbeat" };

streamDefinitions(opts?: {
  /** Scope the subscription to specific flag keys. */
  keys?: string[];
  /** AbortSignal to cancel the stream. */
  signal?: AbortSignal;
}): AsyncIterable<FlagStreamEvent>
```

Throws `FeatureFlagError` if the initial connection is rejected (non-2xx). Silently ends the iterable when the `signal` is aborted.

**Node.js compatibility:** Node.js does not have a native `EventSource` API before v22. The implementation uses `fetch()` with a `ReadableStream` (available in Node 18+) to parse the SSE wire format without adding a runtime dependency.

---

### `CachedFlagEvaluator` additions

#### Updated `CachedFlagEvaluatorOptions<T>`

```ts
interface CachedFlagEvaluatorOptions<T extends string> {
  client: FeatureFlagClient;
  flags: readonly T[];
  ttl?: number;
  staleWhileRevalidate?: boolean;
  /**
   * When true, the evaluator opens a persistent SSE connection to
   * GET /flags/stream and updates its cache immediately on flag changes.
   * TTL polling continues to run as a backstop.
   *
   * Default: false. When false, the evaluator uses TTL polling only.
   */
  liveUpdates?: boolean;
}
```

#### New public methods

```ts
/**
 * Open the SSE connection. Idempotent — calling while already connected
 * is a no-op.
 *
 * When liveUpdates is true, warm() calls this automatically after
 * populating the cache.
 */
connect(): void;

/**
 * Close the SSE connection and cancel any pending reconnect timer.
 * The cache is preserved. The evaluator falls back to TTL polling.
 * Safe to call when not connected.
 */
disconnect(): void;
```

#### Behaviour when `liveUpdates: true`

**On `flag_updated` event:**
The incoming `FlagDefinition` is written directly into the cache and `fetchedAt` is reset to now. No HTTP call is made — the event payload is the authoritative update. The TTL window restarts from this point.

**On `flag_deleted` event:**
The flag is removed from the cache. The next `evaluate()` call for that key falls back to `getDefinition(key)`, which will return 404 and throw `FeatureFlagError`. `safeEvaluate()` will return its `defaultValue`.

**On `heartbeat` event:**
No action. The heartbeat's purpose is connection keep-alive; the SDK ignores it beyond confirming the connection is still live.

**On connection error or drop:**
The cache is **not** cleared. The evaluator continues serving cached values while reconnecting. A reconnect is scheduled with exponential backoff (see below). When the connection is re-established, `refresh()` is called immediately to fill any gap before resuming event-driven updates.

---

### Reconnection strategy

On any connection failure (initial or mid-stream):

1. The current cached values continue to be served — no degradation in evaluate() behavior.
2. A reconnect is scheduled after a delay that doubles on each successive failure, starting at 1 second and capped at 30 seconds: `1s → 2s → 4s → 8s → 16s → 30s → 30s → ...`
3. On reconnect success:
   a. `refresh()` is called first to fill events missed during the gap.
   b. The SSE stream resumes.
   c. The backoff delay is reset to 1 second.
4. `disconnect()` cancels any pending reconnect timer. Calling `connect()` again after a `disconnect()` restarts the process with a fresh backoff.

**No `Last-Event-ID` replay.** The server does not buffer past events. The reconnect `refresh()` (a full `GET /flags/definitions` HTTP call) is the sole gap-recovery mechanism.

#### Internal state additions

```ts
// Inside CachedFlagEvaluator<T>
private liveUpdates: boolean;
private abortController: AbortController | null = null;  // cancels the active stream
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
private reconnectDelay: number = 1_000; // ms; doubles on failure, capped at 30_000
```

---

### TTL as backstop

Even with `liveUpdates: true`, TTL polling continues unchanged. This ensures:

- Changes missed during a disconnect gap are eventually picked up even if the reconnect `refresh()` fails.
- A permanently disconnected evaluator (e.g., `disconnect()` was called) still refreshes its cache periodically.

**Recommended TTL when using live updates:** 5 minutes (`300_000` ms). Live events handle real-time propagation; the TTL is a safety net and fires rarely.

---

### Usage

```ts
const evaluator = new CachedFlagEvaluator({
  client,
  flags: ["new-transaction-flow", "kill-switch"] as const,
  ttl: 300_000,      // 5-minute backstop
  liveUpdates: true, // real-time updates via SSE
});

// warm() populates the cache via HTTP then automatically calls connect()
await evaluator.warm();

// evaluate() now reflects flag changes within milliseconds of the API update
const enabled = await evaluator.evaluate("new-transaction-flow", { userId: "u1" });

// On graceful shutdown — close the SSE connection
evaluator.disconnect();
```

---

### Consistency risks and known limitations

These limitations must be understood before deploying with `liveUpdates: true`.

#### 1. Multi-instance API deployment — critical

**This is the most significant limitation.**

The API's subscriber registry lives in the memory of a single process. In a multi-instance deployment (e.g., two API servers behind a load balancer), a flag update processed by instance A notifies only the SDK clients connected to instance A. Clients connected to instance B receive no event and remain stale until their next TTL poll.

**Impact:** In a load-balanced deployment, live updates provide best-effort propagation to a fraction of connected clients, not all of them. TTL polling is the only mechanism that guarantees eventual consistency across all instances.

**Mitigation (not implemented):** A pub/sub layer (Redis pub/sub, a message broker) would allow any API instance to broadcast to all connected clients. This is out of scope for the current design.

**Acceptable deployments:** Single-instance API servers. Any horizontally-scaled deployment should treat live updates as a latency optimisation, not a correctness guarantee.

#### 2. Missed events during a disconnect gap

Between the moment the SSE connection drops and the moment the reconnect `refresh()` completes, the evaluator's cache may be stale. The TTL will eventually catch this, but there is a window where evaluate() returns an outdated value.

The window length is: `reconnect backoff delay + time for refresh() HTTP call to complete`. In the worst case (multiple successive failures at max backoff), this can be several minutes.

**Mitigation:** The reconnect `refresh()` fills the gap as soon as connectivity is restored. TTL polling ensures correctness even if the evaluator never reconnects.

#### 3. No delivery acknowledgement

SSE is one-way and fire-and-forget. The server writes an event to the socket and has no way to confirm the client received it. There is no per-event retry mechanism. A network packet loss event that silently drops a write (without closing the connection) could cause an event to be lost without the client or server knowing.

**Mitigation:** In practice, TCP retransmission handles transient packet loss. The TTL backstop handles cases where an event is genuinely lost at a higher level. This risk is low but non-zero.

#### 4. Event ordering under rapid successive updates

If a flag is updated twice in quick succession (faster than the TCP round-trip time), events may theoretically arrive out of order at the client. The cache uses last-write-wins semantics, so an out-of-order delivery would leave the cache holding a non-latest value until the next TTL refresh or subsequent event.

**Mitigation:** In practice, the API processes mutations serially per request and TCP preserves order within a single connection. This is a theoretical risk. A sequence number on events could allow clients to detect and discard out-of-order events — not implemented in v3.

#### 5. API restart drops all connections

When the API server restarts, all SSE connections are closed. All connected evaluators enter the reconnect loop simultaneously, triggering a thundering herd of `refresh()` HTTP calls when the API comes back up. The evaluators' single-flight coalescing prevents multiple concurrent refresh calls per evaluator instance, but each instance (i.e., each running service) will still make one call.

**Mitigation:** The exponential backoff spreads reconnect attempts over time. If many services reconnect simultaneously, the API's normal request handling capacity applies.

#### 6. Flag creation of a subscribed key

If a flag is created with a key that is in the evaluator's `flags` array, a `flag_updated` event is sent (creation and update use the same event type). The evaluator receives and caches it correctly.

#### 7. Proxy and load balancer connection timeouts

Some HTTP proxies and load balancers aggressively close idle connections (e.g., AWS ALB defaults to 60 seconds). The server's 30-second heartbeat is designed to keep the connection active, but a proxy with a shorter idle timeout will silently close the connection. The SDK will detect the drop and reconnect, but this may cause frequent reconnect cycles in such environments.

**Mitigation:** Configure the proxy/load balancer idle timeout to exceed 30 seconds, or reduce the heartbeat interval. Check your infrastructure's timeout settings before enabling live updates in production.

#### 8. One persistent connection per evaluator instance

Each `CachedFlagEvaluator` instance with `liveUpdates: true` maintains one persistent HTTP connection to the API. The recommended singleton pattern (one module-level evaluator per process) means one connection per service process. Services that create multiple evaluator instances per process will create a proportional number of connections.

---

### Updated project structure (v3)

```
packages/ts-sdk/
├── src/
│   ├── index.ts              # Adds connect/disconnect to exports
│   ├── client.ts             # Adds streamDefinitions()
│   ├── cached-evaluator.ts   # Adds liveUpdates, connect(), disconnect()
│   └── types.ts              # Adds FlagStreamEvent, liveUpdates option
│
├── tests/
│   ├── client.test.ts        # Adds streamDefinitions() tests
│   ├── cached-evaluator.test.ts
│   └── cached-evaluator-live.test.ts  # NEW — live update behaviour
```

---

### Testing strategy (v3)

All tests remain unit tests — no real HTTP.

**`tests/client.test.ts`**
Mock `fetch` to return a `ReadableStream` that emits SSE lines. Verify:
- `flag_updated` events yield the correct `FlagStreamEvent`
- `flag_deleted` events yield the correct `FlagStreamEvent`
- `heartbeat` events yield the correct `FlagStreamEvent`
- Aborting via `signal` ends the iterable cleanly
- A non-2xx initial response throws `FeatureFlagError`

**`tests/cached-evaluator-live.test.ts`**
Inject a mock `FeatureFlagClient` whose `streamDefinitions()` returns a controllable async iterable. Test:

| Scenario | What to verify |
|---|---|
| `flag_updated` event received | Cache entry updated immediately; no HTTP call made |
| `flag_deleted` event received | Cache entry removed; next `evaluate()` falls back to `getDefinition()` |
| `heartbeat` event received | No cache change; no HTTP call |
| Connection error | Cache preserved; reconnect scheduled |
| Reconnect success | `refresh()` called before stream resumes |
| Exponential backoff | Reconnect delays double on successive failures, cap at 30s |
| `disconnect()` | Pending reconnect timer cancelled; stream aborted |
| `connect()` while connected | No-op; `streamDefinitions()` not called again |
| `warm()` with `liveUpdates: true` | Calls `connect()` after cache is populated |
| Rapid successive `flag_updated` events for same key | Cache holds the value from the last event received |
