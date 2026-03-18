# CLAUDE.md — Backend (`apps/api`)

## Overview

TypeScript/Express REST API that manages feature flag definitions, rules, and evaluation logic.
This is the authoritative source of truth for all flag state.

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js + TypeScript | Monorepo consistency |
| Framework | Express | Lightweight, explicit, easy to test |
| Database | MongoDB | Free deployment on shared clusters via Atlas |
| Validation | `zod` | Runtime schema validation + inferred TS types |
| Test runner | Vitest | Fast, native TS/ESM, same config for unit + integration |
| HTTP assertions | supertest | Test Express routes without starting a real server |
| In-memory MongoDB | mongodb-memory-server | Real MongoDB binary in-process — no mocks, no Atlas needed in CI |

---

## Project Structure

```
apps/api/
├── src/
│   ├── index.ts                          # Starts the server: connects to DB, calls app.listen()
│   ├── app.ts                            # Express app factory — exported separately so tests can import without starting the server
│   │
│   ├── db/
│   │   ├── client.ts                     # MongoDB connection (connect / disconnect helpers)
│   │   └── collections.ts               # Typed collection accessors (flags, api_keys)
│   │
│   ├── schemas/
│   │   ├── flag.schema.ts               # Zod discriminated union for Flag + inferred TS types
│   │   └── apiKey.schema.ts             # Zod schema for ApiKey documents
│   │
│   ├── evaluation/
│   │   ├── evaluate.ts                  # Pure evaluation logic — no I/O, no Express
│   │   └── evaluate.test.ts             # Unit tests
│   │
│   ├── middleware/
│   │   ├── requireJwt.ts                # Verifies Clerk JWT via JWKS; attaches decoded claims to req
│   │   ├── requireJwt.test.ts           # Unit tests
│   │   ├── requireApiKey.ts             # SHA-256 hashes incoming key, looks up in api_keys collection
│   │   └── requireApiKey.test.ts        # Unit tests
│   │
│   ├── routes/
│   │   ├── flags/
│   │   │   ├── flags.router.ts          # Route definitions for /flags and /flags/:key/evaluate
│   │   │   └── flags.test.ts            # Integration tests
│   │   └── apiKeys/
│   │       ├── apiKeys.router.ts        # Route definitions for /api-keys
│   │       └── apiKeys.test.ts          # Integration tests
│   │
│   └── test/
│       └── mongoSetup.ts                # Shared mongodb-memory-server lifecycle (beforeAll/afterEach/afterAll)
│
├── vitest.config.ts
├── tsconfig.json
├── CLAUDE.md
└── package.json
```

---

## Data Model

### `flags` collection

All flag types live in a single collection. The top-level `type` field is the discriminant — it determines the shape of `rules`. This avoids a second nested `type` inside `rules` and keeps TypeScript narrowing clean.

```ts
// ── Shared base ────────────────────────────────────────────────
interface FlagBase {
  id: string;          // UUID, primary key
  key: string;         // unique, indexed — used by the SDK (e.g. "new-transaction-flow")
  name: string;        // human-readable label
  description: string;
  createdAt: number;   // unix timestamp (ms)
  updatedAt: number;   // unix timestamp (ms)
}

// ── Rule shapes per type ────────────────────────────────────────

/** Simple on/off. No targeting. */
interface BooleanRules {
  enabled: boolean;
}

/**
 * Hash-based percentage rollout.
 * Evaluation: sha256(userId + ":" + flagKey) % 100 < percentage → enabled.
 * Deterministic and sticky — same user always gets the same result.
 */
interface PercentageRules {
  percentage: number;  // 0–100 (inclusive)
}

/**
 * Ordered list of attribute-based segments.
 * Evaluation: walk segments top-to-bottom; first match determines the result.
 * Falls back to `defaultValue` if no segment matches.
 */
interface UserSegmentedRules {
  segments: Array<{
    attribute: string;             // user context key, e.g. "userId", "plan", "email"
    operator: "eq" | "neq" | "in" | "not_in" | "contains" | "regex";
    values: string[];              // always an array — "eq"/"neq" use values[0]
    result: boolean;
  }>;
  defaultValue: boolean;
}

// ── Discriminated union ─────────────────────────────────────────

type Flag =
  | (FlagBase & { type: "boolean";          rules: BooleanRules })
  | (FlagBase & { type: "percentage";       rules: PercentageRules })
  | (FlagBase & { type: "user_segmented";   rules: UserSegmentedRules });
```

### MongoDB notes

| Concern | Detail |
|---|---|
| Collection | `flags` — single collection, heterogeneous `rules` field |
| Primary key | `_id` is set to the UUID `id` value (avoids storing both `_id` and `id`) |
| Indexes | `key` unique index — SDK and API look up flags by key in the hot path |
| Timestamps | Stored as `Number` (Unix ms) to avoid MongoDB `Date` serialization quirks |

### Evaluation semantics summary

| Type | Inputs needed at eval time | Result |
|---|---|---|
| `boolean` | none | `rules.enabled` |
| `percentage` | `userId` | deterministic hash of `userId:flagKey` → 0–99, compare to `rules.percentage` |
| `user_segmented` | user context object | walk `rules.segments` in order; first match wins; fall back to `rules.defaultValue` |

## API

All flags share the same routes — the `type` field in the request body is the discriminant, validated by Zod. Per-type routes would not improve type safety (Zod handles that regardless) and would double the surface area for no gain.

### Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/flags` | List all flags. Supports `?type=boolean\|percentage\|user_segmented` filter. Returns summary fields only (`key`, `name`, `type`, `rules`). |
| `POST` | `/flags` | Create a flag. Body is the full discriminated union — Zod validates `rules` shape against `type`. |
| `GET` | `/flags/:key` | Get a single flag's full configuration. |
| `PATCH` | `/flags/:key` | Update a flag's `rules` and/or metadata (`name`, `description`). Flag `type` is immutable — delete and recreate if the type must change. |
| `DELETE` | `/flags/:key` | Delete a flag. |
| `POST` | `/flags/:key/evaluate` | Evaluate a flag. See below. |

### Evaluation

```
POST /flags/:key/evaluate
```

```ts
// Request body
{
  context?: {
    userId?: string;
    attributes?: Record<string, string>;  // arbitrary user properties for segment matching
  }
}

// Response
{
  key: string;
  result: boolean;
}
```

A single endpoint handles all flag types. The evaluator reads what it needs from `context` and ignores the rest:

- `boolean` — ignores `context` entirely
- `percentage` — reads `context.userId`; a missing `userId` evaluates to `false`
- `user_segmented` — reads `context.attributes`; a missing attribute that a segment tests against is treated as no-match

---

## Auth

There are two distinct callers with different needs:

| Caller | Routes | Needs |
|---|---|---|
| Human admin (dashboard) | All CRUD routes + `/api-keys` | Login flow, session, identity |
| Machine caller (SDK/service) | `POST /flags/:key/evaluate` only | Lightweight, no login flow |

These are solved differently. Forcing SDK callers through OAuth is unnecessary overhead; giving admins a raw API key is a security step down.

### Provider: Clerk

**Clerk** is the recommended auth provider for human admin auth.

Add to Tech Stack:

| Concern | Choice |
|---|---|
| Human auth provider | Clerk (free tier, JWT-based) |
| Machine auth | API keys (self-managed, stored in MongoDB) |

### Human auth — JWT middleware

Management routes require a valid Clerk JWT in the `Authorization` header.

```
Authorization: Bearer <clerk_jwt>
```

The Express middleware verifies the token against Clerk's JWKS endpoint (`https://<clerk-domain>/.well-known/jwks.json`). No user session is stored server-side — the JWT is stateless.

**Protected routes** (require JWT):
- `POST /flags`
- `PATCH /flags/:key`
- `DELETE /flags/:key`
- All `/api-keys` routes

**Public routes** (no auth, read-only for now — can be locked down later):
- `GET /flags`
- `GET /flags/:key`

### Machine auth — API keys

SDK and service callers use API keys to authenticate evaluation requests.

```
Authorization: Bearer ff_<random>
```

The middleware hashes the incoming value with SHA-256 and looks it up in the `api_keys` collection. Only the hash is stored — the plaintext is shown once on creation and never retrievable again.

#### `api_keys` collection

```ts
interface ApiKey {
  _id: string;       // SHA-256 hash of the plaintext key — used for lookups
  name: string;      // human label, e.g. "production-backend"
  createdAt: number; // unix timestamp (ms)
  lastUsedAt: number | null;
}
```

#### API key management routes

These routes are protected by JWT (admin only).

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api-keys` | Create a key. Returns plaintext **once** — not stored. Body: `{ name: string }` |
| `GET` | `/api-keys` | List all keys with metadata. Never returns the key value or hash. |
| `DELETE` | `/api-keys/:id` | Revoke a key by its `_id` (the hash). |

Key format: `ff_` prefix + 32 random URL-safe base64 characters. The prefix makes keys grep-able in logs and easy to identify if accidentally leaked.

### Auth flow summary

```
Dashboard user
  └─ logs in via Clerk
  └─ receives JWT
  └─ sends JWT on every management request
  └─ Express verifies JWT signature against Clerk's JWKS

SDK / service
  └─ admin creates API key via dashboard
  └─ key stored (hashed) in MongoDB
  └─ SDK sends key on every evaluate request
  └─ Express hashes incoming key, looks up in api_keys collection
```

---

## Testing

### Two test types, one runner

All tests use Vitest. The distinction is what they exercise:

| Type | Tests | External deps |
|---|---|---|
| Unit | Pure functions — evaluation logic, Zod schemas, hash utilities | None |
| Integration | Express routes end-to-end — HTTP in, HTTP out, real DB | `supertest` + `mongodb-memory-server` |

### Unit tests

Target anything with no I/O: the evaluation engine, schema validators, the API key hash function. These are fast and numerous.

```ts
// src/evaluation/evaluate.test.ts
it("percentage flag: userId hashes deterministically below threshold", () => { ... });
it("user_segmented: first matching segment wins", () => { ... });
it("user_segmented: falls back to defaultValue when no segment matches", () => { ... });
it("boolean flag: returns rules.enabled directly", () => { ... });
```

### Integration tests

Use `supertest` to make real HTTP calls against the Express app and `mongodb-memory-server` to back them with a real (in-process) MongoDB instance.

```ts
// src/routes/flags/flags.test.ts
import { app } from "../../app";
import request from "supertest";

describe("POST /flags", () => {
  it("creates a boolean flag and returns 201", async () => {
    const res = await request(app)
      .post("/flags")
      .set("Authorization", "Bearer <test_token>")
      .send({ key: "my-flag", type: "boolean", rules: { enabled: true }, ... });
    expect(res.status).toBe(201);
  });
});
```

**Why `mongodb-memory-server` instead of mocking Mongoose/the MongoDB driver?**
Mocks only prove that your code calls the right methods. `mongodb-memory-server` runs the actual MongoDB binary in-process — indexes, unique constraints, and query behavior all work exactly as in production. Mock divergence has caused real bugs (unique index violations that only surface in prod); this eliminates that class of issue entirely.

### Auth in tests

The JWT middleware and API key middleware are **unit tested in isolation**. In integration tests they are **bypassed via `vi.mock()`** — authentication correctness is already proven by the unit tests; there's no value in re-testing it on every route.

```ts
// in integration test setup
vi.mock("../../middleware/requireJwt", () => ({
  requireJwt: (_req, _res, next) => next(), // always passes
}));
```

### File layout

Test files live next to the source they test. No separate `__tests__` directory.

```
src/
├── evaluation/
│   ├── evaluate.ts
│   └── evaluate.test.ts        ← unit
├── middleware/
│   ├── requireJwt.ts
│   ├── requireJwt.test.ts      ← unit
│   ├── requireApiKey.ts
│   └── requireApiKey.test.ts   ← unit
└── routes/
    ├── flags/
    │   ├── flags.router.ts
    │   └── flags.test.ts       ← integration
    └── apiKeys/
        ├── apiKeys.router.ts
        └── apiKeys.test.ts     ← integration
```

### Test setup

`mongodb-memory-server` is started once per integration test file (not per test). Collections are cleared between tests, not the whole server.

```ts
// src/test/mongoSetup.ts  — imported in each integration test file
import { MongoMemoryServer } from "mongodb-memory-server";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectToMongo(mongo.getUri());
});

afterEach(async () => {
  await clearAllCollections(); // fast wipe between tests
});

afterAll(async () => {
  await disconnectFromMongo();
  await mongo.stop();
});
```