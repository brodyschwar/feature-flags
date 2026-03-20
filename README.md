# Feature Flags

A self-hosted feature flag platform with a management dashboard, REST API, and TypeScript SDK. Supports boolean, percentage rollout, and user-segmented flags with real-time propagation via SSE.

→ [Architecture](./Architecture.md) — design decisions, tradeoffs, and infrastructure

---

## What's in the repo

```
apps/
├── api            — Express REST API (flag CRUD, evaluation, SSE stream)
├── web            — React admin dashboard
├── demo-app-api   — Example Express service using the SDK
└── demo-app-web   — Example React frontend for the demo service

packages/
├── flag-evaluation — Shared pure evaluation logic (no I/O)
└── ts-sdk          — TypeScript SDK for Node.js consumers
```

---

## Prerequisites

- **Node.js 18+**
- **pnpm 8+** — `npm install -g pnpm`
- A **MongoDB** instance — [MongoDB Atlas](https://www.mongodb.com/atlas) free tier works
- A **Clerk** account — [clerk.com](https://clerk.com) free tier works

---

## First-time setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Build the shared packages

The API and SDK both depend on `packages/flag-evaluation`. Build both packages before running any app:

```bash
pnpm build:packages
```

### 3. Configure environment variables

Each app needs its own env file. Templates are shown below — copy them to the paths listed and fill in your values.

#### `apps/api/.env`

```env
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
PORT=3001
CORS_ORIGIN=http://localhost:5173
CLERK_JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json
```

| Variable | Where to find it |
|---|---|
| `MONGO_URI` | Atlas → your cluster → Connect → Drivers |
| `CLERK_JWKS_URL` | Clerk dashboard → API Keys → Advanced → JWKS URL |

#### `apps/web/.env.local`

```env
VITE_API_URL=http://localhost:3001
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_JWKS_URL=https://<your-clerk-domain>/.well-known/jwks.json
```

| Variable | Where to find it |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys → Publishable key |
| `CLERK_JWKS_URL` | Same as above |

### 4. Start the API and dashboard

In separate terminals:

```bash
pnpm dev:api    # http://localhost:3001
pnpm dev:web    # http://localhost:5173
```

Open the dashboard at `http://localhost:5173`. Sign in with Clerk to create flags and API keys.

---

## Running the demo app

The demo is a standalone Express + React application that showcases the SDK with all three flag types. It requires the API to be running first.

### 1. Create an API key

In the dashboard (`/api-keys`), create a new key. Copy the plaintext value — it is shown only once.

### 2. Create the three demo flags

In the dashboard, create these flags with the exact keys shown:

| Key | Type | Rules |
|---|---|---|
| `show-favorite-number` | Boolean | `enabled: true` |
| `extended-color-palette` | Percentage | `percentage: 50` |
| `pro-number-range` | User Segmented | Segment: `attribute: plan`, `operator: eq`, `values: ["pro"]`, `result: true` — default: `false` |

### 3. Configure the demo API

Create `apps/demo-app-api/.env`:

```env
PORT=3002
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
FLAGS_API_URL=http://localhost:3001
FLAGS_API_KEY=ff_<your-key-from-step-1>
```

### 4. Configure the demo web app

Create `apps/demo-app-web/.env.local`:

```env
VITE_DEMO_API_URL=http://localhost:3002
```

### 5. Start the demo

In separate terminals:

```bash
pnpm dev:demo-api    # http://localhost:3002
pnpm dev:demo-web    # http://localhost:5174
```

Open `http://localhost:5174` to interact with the demo. Toggle flags in the dashboard and observe the effects in the demo UI within seconds (the demo API uses live updates via SSE).

---

## Development commands

| Command | Description |
|---|---|
| `pnpm dev:api` | Start the flags API in watch mode |
| `pnpm dev:web` | Start the admin dashboard in watch mode |
| `pnpm dev:demo-api` | Start the demo API in watch mode |
| `pnpm dev:demo-web` | Start the demo frontend in watch mode |
| `pnpm build:packages` | Build `flag-evaluation` then `ts-sdk` in dependency order |
| `pnpm build:flag-evaluation` | Build the shared evaluation package |
| `pnpm build:sdk` | Build the TypeScript SDK |
| `pnpm test:api` | Run the API test suite |
| `pnpm test:sdk` | Run the SDK test suite |
| `pnpm test:flag-evaluation` | Run the flag-evaluation test suite |

---

## Using the SDK

```bash
pnpm add @feature-flags/ts-sdk
```

### Quick start

```ts
import { FeatureFlagClient, CachedFlagEvaluator } from "@feature-flags/ts-sdk";

const client = new FeatureFlagClient({
  baseUrl: "https://your-flags-api.com",
  apiKey: "ff_...",
});

// Single HTTP call per evaluation — good for low-traffic services
const enabled = await client.evaluate("my-flag", {
  userId: "user_123",
  attributes: { plan: "pro" },
});
```

### Recommended: local evaluation with caching

```ts
// Create once at module level — not per request
const evaluator = new CachedFlagEvaluator({
  client,
  flags: ["my-flag", "another-flag"] as const,  // `as const` gives compile-time key checking
  ttl: 300_000,       // 5-minute TTL backstop
  liveUpdates: true,  // real-time updates via SSE
});

// Warm the cache at startup
await evaluator.warm();

// Evaluate locally — no HTTP call if the cache is warm and fresh
const enabled = await evaluator.evaluate("my-flag", {
  userId: "user_123",
  attributes: { plan: "pro" },
});

// On graceful shutdown
evaluator.disconnect();
```

Passing an unknown flag key is a **compile-time error** — the `flags` array with `as const` constrains the keys TypeScript will accept.

For full SDK documentation see [`packages/ts-sdk/CLAUDE.md`](./packages/ts-sdk/CLAUDE.md).

---

## Further reading

- [Architecture](./Architecture.md) — system design, tech stack decisions, and known limitations
- [`apps/api/CLAUDE.md`](./apps/api/CLAUDE.md) — API routes, data model, auth, and testing
- [`packages/ts-sdk/CLAUDE.md`](./packages/ts-sdk/CLAUDE.md) — SDK public API and caching behaviour
- [`apps/demo-app-api/CLAUDE.md`](./apps/demo-app-api/CLAUDE.md) — demo app walkthrough and flag scenarios
