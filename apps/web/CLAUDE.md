# CLAUDE.md — Frontend (`apps/web`)

## Overview

React + TypeScript single-page application for managing feature flags. Provides a dashboard UI for CRUD operations on flags and API keys. Authenticates via Clerk (matching the backend's JWT middleware) and talks to `apps/api` over HTTP.

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Runtime | React 19 + TypeScript | Already scaffolded; React 19 stable |
| Build tool | Vite | Already configured |
| Routing | React Router v7 | File-based or component routing, well-supported with Vite |
| Auth | `@clerk/clerk-react` | Matches the backend's Clerk JWT auth — same provider, zero extra plumbing |
| Server state | TanStack Query (React Query v5) | Caching, background refetch, loading/error states without manual `useEffect` |
| Forms | React Hook Form + Zod | Mirrors the backend's Zod schemas; `zodResolver` bridges the two |
| UI components | MUI (Material UI v6) | Comprehensive component library with built-in theming, no extra CSS setup needed |
| HTTP | native `fetch` (thin wrapper) | No dependency needed; typed wrapper in `src/lib/api.ts` handles auth headers |

---

## Project Structure

```
apps/web/
├── src/
│   ├── main.tsx                        # Entry point — ClerkProvider, QueryClientProvider, RouterProvider
│   ├── App.tsx                         # Root route layout (nav, auth guard)
│   │
│   ├── lib/
│   │   ├── api.ts                      # Typed fetch wrapper — attaches Clerk JWT to every request
│   │   └── utils.ts                    # cn() helper (clsx + tailwind-merge), misc utilities
│   │
│   ├── types/
│   │   └── flag.ts                     # TypeScript types mirroring the backend's flag discriminated union
│   │
│   ├── hooks/
│   │   └── useFlags.ts                 # TanStack Query hooks: useFlags, useFlag, useCreateFlag, etc.
│   │
│   ├── components/
│   │   ├── theme.ts                    # MUI createTheme() — colours, typography, component overrides
│   │   └── Layout/
│   │       ├── AppShell.tsx            # Top nav + sidebar wrapper
│   │       └── PageHeader.tsx          # Consistent page title + action slot
│   │
│   ├── features/
│   │   ├── flags/
│   │   │   ├── FlagListPage.tsx        # /flags — table of all flags with type filter
│   │   │   ├── FlagDetailPage.tsx      # /flags/:key — view + edit a flag
│   │   │   ├── CreateFlagPage.tsx      # /flags/new — multi-step form, type selector first
│   │   │   ├── FlagTable.tsx           # Reusable flag list table component
│   │   │   ├── FlagForm/
│   │   │   │   ├── FlagForm.tsx        # Top-level form — renders rule fields based on selected type
│   │   │   │   ├── BooleanRuleFields.tsx
│   │   │   │   ├── PercentageRuleFields.tsx
│   │   │   │   └── UserSegmentedRuleFields.tsx
│   │   │   └── EvaluatePanel.tsx       # Inline test panel: send context, see result
│   │   │
│   │   └── api-keys/
│   │       ├── ApiKeyListPage.tsx      # /api-keys — table of keys (no hash/plaintext shown)
│   │       └── CreateApiKeyDialog.tsx  # Modal: create key, show plaintext once with copy button
│   │
│   └── router.tsx                      # Route definitions (React Router)
│
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── CLAUDE.md
└── package.json
```

---

## Auth

The frontend authenticates users via Clerk. The `@clerk/clerk-react` SDK handles the login/session flow. Every API request attaches the active session's JWT as a Bearer token:

```ts
// src/lib/api.ts
import { useAuth } from "@clerk/clerk-react";

export function useApiClient() {
  const { getToken } = useAuth();

  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };
}
```

The `<ClerkProvider>` wraps the entire app in `main.tsx`. Routes that require auth are wrapped with Clerk's `<SignedIn>` / `<RedirectToSignIn>` guards.

---

## Data Model (Frontend Types)

Types mirror the backend discriminated union exactly. Keep these in sync with `apps/api/src/schemas/flag.schema.ts`.

```ts
// src/types/flag.ts

export interface FlagBase {
  id: string;
  key: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export type BooleanFlag = FlagBase & {
  type: "boolean";
  rules: { enabled: boolean };
};

export type PercentageFlag = FlagBase & {
  type: "percentage";
  rules: { percentage: number };
};

export type UserSegmentedFlag = FlagBase & {
  type: "user_segmented";
  rules: {
    segments: Array<{
      attribute: string;
      operator: "eq" | "neq" | "in" | "not_in" | "contains" | "regex";
      values: string[];
      result: boolean;
    }>;
    defaultValue: boolean;
  };
};

export type Flag = BooleanFlag | PercentageFlag | UserSegmentedFlag;

export interface ApiKey {
  _id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}
```

---

## Data Fetching

TanStack Query manages all server state. Query hooks live in `src/hooks/useFlags.ts` and compose `useApiClient()`.

```ts
// src/hooks/useFlags.ts
export function useFlags(type?: Flag["type"]) {
  const api = useApiClient();
  return useQuery({
    queryKey: ["flags", type],
    queryFn: () => api<Flag[]>(`/flags${type ? `?type=${type}` : ""}`),
  });
}

export function useCreateFlag() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<Flag, "id" | "createdAt" | "updatedAt">) =>
      api<Flag>("/flags", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flags"] }),
  });
}
```

---

## Forms

React Hook Form + Zod handles all flag creation/editing. The form schema mirrors the backend Zod schemas so validation errors are consistent. The top-level `FlagForm` renders different rule field components based on the selected `type`.

```ts
// Zod schema for boolean flag (mirrors backend)
const booleanFlagSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  type: z.literal("boolean"),
  rules: z.object({ enabled: z.boolean() }),
});
```

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base URL for the API, e.g. `http://localhost:3000` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key — safe to expose in the browser |

Both must be present in a `.env.local` file (not committed).

---

## Pages & Routes

| Path | Component | Auth required |
|---|---|---|
| `/` | Redirect → `/flags` | No |
| `/flags` | `FlagListPage` | No |
| `/flags/new` | `CreateFlagPage` | Yes |
| `/flags/:key` | `FlagDetailPage` | Yes |
| `/api-keys` | `ApiKeyListPage` | Yes |
| `/sign-in` | Clerk `<SignIn>` | No |
