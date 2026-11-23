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
- `/dashboard/agents`, `/dashboard/agents/[id]` - agent list and detail with tools, event timeline, per-agent kill switch and resume, and a blockchain-identity panel
- `/dashboard/alerts` - filterable alert list with resolve action
- `/dashboard/scores` - score trend chart and category breakdown
- `/dashboard/api-keys` - create, list (prefix only), and revoke API keys
- `/dashboard/settings` - organization info, account password, kill switch and security policy, trusted operator channels, plan upgrade (Free / Monitor / Govern / Team), manage billing
- `/dashboard/governance`, `.../decisions`, `.../decisions/[uid]`, `.../policies`, `.../grants`, `.../incidents` - OpenShell governance evidence, proxied through the engine after login
- `/onboarding` - generate first API key, Node/Python snippets, link to agents
- `/docs` - getting started, API reference, SDK, security concepts, plans, FAQ

## Operator controls

These pages call `/api/dashboard/*` with the dashboard session JWT (`Authorization: Bearer <jwt>`). `POST /api/dashboard/auth/signup` and `POST /api/dashboard/auth/login` issue that token. Every later `/api/dashboard` route requires it.

**Account password** (`PUT /api/dashboard/account/password`). Body is `{ "current_password", "new_password" }`. The current password is checked with the same bcrypt compare as login. `new_password` must be at least 8 characters; the Settings form also requires the confirmation field to match, but the API does not receive that confirmation. A wrong current password is `401`. Success is `{ "success": true }`.

**Kill switch and security policy** (Settings). Three separate mechanisms, all enforced in `scout-engine/src/control/agent-control.ts`. `/v1` calls `assertAgentRunnable`, which reads the org-wide flag and then the agent row:

| Control | What it changes | Dashboard route |
|---|---|---|
| Per-agent suspend | Sets that agent's `status` to `suspended` and records `suspension_reason` | `POST /api/dashboard/killswitch/:agentId` with optional `{ "reason" }` |
| Per-agent resume | Sets that agent's `status` back to `offline` and clears the suspension fields | `POST /api/dashboard/agents/:id/resume` |
| Global kill | Sets `organizations.global_kill_active`. Does not rewrite agent rows | `POST /api/dashboard/killswitch/global` with optional `{ "reason" }` |
| Global resume | Clears the org flag only. Individually suspended agents stay suspended | `POST /api/dashboard/killswitch/global/resume` |

The audit list is `GET /api/dashboard/killswitch/events` (default 50, max 200).

The suspend, resume, and global routes are gated by `requirePlanFeature('killswitch')`. The `free` plan returns `403` with `error: "plan_limit"`. `monitor`, `govern`, and `team` allow them (`scout-engine/src/lib/plans.ts`).

**Auto-kill threshold** is saved with `PATCH /api/dashboard/org` as `auto_kill_threshold`: a positive integer, or `null` to disable. That handler is not plan-gated. When set, `POST /v1/prompts/filter` counts `blocked` verdicts whose `risk_level` is `critical` inside a rolling 15-minute window (`AUTO_KILL_WINDOW_MINUTES` in `agent-control.ts`). Reaching the threshold suspends that agent with `kill_source: "policy"`. Flagged or non-critical blocks do not count. The filter response includes `agent_auto_killed`.

**Require on-chain identity** is the same `PATCH /api/dashboard/org` body field, `require_onchain_identity` (boolean). See `scout-sdk/README.md` for the signature envelope `/v1/events` and `/v1/prompts/filter` then require.

**Trusted operator channels** (`GET`/`PUT /api/dashboard/settings/alerts`). Values live on `workspace_settings` for the organization's first workspace. `GET` returns `{ alert_email, telegram_chat_id, slack_webhook_url }`. `PUT` accepts those three strings, keeps any field that was omitted or not a string, and returns `{ settings }` (the stored row). `404` if the org has no workspace. The dashboard calls this path. The same field names also exist on `apiRouter` in `src/api/index.ts`, and that router is attached only from `src/index.ts`. The image runs `node dist/server.js` (`src/server.ts`).

**Governance pages** call `/api/dashboard/governance/*`, which the engine proxies to `SCOUT_GOVERNANCE_API_URL` (default `http://localhost:18080`). If that service is down the UI shows "Could not reach the governance service." Revoking a grant requires a note; the engine sets `author` from the session and does not accept a client-supplied author. Revoke closes Scout's grant row. It does not detach the underlying OpenShell capability (`liveCapabilityDetachAttempted` stays false). Every organization sees the same governance data: the service's tenant id is the fixed placeholder `"default"`.

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
