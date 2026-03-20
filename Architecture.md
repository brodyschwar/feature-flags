# Architecture

This document covers the system design of the feature flags platform: what was built, how the pieces fit together, why specific decisions were made, and where the known tradeoffs and limitations lie.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Repository Structure](#repository-structure)
3. [Data Model](#data-model)
4. [API](#api)
5. [Authentication](#authentication)
6. [SDK](#sdk)
7. [Shared Evaluation Logic](#shared-evaluation-logic)
8. [Live Flag Updates (SSE)](#live-flag-updates-sse)
9. [Tech Stack Decisions](#tech-stack-decisions)
10. [Infrastructure](#infrastructure)
11. [Known Limitations](#known-limitations)

---

## System Overview

The platform has four concerns:

1. **Flag management** — create, edit, and delete feature flags through a dashboard UI.
2. **Flag evaluation** — resolve a flag to `true` or `false` for a given user context.
3. **SDK distribution** — give application developers a client library that integrates cleanly, evaluates efficiently, and degrades gracefully.
4. **Live propagation** — push flag changes to connected SDK clients in real time so changes take effect in seconds rather than on the next TTL cycle.

These are served by four packages in a pnpm monorepo:

```
apps/api          — REST API: flag CRUD, evaluation, SSE stream
apps/web          — Admin dashboard (React SPA)
packages/flag-evaluation  — Shared pure evaluation logic
packages/ts-sdk   — TypeScript SDK for server-side consumers
```

A demo application (`apps/demo-app-api` + `apps/demo-app-web`) ships alongside to demonstrate all three flag types end-to-end in a running Node.js service.

---

## Repository Structure

The monorepo is managed with **pnpm workspaces**. The workspace root `pnpm-workspace.yaml` declares two glob patterns:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

This splits the repo into two categories:

- **`apps/`** — runnable applications (API server, web dashboard, demo services). These are deployable artifacts and are never published to npm.
- **`packages/`** — shared libraries (`flag-evaluation`, `ts-sdk`). These are published or consumed internally via workspace references (`workspace:*`).

**Why pnpm over npm/yarn workspaces?** pnpm's content-addressable store means packages are deduplicated on disk across all workspaces. More importantly, pnpm enforces strict hoisting — a package cannot accidentally depend on something it hasn't explicitly declared. This catches missing `dependencies` entries that npm's loose hoisting would silently paper over. For a monorepo where `apps/api` and `packages/ts-sdk` share `@feature-flags/flag-evaluation`, having the linker enforce the dependency graph explicitly is valuable.

**Dependency graph:**

```
apps/web          ─── no internal deps (calls the API over HTTP)

apps/api          ─── @feature-flags/flag-evaluation

packages/ts-sdk   ─── @feature-flags/flag-evaluation

apps/demo-app-api ─── @feature-flags/ts-sdk
apps/demo-app-web ─── no internal deps (calls the demo API over HTTP)
```

The dashboard (`apps/web`) has no internal package dependencies — it communicates with `apps/api` over HTTP only. This is intentional: the frontend should not import server-side code directly, and keeping the boundary clean here avoids accidental coupling.

---

## Data Model

### Flag types

Three flag types cover the most common feature flagging patterns:

| Type | What it solves | Inputs at evaluation |
|---|---|---|
| `boolean` | Global on/off switch | None |
| `percentage` | Gradual rollout to a percentage of users | `userId` |
| `user_segmented` | Target specific users by attribute values | `userId`, `attributes` |

These three types deliberately do not cover every conceivable use case. A/B testing with multi-variate results, schedule-based flags, and dependency flags are all out of scope. The goal is a system that is completely understandable end-to-end rather than one that tries to cover everything.

### Schema: discriminated union

All flag types live in a single MongoDB collection using a discriminated union on the `type` field:

```ts
type Flag =
  | (FlagBase & { type: "boolean";        rules: BooleanRules })
  | (FlagBase & { type: "percentage";     rules: PercentageRules })
  | (FlagBase & { type: "user_segmented"; rules: UserSegmentedRules });
```

**Why a single collection?** Three collections (`flags_boolean`, `flags_percentage`, `flags_user_segmented`) would require a union query at the application layer whenever you need to list all flags, and would scatter the data across collections for no gain in query expressiveness. A single collection with a type discriminant allows MongoDB's native query operators and index structures to work over the whole dataset. The `key` unique index works across all types with no additional logic.

**Why is `type` immutable?** Changing a flag's type mid-life (e.g., promoting a `boolean` flag to `percentage`) would silently invalidate any cached `FlagDefinition` held by SDK consumers that doesn't include the full rules payload. Rather than version the schema or push a change notification and hope all clients re-fetch before evaluating, the API enforces immutability: delete and recreate if the type must change. This is the safer contract.

### Primary key

MongoDB documents use `_id`. Rather than maintain both `_id: ObjectId` and a separate `id: string` UUID, the flag's UUID is stored directly as `_id`. This avoids redundancy and means the API can expose `id` in responses without a transformation layer.

### Timestamps

Timestamps are stored as Unix milliseconds (`Number`) rather than MongoDB `Date` objects. MongoDB's `Date` type round-trips cleanly through the driver in most cases, but `Number` is unambiguous when serialized to JSON and requires no coercion on read. For an API that exclusively communicates over HTTP + JSON, this is simpler.

---

## API

### Route surface

```
GET    /flags                         List all flags (public)
POST   /flags                         Create a flag (JWT required)
GET    /flags/definitions             Evaluation payloads, bulk (JWT or API key)
GET    /flags/:key                    Get single flag (public)
GET    /flags/:key/definition         Evaluation payload, single (JWT or API key)
PATCH  /flags/:key                    Update a flag (JWT required)
DELETE /flags/:key                    Delete a flag (JWT required)
POST   /flags/:key/evaluate           Evaluate a flag (JWT or API key)
GET    /flags/stream                  SSE stream of flag change events (JWT or API key)

POST   /api-keys                      Create an API key (JWT required)
GET    /api-keys                      List API keys (JWT required)
DELETE /api-keys/:id                  Revoke an API key (JWT required)
```

**Why not REST-pure separate routes per type?** Per-type routes (`POST /flags/boolean`, `POST /flags/percentage`) would double the surface area without improving type safety — Zod validates the `rules` shape against the `type` discriminant regardless. A single `POST /flags` with a discriminated union body keeps the route table flat and makes SDK consumers simpler: they call one endpoint to evaluate any flag type, passing context that the evaluator reads selectively.

### Route registration order

`GET /flags/definitions` must be registered before `GET /flags/:key` in Express. Express matches routes in registration order, and `:key` would swallow the literal string `"definitions"` if registered first. The same applies to `/flags/stream`. This is a well-known Express footgun; the route files document this constraint explicitly.

### Evaluation

```
POST /flags/:key/evaluate
Authorization: Bearer <jwt or ff_key>
Content-Type: application/json

{ "context": { "userId": "...", "attributes": { "plan": "pro" } } }
```

A single endpoint evaluates any flag type. The evaluator reads what it needs from `context` and ignores the rest:

- `boolean` — `context` is ignored entirely.
- `percentage` — reads `context.userId`; missing `userId` evaluates to `false` (not enrolled).
- `user_segmented` — reads `context.attributes`; a missing attribute simply fails to match any segment that tests it.

**Why not separate evaluate endpoints per type?** The type is stored on the flag, not passed by the caller. The caller shouldn't need to know (or care) whether a flag is boolean or percentage — they evaluate it and get a boolean back. Type-specific evaluation endpoints would leak implementation details to callers and require them to track flag types out-of-band.

### Percentage rollout: hash bucketing

The `percentage` flag type uses SHA-256 to bucket users:

```
bucket = parseInt(sha256("${userId}:${flagKey}").slice(0, 8), 16) % 100
result = bucket < rules.percentage
```

**Why include the flag key in the hash?** Without the key, a user who lands in bucket 30 would be in the same bucket for every percentage flag. They would either always be in early rollouts or always be excluded, depending on how that bucket number maps to each flag's threshold. Including the key makes the hash independent per flag, so a user's rollout membership is uncorrelated across flags.

**Why SHA-256 over a simpler hash (CRC32, FNV)?** Uniformity. SHA-256 produces a highly uniform distribution with no known bias for string inputs of the form `userId:flagKey`. Simpler hashes have documented clustering issues with certain input patterns. The cost of SHA-256 at flag evaluation time is negligible.

**Determinism and stickiness.** The hash is purely a function of `userId` and `flagKey` — no random state, no server-side persistence. The same user always gets the same bucket, and increasing `percentage` from 20 to 30 enrolls the next 10% of users without disturbing the first 20%. This is the standard consistent-hash rollout pattern.

### `FlagDefinition` — evaluation-only payload

The `GET /flags/definitions` and `GET /flags/:key/definition` endpoints return a strict subset of the full flag document:

```ts
interface FlagDefinition {
  key: string;
  type: "boolean" | "percentage" | "user_segmented";
  rules: BooleanRules | PercentageRules | UserSegmentedRules;
}
```

`name`, `description`, `createdAt`, `updatedAt`, and `id` are intentionally excluded. The SDK only needs what it takes to evaluate — shipping metadata wastes bandwidth and, more importantly, means administrative edits (renaming a flag, updating its description) would invalidate SDK caches unnecessarily. The ETag for these endpoints is computed over the `{ key, type, rules }` fields only, so a rename does not constitute a cache-invalidating change from the SDK's perspective.

### ETag / 304 caching

Both definition endpoints implement HTTP conditional request semantics. The server computes `sha256(JSON.stringify(sortedRules))` and returns it as the `ETag` response header. When the SDK sends `If-None-Match: <etag>`, a matching ETag returns `304 Not Modified` with no body.

In practice this means the periodic cache refresh under `CachedFlagEvaluator` is almost always a single round-trip with no payload. Flag definitions change rarely; at 30s or 5m TTLs, the vast majority of refresh calls return 304.

---

## Authentication

Two distinct caller types have fundamentally different needs:

| Caller | Routes | Auth method |
|---|---|---|
| Human (dashboard) | All management routes + evaluate | Clerk JWT |
| Machine (SDK/service) | Evaluate + definitions + stream | `ff_` API key |

### Clerk JWTs (human auth)

The dashboard authenticates users through Clerk's hosted login flow and receives a short-lived JWT. The API verifies this JWT against Clerk's JWKS endpoint — no user sessions, no cookies, no user table in the database. Clerk handles identity, MFA, and token rotation.

**Why Clerk over rolling a custom JWT flow?** A custom auth system requires implementing token issuance, refresh token rotation, JWKS hosting, revocation, and secure storage — all non-trivial and each a potential vulnerability. Clerk provides all of this on a generous free tier. For a project of this scope, the build-vs-buy tradeoff strongly favors Clerk.

**Why JWTs over session cookies for the dashboard?** The API is stateless. JWTs allow any API instance to verify a request without a shared session store, which matters if the API is ever scaled horizontally. Cookies would also require CSRF protection on mutation endpoints; bearer tokens in the `Authorization` header are not subject to CSRF.

### API keys (machine auth)

SDK and service callers use long-lived `ff_` prefixed keys. The API hashes the incoming key with SHA-256 and looks up the hash in the `api_keys` collection — only the hash is stored, never the plaintext.

**Key format:** `ff_` + 32 random URL-safe base64 characters. The `ff_` prefix is not a security mechanism — it is a readability aid. A key found in logs or a leaked `.env` file is immediately recognizable as a feature flags API key, which accelerates incident response and makes secrets-scanning tools easier to configure.

**Why not use Clerk API keys or a third-party secrets manager?** API keys for machine callers are a well-understood primitive that the codebase can own entirely. Adding a dependency on an external service for key issuance would couple the flags API to that service's availability — if Clerk or a secrets manager goes down, SDK clients cannot initialize. Self-managed keys stored in the same MongoDB instance that backs everything else keeps the operational surface small.

**Why SHA-256 storage?** Storing plaintext API keys is a single breach away from full SDK impersonation. SHA-256 is a one-way function: a leaked database dump reveals only hashes, and the attacker must brute-force every hash individually. The hash is also deterministic, so the lookup `sha256(incoming) === stored` is a single indexed read with no additional infrastructure (no bcrypt work factor, no token table).

### Dual auth on shared endpoints

`POST /flags/:key/evaluate`, `GET /flags/definitions`, `GET /flags/:key/definition`, and `GET /flags/stream` accept either credential type. The middleware distinguishes them by prefix: a value starting with `ff_` is routed to the API key path; anything else is treated as a JWT. This allows the dashboard to evaluate flags during development using its existing Clerk session without embedding a machine API key in the frontend bundle.

---

## SDK

The TypeScript SDK (`packages/ts-sdk`) is the primary interface for application developers integrating with the flags platform. It exposes two classes:

### `FeatureFlagClient` — direct HTTP

A thin wrapper around the evaluation and definition endpoints. Every call makes a network request. This is the right choice for low-traffic services or for development when simplicity matters more than performance.

```ts
const client = new FeatureFlagClient({
  baseUrl: "https://your-flags-api.com",
  apiKey: "ff_...",
});

const enabled = await client.evaluate("new-transaction-flow", {
  userId: "user_123",
  attributes: { plan: "pro" },
});
```

### `CachedFlagEvaluator` — local evaluation with caching

Fetches flag definitions once, stores them in memory, and evaluates locally using the same pure logic as the server. Subsequent `evaluate()` calls are synchronous lookups against the cache with no network hop.

```ts
const evaluator = new CachedFlagEvaluator({
  client,
  flags: ["new-transaction-flow", "kill-switch"] as const,
  ttl: 300_000,
  liveUpdates: true,
});

await evaluator.warm(); // pre-populate before serving traffic
const enabled = await evaluator.evaluate("new-transaction-flow", context);
```

**Why cache flag definitions rather than evaluation results?** Caching evaluation results would require a cache key that encodes both the flag key and the full user context (userId + all attributes). This produces an unbounded cache with poor hit rates for any service with diverse user populations. Caching the flag *definition* — which changes rarely — gives a small, bounded cache (one entry per flag) with an extremely high hit rate. The per-evaluation compute cost is negligible.

**Why is `CachedFlagEvaluator` generic on flag keys (`T extends string`)?** The `flags` constructor option with `as const` allows TypeScript to infer the literal union of keys. `evaluate("unknown-flag")` then becomes a compile-time error rather than a runtime 404. This catches flag key typos and key removals at build time.

```ts
// T is inferred as "flag-a" | "flag-b"
const evaluator = new CachedFlagEvaluator({
  flags: ["flag-a", "flag-b"] as const,
  ...
});

evaluator.evaluate("flag-c"); // ✗ TypeScript error
```

### TTL and staleness

The cache has a configurable TTL (default 30s, recommended 5m when `liveUpdates: true`). `staleWhileRevalidate` mode returns the cached value immediately and refreshes in the background — useful for latency-sensitive paths that can tolerate briefly stale values. The default blocks until the refresh completes, which is safer for correctness-critical evaluations.

### Single-flight refresh

If the TTL expires while many concurrent requests are in flight, all would independently trigger a cache refresh and send parallel requests to the API. `CachedFlagEvaluator` uses a single-flight lock: the first caller to see a stale cache stores the in-flight `Promise`; every subsequent caller awaits the same `Promise` rather than starting a new request. This prevents thundering herd on TTL expiry under load.

### ETag integration

The evaluator passes the last-received `ETag` as `If-None-Match` on every refresh. A `304 Not Modified` response resets `fetchedAt` (restarting the TTL window) without touching the in-memory cache. Under steady-state operation where flag definitions rarely change, refresh calls are almost always `304`s — a single round-trip with no deserialization cost.

### Cache miss fallback

If `evaluate("flag-x")` is called and `flag-x` is not in the bulk cache (e.g., the flag was created after the last refresh), the evaluator falls back to `GET /flags/:key/definition` for that specific key. This covers the case where a newly created flag needs to be evaluated before the next TTL cycle.

---

## Shared Evaluation Logic

`packages/flag-evaluation` contains the canonical evaluation function:

```ts
export function evaluate(definition: FlagDefinition, context?: EvaluationContext): boolean;
```

Both `apps/api` (server-side evaluation via `POST /flags/:key/evaluate`) and `packages/ts-sdk` (local evaluation inside `CachedFlagEvaluator`) import from this package.

**Why extract this to a shared package?** If the API and SDK each maintained their own copy of the evaluation logic, they would inevitably diverge. A bug fix or operator addition applied to one would need to be ported to the other. More dangerously, a subtle inconsistency — a different operator precedence, a slightly different hash input format — could cause the same flag to evaluate to `true` server-side and `false` in the SDK. This would be a silent correctness bug: no error is thrown, no alert fires, the wrong value is silently returned. A single shared implementation eliminates that entire class of bug by construction.

The package has zero runtime dependencies and no I/O — it is a pure function over data. This makes it trivially testable and means neither `apps/api` nor `packages/ts-sdk` takes on any new transitive dependencies by importing it.

**One notable constraint:** the percentage hash uses Node's `crypto.createHash('sha256')`, which means the evaluation package targets Node.js only. Browser support would require switching to `SubtleCrypto` or a pure-JS SHA-256. This is an acceptable constraint for the current scope (server-side SDK only) and is documented explicitly.

---

## Live Flag Updates (SSE)

### Why SSE rather than WebSockets or polling

**Polling** is simple but wastes requests and adds latency proportional to the poll interval. A 30s TTL means changes take up to 30s to propagate; reducing the interval proportionally increases API load.

**WebSockets** are bidirectional — the client can send messages to the server. For flag change notifications, the client has nothing to say after the initial subscription. WebSockets are the right tool for collaborative or interactive applications; they're unnecessary overhead here.

**Server-Sent Events** are unidirectional (server → client) over a persistent HTTP connection. They map exactly to the problem: the server needs to push flag changes to SDK clients with no client-initiated messages after connection. SSE reconnects automatically at the HTTP level, works through standard HTTP proxies, and is natively parseable with a straightforward streaming `fetch()` in Node.js 18+.

**Why not a message broker (Kafka, Redis pub/sub)?** A message broker would add significant operational complexity — another service to deploy, monitor, and secure. For a single-instance deployment, an in-process subscriber registry is simpler and has lower latency (no broker round-trip). The single-instance limitation is a known tradeoff, documented below.

### Server-side implementation

The API maintains an in-memory `Set<SseClient>` of active connections. Each entry holds the Express `Response` object and the set of flag keys the client subscribed to. After every successful `PATCH /flags/:key` and `POST /flags` write, the handler iterates the set and writes an SSE event to each client whose subscribed keys include the mutated flag. After `DELETE`, a `flag_deleted` event is similarly fanned out.

A 30-second heartbeat timer writes a `heartbeat` event to all connected clients, preventing proxies and load balancers from closing idle connections.

Clients are removed from the set on `res.on("close")` — either a clean client disconnect or a write error.

### SDK reconnection strategy

When the SSE connection drops, the SDK does not clear its cache. It continues serving cached values and schedules a reconnect with exponential backoff (1s → 2s → 4s → ... → 30s). On each reconnect:

1. `refresh()` is called first (a full `GET /flags/definitions`) to fill any gap while the connection was down.
2. The stream resumes.
3. The backoff delay resets to 1s.

TTL polling continues to run as a backstop regardless of SSE state. Even a permanently disconnected evaluator will eventually pick up changes through TTL.

### Single-process limitation

**This is the most significant architectural constraint of the current design.**

The subscriber registry is in the memory of a single API process. In a multi-instance deployment (two API servers behind a load balancer), a flag update processed by instance A notifies only the SDK clients connected to instance A. Clients connected to instance B receive no event and remain stale until their TTL poll.

The fix is a pub/sub layer: when any instance processes a mutation, it publishes to a shared channel (Redis pub/sub, or a message broker). All instances subscribe and fan out to their local connected clients. This is not implemented. The current design is correct only for single-instance deployments. Any multi-instance deployment should treat live updates as a best-effort optimisation and not rely on them for correctness.

---

## Tech Stack Decisions

### Runtime: Node.js + TypeScript

**Alternatives considered:** Go, Python (FastAPI), Bun.

TypeScript was chosen to maximize code sharing across the monorepo — the API, SDK, dashboard, and evaluation logic all share types and packages. A Go API would produce a faster binary but would sever the shared-library connection; the evaluation logic would need to be re-implemented independently, reintroducing the divergence risk described in [Shared Evaluation Logic](#shared-evaluation-logic). Python would have the same problem and adds a second runtime to the developer environment.

Bun is a compelling alternative for its speed, but its compatibility with the Node.js ecosystem (specifically `mongodb-memory-server`, which vendors a real MongoDB binary) is not guaranteed. Introducing Bun as the runtime during development is a distraction from the actual problem being solved.

### Framework: Express

**Alternatives considered:** Fastify, Hapi, NestJS, Koa.

Express was chosen for explicitness. Every middleware, route, and error handler is visible and in the codebase. There is no hidden convention layer.

Fastify is legitimately faster than Express and has a superior plugin architecture. If raw throughput becomes a constraint, migrating is straightforward. At current scale it is not a constraint.

NestJS provides dependency injection, decorators, and a highly structured project layout. For a medium-sized API like this one, that structure is overhead — it obscures what is actually happening behind layers of abstraction. Express routes are easy to read, easy to test with `supertest`, and require no framework knowledge beyond what is documented in Express itself.

### Database: MongoDB

**Alternatives considered:** PostgreSQL, SQLite, DynamoDB.

MongoDB was chosen for two reasons: the discriminated-union data model is a natural fit, and Atlas provides a generous free deployment tier.

PostgreSQL is a more powerful database with a richer query language. The discriminated union would work in Postgres using a `JSONB` column for `rules` and a separate `type` column, or using table inheritance. Both approaches work but require more schema management. For a data model with three clearly bounded shapes that never need cross-type relational queries, MongoDB's schemaless BSON is a better ergonomic fit.

SQLite would work for a single-instance deployment but does not support the concurrent write patterns needed for a production API, and Atlas-equivalent managed hosting is not as accessible.

DynamoDB is a strong choice for serverless or high-scale deployments. It requires more upfront schema design (choosing partition and sort keys is non-trivial) and introduces AWS as a hard dependency. For a project intended to be self-hostable with minimal ops overhead, MongoDB Atlas is simpler.

### Validation: Zod

**Alternatives considered:** Joi, Yup, io-ts, manual validation.

Zod's primary advantage over alternatives is that it infers TypeScript types from schema definitions — the schema *is* the type. Joi and Yup produce validated values but their TypeScript support requires maintaining parallel type definitions. io-ts takes the same approach as Zod but has a more complex API surface. Zod has become the de facto standard for runtime validation in the TypeScript ecosystem and its error output integrates well with the API's error response format.

### Test runner: Vitest

**Alternatives considered:** Jest, Mocha + Chai.

Jest is the most widely used JavaScript test runner but has significant friction with ESM modules. The entire monorepo uses `"type": "module"` and `NodeNext` module resolution — Jest's ESM support remains experimental and requires additional transform configuration. Vitest is ESM-native, shares Vite's fast transform pipeline, and its API is almost identical to Jest's, making the learning curve negligible. The testing story is simpler: one config file per package, no Babel transforms, no ESM shims.

### Frontend: React + Vite

**Alternatives considered:** Next.js, SvelteKit, Vue.

The dashboard is a client-side SPA with no SEO or SSR requirements. Next.js brings file-system routing, SSR, and a complex build pipeline that adds no value for an authenticated internal tool. Vite + React Router produces the same result with far less configuration. The dashboard is never served to search engines and has no public-facing pages, so the SEO advantages of SSR are irrelevant.

Vue and Svelte are both viable; React was chosen primarily to match the demo application and to minimize context switching within the monorepo.

### Component library: MUI (Material UI)

**Alternatives considered:** Tailwind + headless components, Radix UI, Chakra UI, Ant Design.

MUI provides a full set of accessible, pre-styled components that cover everything the dashboard needs (tables, dialogs, forms, inputs, icons). Building components from scratch with Tailwind would produce a more customized result but requires significantly more upfront investment. MUI's component API is consistent and its TypeScript types are comprehensive. For an internal admin tool where visual polish matters less than functionality, MUI is the right tradeoff.

### HTTP client in SDK: native `fetch`

**Alternatives considered:** `axios`, `got`, `node-fetch`.

Node.js 18 ships `fetch` as a first-class global. Using it means zero additional runtime dependencies for the SDK. `axios` provides a more ergonomic API and better error handling by default, but its bundle size and additional dependency are not justified when `fetch` is available. The SDK's HTTP layer is thin enough that `fetch`'s lower-level API is not a burden.

---

## Infrastructure

### MongoDB Atlas

Flag data is stored in MongoDB Atlas (free tier, shared cluster). Atlas handles backups, monitoring, connection pooling, and TLS — none of which require configuration on the application side. The connection string is the only environment variable the API needs to connect; no VPC peering, no TLS certificate management.

**Tradeoff:** the free-tier shared cluster has performance ceilings. Flag evaluation calls hit MongoDB on every `POST /flags/:key/evaluate` request. If the API handles high evaluation traffic, the shared cluster may become a bottleneck. Migrating to a dedicated cluster or introducing a read replica is the path forward; the application code does not need to change.

The `CachedFlagEvaluator` in the SDK was designed specifically to reduce evaluation pressure on the API and database. When every SDK consumer caches flag definitions locally, the API's hot path shifts from "evaluate on every request" to "serve definitions periodically" — a much lower-frequency and lower-cost operation.

### Single-instance API deployment

The API is currently designed for single-instance deployment. This is consistent with the in-process SSE subscriber registry (see [Known Limitations](#known-limitations)). A single instance behind a managed platform (Railway, Render, Fly.io, a single EC2 or VPS) is the supported topology.

**Horizontal scaling** is possible for the evaluation and read paths — stateless `GET` requests can be load-balanced freely. The constraint is the SSE stream: all clients connected to a given instance only receive updates processed by that instance. If horizontal scaling is needed, the SSE registry must be moved to a shared pub/sub layer before deploying multiple instances.

### Environment variables

The API requires:

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `CLERK_JWKS_URL` | Clerk JWKS endpoint for JWT verification |
| `PORT` | HTTP port (default: `3001`) |
| `CORS_ORIGIN` | Allowed CORS origin for the dashboard |

No secrets are stored in code or committed to version control. The `ff_` API key plaintext is shown to the creating user exactly once and never stored — only its SHA-256 hash reaches the database.

---

## Known Limitations

### SSE live updates: single-instance only

Described in detail in [Live Flag Updates](#live-flag-updates-sse). In a multi-instance deployment, live updates are best-effort and not guaranteed to reach all SDK consumers. TTL polling is the correctness backstop.

**Resolution path:** add a Redis pub/sub channel. Each API instance publishes flag mutations to the channel; all instances subscribe and fan out to their local SSE clients. Application code changes are confined to the flag mutation handlers and the SSE registry.

### No event replay (`Last-Event-ID`)

The SSE server does not buffer past events. A client that disconnects and reconnects will not receive events that occurred during the gap. The SDK compensates by calling `GET /flags/definitions` immediately on reconnect, which fills the gap via a full cache refresh. For short disconnections this is effectively invisible; for long disconnections (minutes), the refresh guarantees correctness.

### Node.js SDK only

The `packages/ts-sdk` and `packages/flag-evaluation` packages target Node.js. The percentage hash uses `crypto.createHash('sha256')` from Node's built-in `crypto` module, which is not available in browsers. A browser-compatible SDK would need to replace this with the Web Crypto API (`SubtleCrypto`). The rest of the SDK (HTTP client, cache management, SSE parsing) already uses browser-compatible APIs (`fetch`, `ReadableStream`, `AbortController`).

### No batched evaluation

`FeatureFlagClient.evaluate()` makes one HTTP request per call. For services that evaluate many flags in a single request, this creates multiple serial or parallel API calls. `CachedFlagEvaluator` eliminates this for the common case by evaluating locally. There is no batch endpoint on the API.

### Segment operators: string-only

The `user_segmented` operators (`eq`, `neq`, `in`, `not_in`, `contains`, `regex`) operate on string attribute values only. Numeric comparisons (`lt`, `gt`) and boolean attributes are not supported. This covers the most common segmentation patterns (plan tier, email domain, user ID range) but cannot express "users with account age > 30 days" without pre-computing and stringifying that value in the calling service.
