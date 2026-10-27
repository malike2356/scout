# Scout

A runtime security/governance engine for AI agents: prompt filtering, event ingest, posture
scoring, alerting, and a kill switch for agents that misbehave. Originally built out as a
commercial SaaS product (see `docs/history/saas-spec-master.md` for that build-out's spec and
history); it is now a personal research project being written up for a PhD application.

## What it does

- Filters prompts before an agent acts (`POST /v1/prompts/filter`)
- Ingests tool/runtime events (`POST /v1/events`)
- Ingests redacted repository secret-scan envelopes (`POST /v1/repository-secret-scans`)
- Shows agents, alerts, scores, and repository security posture in a dashboard
- Enforces a kill switch: suspended agents get HTTP 403 `kill_switch` on filter/events

## Research

Scout studies detection under an adaptive adversary: how much of a hostile agent's behaviour can
be identified from prompts, tool calls and runtime events before damage is done, and how quickly
a classifier degrades once the adversary knows it is being classified. That is the same shape of
problem as coordinated inauthentic behaviour and socio-cognitive threat detection, aimed at an AI
agent's own actions rather than at human-run social media accounts; Scout does not do social media
or network analysis, and makes no claim to.

Status: the engine is functional and not deployed. A dedicated adversarial-evaluation artefact,
testing detection against public coordinated-behaviour datasets, is planned as a separate
repository; nothing from that work exists yet, and this README will be updated once it does.

## Local run

```bash
cd scout-engine
docker compose up -d
cp .env.example .env
pnpm install && pnpm migrate
./node_modules/.bin/tsx src/server.ts   # :4444

cd ../scout-dashboard
cp .env.example .env.local
pnpm install && pnpm build && pnpm start # :3005

cd ../scout-sdk && npm install && npm run build
```

## E2E

```bash
cd <workspace-root>/scout
SCOUT_API_BASE=http://localhost:4444 SCOUT_E2E_ALLOW_PLAN_OVERRIDE=true bash scripts/e2e-pilot.sh
```

## Status

Not deployed anywhere. The multi-tenant/billing layer (`scout-engine/src/api/billing.ts`,
`webhooks/stripe.ts`, `lib/plans.ts`, `middleware/plan-enforce.ts`, `scout-dashboard`'s
signup/onboarding pages) is left in place as-built but unused - it's part of the engineering
history of the project, not something currently offered or sold. See `docs/history/` for the
original SaaS-ification spec.
