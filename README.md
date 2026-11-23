# Scout

A runtime security/governance engine for AI agents: prompt filtering, event ingest, posture
scoring, alerting, and a kill switch for agents that misbehave. Originally built out as a
commercial SaaS product; it is now a personal research project being written up for a PhD
application.

## What it does

- Filters prompts before an agent acts (`POST /v1/prompts/filter`)
- Ingests tool/runtime events (`POST /v1/events`)
- Ingests redacted repository secret-scan envelopes (`POST /v1/repository-secret-scans`)
- Shows agents, alerts, scores, and repository security posture in a dashboard
- Enforces a kill switch at three levels: per-agent (dashboard/admin API),
  organization-wide (one flag blocks every agent instantly), and
  policy-triggered (auto-suspends an agent after repeated critical
  prompt-injection blocks) - unified in one audited path
  (`scout-engine/src/control/agent-control.ts`)
- Gives each agent a verifiable cryptographic identity, anchored in a
  purpose-built registry contract (`scout-chain/`) on the Sepolia testnet,
  closing the gap where any caller holding an org's API key could
  otherwise submit events/prompts as any agent under it

## Read next

The bullets above are the map. The contracts and the pitfalls live in the package READMEs:

- Dashboard pages, password change, alert channels, and kill-switch controls: `scout-dashboard/README.md`
- Client registration, signed requests, and `kill_switch` / `global_kill_switch`: `scout-sdk/README.md`
- Contract deploy and the engine env vars that anchor an identity: `scout-chain/README.md`
- Governance service on a fresh clone (generated stubs are already committed): `openshell-governance-service/README.md`
- Compose constraints (dashboard bind address, governance database and TLS): `deploy/README.md`

## Research

Scout studies detection under an adaptive adversary: how much of a hostile agent's behaviour can
be identified from prompts, tool calls and runtime events before damage is done, and how quickly
a classifier degrades once the adversary knows it is being classified. That is a general detection
problem, not specific to AI agents; the same shape of question shows up anywhere a bad actor
adapts once it learns it is being watched. Scout applies it to an agent's own actions; it does not
analyse human-run accounts or social networks.

Status: the engine is functional and not deployed. A dedicated adversarial-evaluation artefact is
planned as a separate repository; nothing from that work exists yet, and this README will be
updated once it does.

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

# Optional - on-chain agent identity (see scout-chain/README.md):
cd ../scout-chain
pnpm install && pnpm generate-wallet   # then fund the printed address via a Sepolia faucet
pnpm compile && pnpm test              # works with no funded wallet
pnpm deploy:sepolia                    # needs a funded wallet; prints SCOUT_CHAIN_CONTRACT_ADDRESS
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
history of the project, not something currently offered or sold.
