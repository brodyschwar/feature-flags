# CLAUDE.md — TypeScript SDK (`products/ts-sdk`)

## Overview

A lightweight TypeScript SDK for evaluating feature flags against the feature flags API. Designed to be consumed by Node.js services and server-side applications. The SDK is the primary machine caller for the evaluate endpoint — it authenticates via an `ff_` API key, not a Clerk JWT.

This first iteration covers **evaluation only** — no flag management (CRUD), no caching, no batching.

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

## What Is Out of Scope (v1)

| Feature | Notes |
|---|---|
| Caching | Planned for v2 — avoid adding until the interface is stable |
| Batching multiple evaluations | Not in v1 |
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
