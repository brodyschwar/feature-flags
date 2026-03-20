# CLAUDE.md — Demo App API (`apps/demo-app-api`)

## Overview

A barebones Express/MongoDB REST API for a user preferences application. Its primary purpose is to serve as a living demo of the `@feature-flags/ts-sdk` — specifically the `CachedFlagEvaluator`. Every interesting behavior in the API is gated or shaped by a feature flag, giving a concrete, runnable showcase of all three flag types.

Users can register, view their profile, and manage a small set of preferences: their plan tier, a favorite number, and a favorite color.

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript | Matches monorepo convention |
| Framework | Express | Consistent with `apps/api` |
| Database | MongoDB (native driver) | Single collection; matches monorepo convention |
| Feature flags | `@feature-flags/ts-sdk` `CachedFlagEvaluator` | The thing being demoed |
| Test runner | Vitest | Consistent with monorepo |

---

## Project Structure

```
apps/demo-app-api/
├── src/
│   ├── index.ts              # Server startup — connects DB, warms flags, starts Express
│   ├── app.ts                # Express app factory (imported by tests without starting server)
│   ├── db/
│   │   └── client.ts         # MongoDB connection and collection helpers
│   ├── flags.ts              # Module-level CachedFlagEvaluator singleton
│   ├── models/
│   │   └── user.model.ts     # User interface, collection accessor, findUserById
│   ├── routes/
│   │   └── users/
│   │       └── users.router.ts
│   └── test/
│       └── mongoSetup.ts     # Vitest setup file — MongoMemoryServer lifecycle
├── tests/
│   └── users.test.ts
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

---

## User Model

All data for the application lives in a single `users` collection.

```ts
interface User {
  _id: ObjectId;
  username: string;        // unique, non-identifying handle chosen at registration
  plan: "free" | "basic" | "pro";
  favoriteNumber: number | null;   // 0–100
  favoriteColor: string | null;    // one of the allowed palette values
  createdAt: Date;
  updatedAt: Date;
}
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/users` | Register a new user |
| `GET` | `/users/:id` | Get a user's profile |
| `PATCH` | `/users/:id/preferences` | Update plan, favoriteNumber, or favoriteColor |
| `GET` | `/users/:id/options` | Get the available choices for this user (flag-driven) |

### `POST /users`

Registers a new user. Plan defaults to `"free"`.

Request body:
```json
{ "username": "alice" }
```

Response `201`:
```json
{ "id": "...", "username": "alice", "plan": "free" }
```

---

### `GET /users/:id`

Returns the user's profile. The shape of the response varies based on the `show-favorite-number` flag — if the flag is off, `favoriteNumber` is omitted entirely.

Response `200` (flag on):
```json
{
  "id": "...",
  "username": "alice",
  "plan": "free",
  "favoriteNumber": 42,
  "favoriteColor": "blue"
}
```

Response `200` (flag off — `favoriteNumber` absent):
```json
{
  "id": "...",
  "username": "alice",
  "plan": "free",
  "favoriteColor": "blue"
}
```

---

### `PATCH /users/:id/preferences`

Updates one or more preferences. Accepted fields: `plan`, `favoriteNumber`, `favoriteColor`.

Flag-gated validation rules apply (see Flag Scenarios below). Returns `400` if a submitted value violates the caller's current flag-determined constraints.

Request body:
```json
{ "favoriteNumber": 77, "favoriteColor": "coral" }
```

Response `200`: updated user profile (same shape as `GET /users/:id`).

---

### `GET /users/:id/options`

Returns what this specific user is allowed to set, based on their current flags. Useful for driving frontend form rendering — the frontend asks "what can I show?" before presenting inputs.

Response `200`:
```json
{
  "favoriteNumberEnabled": true,
  "favoriteNumberRange": { "min": 0, "max": 10 },
  "availableColors": ["red", "blue", "green", "yellow", "purple"]
}
```

This endpoint is the most explicitly flag-driven in the API — every field in the response is resolved by evaluating one or more flags for the user.

---

## Flag Scenarios

These are the three flags that drive the demo. Each flag maps cleanly to one of the three flag types supported by the evaluation engine. All flag keys must be created in the feature flags admin dashboard before running the demo.

---

### Flag 1: `show-favorite-number` — Boolean

**Type:** `boolean`

**What it controls:** Whether the favorite number preference exists at all. When `rules.enabled` is `false`:
- `GET /users/:id` omits `favoriteNumber` from the response
- `GET /users/:id/options` returns `favoriteNumberEnabled: false`
- `PATCH /users/:id/preferences` rejects any `favoriteNumber` field with `400`

**Demo value:** This is the simplest possible case — a global on/off feature gate. Toggle the flag in the admin dashboard and the field appears or disappears across the entire app instantly (within the TTL window).

**SDK usage:**
```ts
const showFavoriteNumber = await flags.evaluate("show-favorite-number");
```

No `context` is needed — the result is the same for every user.

---

### Flag 2: `extended-color-palette` — Percentage

**Type:** `percentage`

**What it controls:** Which color palette a user sees. Users below the rollout threshold get the **basic palette** (5 colors); users in the rollout get the **extended palette** (12 colors, including less common options like `coral`, `teal`, `lavender`).

**Basic palette:** `red`, `blue`, `green`, `yellow`, `purple`
**Extended palette:** all of the above plus `coral`, `teal`, `lavender`, `orange`, `pink`, `gold`, `navy`

**Demo value:** The sticky bucketing of the percentage evaluator means the same user always lands in the same cohort — you can show two different users seeing different available colors, then slide the percentage up to "promote" more users into the extended palette.

**SDK usage:**
```ts
const extended = await flags.evaluate("extended-color-palette", { userId: user.id });
```

**Validation:** `PATCH` rejects a `favoriteColor` that is in the extended palette if the user is not in the extended rollout.

---

### Flag 3: `pro-number-range` — User Segmented

**Type:** `user_segmented`

**What it controls:** The allowed range for `favoriteNumber`.

| User plan | Allowed range |
|---|---|
| `pro` | 0 – 100 |
| `basic` | 0 – 50 |
| `free` | 0 – 10 |

This is implemented as two flags or a single flag returning `true` for pro users and the evaluation logic branching — the simplest approach is a single flag where `result: true` means "full range" (0–100), and `result: false` means "restricted range". The restricted range is then determined by the plan stored on the user record directly (no flag needed for that split).

**Segment configuration:**
```
segments:
  - attribute: plan, operator: eq, values: ["pro"], result: true
defaultValue: false
```

**Demo value:** Upgrade a user's plan via `PATCH /users/:id/preferences`, then call `GET /users/:id/options` again — the allowed number range changes immediately because the flag re-evaluates against the new `plan` attribute.

**SDK usage:**
```ts
const fullRange = await flags.evaluate("pro-number-range", {
  userId: user.id,
  attributes: { plan: user.plan },
});
const max = fullRange ? 100 : user.plan === "basic" ? 50 : 10;
```

---

## SDK Integration

The `CachedFlagEvaluator` is created once at the module level in `src/flags.ts` and imported wherever flag evaluation is needed. This is the recommended singleton pattern for server-side Node.js applications.

```ts
// src/flags.ts
import { FeatureFlagClient, CachedFlagEvaluator } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: process.env.FLAGS_API_URL!,
  apiKey: process.env.FLAGS_API_KEY!,
});

export const flags = new CachedFlagEvaluator({
  client,
  ttl: 30_000,
});
```

The evaluator is warmed at startup (in `src/index.ts`) to avoid a cold cache on the first request:

```ts
// src/index.ts
await connectToMongo(MONGO_URI);
await flags.warm();        // pre-populate cache before accepting traffic
app.listen(PORT, ...);
```

---

## Dependencies

### Runtime

| Package | Purpose |
|---|---|
| `express` | HTTP server framework |
| `mongodb` | Native MongoDB driver (no Mongoose) |
| `zod` | Request body validation |
| `@feature-flags/ts-sdk` | `FeatureFlagClient` and `CachedFlagEvaluator` (workspace package) |

### Dev / Test

| Package | Purpose |
|---|---|
| `vitest` | Test runner |
| `supertest` | HTTP integration testing against the Express app |
| `mongodb-memory-server` | In-process MongoDB for tests |
| `tsx` | TypeScript execution for `dev` script |
| `typescript` | Compiler |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3002` | HTTP port |
| `MONGO_URI` | No | `mongodb://localhost:27017/demo_app` | MongoDB connection string |
| `FLAGS_API_URL` | Yes | — | Base URL of the feature flags API (`apps/api`) |
| `FLAGS_API_KEY` | Yes | — | `ff_` prefixed API key for the feature flags API |

---

## Demo Walkthrough

The intended demo flow that exercises all three flag types:

1. **Register two users** — username `alice` (free plan) and username `bob` (pro plan).

2. **Boolean flag off** — Disable `show-favorite-number`. Call `GET /users/alice` and `GET /users/bob` — `favoriteNumber` is absent for both. Toggle it on — both profiles now include the field.

3. **Percentage flag** — Set `extended-color-palette` to 50%. Call `GET /users/:id/options` for several users. Some get 5 colors, some get 12, and the split is sticky (same user always gets the same result).

4. **Segmented flag** — Call `GET /users/alice/options` (free plan) — max number is 10. Upgrade Alice to pro via `PATCH /users/alice/preferences { "plan": "pro" }`. Call `GET /users/alice/options` again — max number is now 100, because the flag re-evaluates with the updated `plan` attribute.

5. **Validator enforcement** — Attempt `PATCH /users/alice/preferences { "favoriteNumber": 75 }` with Alice on the free plan — returns `400`. Upgrade to pro, retry — returns `200`.

---

## Testing

Unit/integration tests mock the `CachedFlagEvaluator` entirely — the flag behavior is tested in `packages/ts-sdk`, not here. Tests for this app focus on verifying that the API correctly gates behavior on the flag result (true vs false), not on the flag logic itself.

```ts
// Mock the flags singleton
vi.mock("../../src/flags.js", () => ({
  flags: {
    evaluate: vi.fn(),
  },
}));
```

Each test that touches a flag explicitly sets the mock return value, making flag states explicit and the tests readable.
