# CLAUDE.md — Flag Evaluation (`packages/flag-evaluation`)

## Overview

A zero-dependency TypeScript package containing the canonical flag evaluation logic shared between the API (`apps/api`) and the SDK (`packages/ts-sdk`). Both consumers import `evaluate()` and the flag type definitions from here.

**Why shared?** If the API and SDK each maintain their own copy of the evaluation logic, they can silently diverge. A flag evaluating `true` server-side but `false` in the SDK would be a correctness bug with no error signal — the worst kind. A single shared package makes this class of bug impossible.

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript | Matches monorepo convention |
| Runtime | Node.js | Consumers are Node-only (v1 scope) |
| Dependencies | None | Pure logic — no runtime deps, just `crypto` from Node stdlib |
| Bundler | `tsup` | Zero-config dual CJS/ESM output, consistent with other packages |
| Test runner | Vitest | Consistent with monorepo |

---

## Project Structure

```
packages/flag-evaluation/
├── src/
│   ├── index.ts      # Public exports
│   ├── evaluate.ts   # evaluate(definition, context) — pure, no I/O
│   └── types.ts      # FlagDefinition, EvaluationContext, rule types
├── tests/
│   └── evaluate.test.ts
├── package.json      # name: @feature-flags/flag-evaluation
├── tsconfig.json
├── vitest.config.ts
└── CLAUDE.md
```

---

## Public API

### `evaluate(definition, context?)`

The single exported function. Pure — no I/O, no side effects.

```ts
import { evaluate } from '@feature-flags/flag-evaluation';

const result: boolean = evaluate(definition, context);
```

Signature:

```ts
function evaluate(definition: FlagDefinition, context?: EvaluationContext): boolean
```

### Types

```ts
type FlagDefinition =
  | { key: string; type: 'boolean';        rules: BooleanRules }
  | { key: string; type: 'percentage';     rules: PercentageRules }
  | { key: string; type: 'user_segmented'; rules: UserSegmentedRules };

interface EvaluationContext {
  userId?: string;
  attributes?: Record<string, string>;
}

interface BooleanRules      { enabled: boolean }
interface PercentageRules   { percentage: number }  // 0–100
interface UserSegmentedRules {
  segments: Segment[];
  defaultValue: boolean;
}

interface Segment {
  attribute: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'regex';
  values: string[];
  result: boolean;
}
```

---

## Evaluation Semantics

| Flag type | Context needed | Logic |
|---|---|---|
| `boolean` | None | Returns `rules.enabled` directly |
| `percentage` | `userId` | SHA-256 hash of `"userId:flagKey"`, take first 8 hex chars as 32-bit int, `% 100 < percentage` |
| `user_segmented` | `attributes` | Walk `segments` in order; first match wins; fall back to `defaultValue` |

### Percentage hash algorithm

```
bucket = parseInt(sha256("userId:flagKey").slice(0, 8), 16) % 100
enabled = bucket < percentage
```

This is deterministic and sticky — the same `(userId, flagKey)` pair always lands in the same bucket. The `flagKey` is included in the hash input so users don't get the same bucket across different flags.

**Important:** This algorithm must not change once flags are in production. Changing the hash function would reassign all users to different buckets, breaking the stickiness guarantee. Any change requires a documented migration.

### Segment operator semantics

| Operator | Match condition |
|---|---|
| `eq` | `value === values[0]` |
| `neq` | `value !== values[0]` |
| `in` | `values.includes(value)` |
| `not_in` | `!values.includes(value)` |
| `contains` | `value.includes(values[0])` |
| `regex` | `new RegExp(values[0]).test(value)` |

A missing attribute (not present in `context.attributes`) always results in no-match for that segment.

---

## Dependency Graph

```
packages/flag-evaluation   ← this package; no runtime deps
         ↑           ↑
  apps/api      packages/ts-sdk
```

`apps/api` uses this for server-side evaluation (the `/flags/:key/evaluate` endpoint).
`packages/ts-sdk` will use this for client-side evaluation in `CachedFlagEvaluator`.

---

## API Compatibility Note

`apps/api` stores flags as the `Flag` type (which includes metadata: `id`, `name`, `description`, `createdAt`, `updatedAt`). TypeScript structural typing means a `Flag` is assignable to `FlagDefinition` — the extra fields are ignored by `evaluate()`. No cast is required.

---

## Testing

Unit tests only — the function is pure so no mocking is needed.

```
tests/evaluate.test.ts — 18 tests covering all flag types and segment operators
```

Run:

```bash
pnpm test         # from this package directory
pnpm --filter @feature-flags/flag-evaluation test   # from monorepo root
```

### What is tested

- Boolean: enabled/disabled, context ignored
- Percentage: missing userId → false, 100% → always true, 0% → always false, determinism, key isolation
- User segmented: defaultValue fallback, first-match-wins, missing attribute, all 6 operators

---

## What Is Out of Scope

| Concern | Notes |
|---|---|
| Zod validation | Consumers (API) own their own input validation. This package trusts its inputs. |
| Browser / WebCrypto | Node.js `crypto` only. If browser support is added, `createHash` must switch to `SubtleCrypto`. |
| Schema management | Flag definitions are fetched and stored by consumers, not this package. |
