> **Historical.** This documents the SaaS build-out below before Scout was re-scoped as a personal
> research project (no live deployment, no customers). Kept for the engineering history / as
> background for a PhD application write-up - not a description of anything currently operated.

# Scout SaaS-ification -- Master Spec
# Date: 26 July 2026 (updated 27 July 2026)
# Goal: Convert Scout from embedded Carina module to standalone SaaS product

## Current Architecture Problem

Scout-engine lived inside Propreneur v2 (`propreneur-v2/02-backends/scout-engine/`) with integrations tangled inside Carina. The SaaS extract lives at `<workspace-root>/scout/`.

## Target Architecture

```
<workspace-root>/
├── carina/                          # Agent OS platform
├── scout/                           # Standalone Scout SaaS
│   ├── scout-engine/                # Engine + public /v1 + dashboard/billing APIs
│   ├── scout-dashboard/             # Customer-facing Next.js dashboard
│   └── scout-sdk/                   # @scout-security/client + Python helper
└── propreneur/propreneur-v2/        # Carina points to Scout via HTTP
```

## Separation Strategy

1. Isolate scout-engine under `<workspace-root>/scout/scout-engine/`
2. Add multi-tenancy via organizations + organization_id (workspace model retained)
3. Public API gateway with API key auth at `/v1`
4. Customer dashboard (Next.js)
5. Stripe Checkout for Monitor / Govern / Team (SoT price IDs)
6. Keep Carina integration via HTTP (`@verlox/carina-scout`)

## Stripe Billing Integration

Plans (source of truth: `<workspace-root>/.access/.stripe-credentials-and-price-id.md`; do not create new prices):
- Free: 1 agent, basic prompt filtering, 7-day history
- Monitor (£99/mo): 5 agents, full filtering, kill switch, alerts, 90-day history
- Govern (£199/mo): 20 agents, deeper monitoring, audit logs
- Team (£399/mo): 50 agents, team dashboard, SSO, priority support

## Public API (`/v1`)

```
POST   /v1/agents/register
POST   /v1/prompts/filter
GET    /v1/agents/:id/status
POST   /v1/events
GET    /v1/health
```

Auth: `Authorization: Bearer sk_live_...` or `X-Scout-Key`.

## Build Sequence (6 Prompts)

All COMPLETED 2026-07-27. Archived under:
`carina/01-devends/prompts-library/02-archived_prompts/archives_from_pending_prompts/scout-prompts/`
