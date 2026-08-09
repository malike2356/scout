# scout-dashboard

Customer-facing dashboard for Scout, built with Next.js App Router, TypeScript, and Tailwind CSS.

## Requirements

- Node.js 18.18+ (Node 20+ recommended)
- pnpm (or npm/yarn)
- A running `scout-engine` instance exposing `/api/dashboard/*` and `/api/billing/*`

## Setup

```bash
cd scout/scout-dashboard
cp .env.example .env.local
pnpm install
pnpm dev
```

The app runs on `http://localhost:3005` (set in `package.json`'s `dev` script).

`NEXT_PUBLIC_SCOUT_API_URL` controls which engine the dashboard talks to. It defaults to
`http://localhost:4444` if unset.

## Pages

- `/` - redirects to `/dashboard` if signed in, otherwise `/login`
- `/login`, `/signup` - auth against `/api/dashboard/auth/*`
- `/dashboard` - overview: agents online, alerts today, security score, API calls, score trend, recent alerts
- `/dashboard/agents`, `/dashboard/agents/[id]` - agent list and detail with tools, event timeline, kill switch
- `/dashboard/alerts` - filterable alert list with resolve action
- `/dashboard/scores` - score trend chart and category breakdown
- `/dashboard/api-keys` - create, list (prefix only), and revoke API keys
- `/dashboard/settings` - organization info, plan upgrade (Free / Monitor / Govern / Team), manage billing
- `/onboarding` - generate first API key, Node/Python snippets, link to agents
- `/docs` - getting started, API reference, SDK, security concepts, plans, FAQ

## Notes

- Auth token and organization are stored in `localStorage` (see `src/lib/api.ts`, `src/lib/auth.tsx`).
- All API responses are read defensively (optional chaining, `unwrapList`) so the UI stays usable
  even if the engine's response shape shifts slightly during parallel development.
- Design uses CSS variables defined in `src/app/globals.css` for a dark slate and teal industrial
  security look. No purple-on-white AI cliches, no emojis.
- Desktop-first; the layout assumes at least a 1024px wide viewport.

## Build

```bash
pnpm build
pnpm start
```
