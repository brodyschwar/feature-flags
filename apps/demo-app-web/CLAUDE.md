# CLAUDE.md — Demo App Web (`apps/demo-app-web`)

## Overview

A React frontend for the demo user-preferences application. It pairs with `apps/demo-app-api` to provide a visual, interactive showcase of all three feature flag types. Every interesting UI behaviour — which form fields appear, what options are available, what validation rules apply — is driven by flags evaluated on the backend.

The frontend deliberately has no auth. Users register with just a username and are identified by their MongoDB ID (exposed in the URL and shown prominently after registration).

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) | Matches monorepo convention |
| Framework | React 19 | Matches `apps/web` |
| Build tool | Vite | Matches `apps/web` |
| UI library | Material UI v7 | Matches `apps/web` |
| Server state | TanStack Query v5 | Matches `apps/web` |
| Forms | React Hook Form + Zod | Matches `apps/web` |
| Routing | React Router v7 | Matches `apps/web` |
| Auth | None | Demo app; no identity requirements |

---

## Project Structure

```
apps/demo-app-web/
├── src/
│   ├── main.tsx                        # Entry — QueryClient, ThemeProvider, RouterProvider
│   ├── router.tsx                      # Route definitions
│   ├── lib/
│   │   └── api.ts                      # Typed fetch wrapper (no auth)
│   ├── types/
│   │   └── user.ts                     # User and UserOptions types
│   ├── hooks/
│   │   └── useUser.ts                  # TanStack Query hooks for user endpoints
│   └── features/
│       ├── register/
│       │   └── RegisterPage.tsx        # Username form; redirects to /users/:id
│       └── profile/
│           ├── ProfilePage.tsx         # Shell — fetches user + options, renders below
│           ├── PreferencesForm.tsx     # Editable form gated by options
│           └── OptionsPanel.tsx        # Read-only panel showing current flag state
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
└── package.json
```

---

## Pages

### `/` — Register

A minimal form. The user enters a username; on submit the API creates the user and the app navigates to `/users/:id`. A secondary section lets users enter an existing ID to jump back to a profile (useful after closing and reopening the browser during a demo).

### `/users/:id` — Profile

The main demo screen. Two cards side-by-side (stacked on mobile):

**Preferences card (left)**
Controlled by the data from `GET /users/:id/options`:
- **Plan** — always visible; select between `free`, `basic`, `pro`
- **Favorite Color** — always visible; rendered as clickable color swatches (the count depends on the `extended-color-palette` flag)
- **Favorite Number** — only rendered when `favoriteNumberEnabled` is `true`; MUI Slider with `min`/`max` from `favoriteNumberRange`

**Flag State card (right)**
A read-only debug panel that directly reflects the raw `GET /users/:id/options` response:
- Favorite number enabled: ✓ / ✗
- Number range: 0 – N
- Available colors: swatches

This panel is the visual proof that the flags are working. During a demo you toggle a flag in the admin dashboard, click **Refresh**, and both the form and the panel update to reflect the new state.

A **Refresh** button at the top of the profile page manually re-fetches both queries. TanStack Query also re-fetches automatically on window focus so switching back from the admin dashboard triggers a refresh.

---

## Data Flow

```
GET /users/:id          → useUser(id)         → ProfilePage → PreferencesForm
GET /users/:id/options  → useUserOptions(id)  → ProfilePage → PreferencesForm + OptionsPanel
PATCH /users/:id/preferences → useUpdatePreferences(id) → PreferencesForm submit
```

When `useUpdatePreferences` succeeds:
- `user` query cache is updated with the returned value
- `user-options` query is invalidated and re-fetched (plan change may alter number range)

---

## Flag Scenarios — How They Appear in the UI

| Flag | Effect on UI |
|---|---|
| `show-favorite-number` off | Slider is hidden; options panel shows "Disabled" |
| `show-favorite-number` on | Slider appears with range from `favoriteNumberRange` |
| `extended-color-palette` off | 5 color swatches in form and panel |
| `extended-color-palette` on | 12 color swatches |
| `pro-number-range` (plan=free) | Slider max = 10 |
| `pro-number-range` (plan=basic) | Slider max = 50 |
| `pro-number-range` (plan=pro) | Slider max = 100 |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_DEMO_API_URL` | No | `http://localhost:3002` | Base URL of `apps/demo-app-api` |

---

## Dependencies

### Runtime

| Package | Purpose |
|---|---|
| `react` / `react-dom` | UI framework |
| `@mui/material` / `@mui/icons-material` | Component library and icons |
| `@emotion/react` / `@emotion/styled` | MUI CSS-in-JS runtime |
| `@tanstack/react-query` | Server state management |
| `react-router` | Client-side routing |
| `react-hook-form` | Form state management |
| `@hookform/resolvers` | Bridges React Hook Form ↔ Zod |
| `zod` | Schema validation |

### Dev

| Package | Purpose |
|---|---|
| `vite` / `@vitejs/plugin-react` | Build tooling |
| `typescript` | Compiler |
| `@types/react` / `@types/react-dom` | Type definitions |
