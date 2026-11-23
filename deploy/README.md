# Deploying Scout

Not currently deployed anywhere - this documents how the stack under
`<workspace-root>/scout/` was brought up during its original build-out, kept for reference.
It is parallel to the legacy Labyrinth console used by Carina. Do not cut over
`console.labyrinthscout.com` without explicit owner approval.

## Prerequisites

- Docker + Compose v2
- `docker network create proxy` (once on the host)
- TLS / DNS: Scout is moving toward owning its own container and ingress - do not provision this
  against Carina's edge nginx going forward. If this doc still describes a transitional
  shared-proxy arrangement, name it honestly as transitional, not as a permanent dependency.
- Copy `.env.production.example` to `scout/.env.production` and fill secrets

## Bring up

```bash
cd <workspace-root>/scout
cp .env.production.example .env.production
# edit .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Always pass `--env-file .env.production` so `${SCOUT_DB_PASSWORD}` substitution matches the Postgres volume password. Do not let a host-shell `DATABASE_URL` (often `localhost:5433`) override compose service DNS.

Merge `deploy/nginx-console-labyrinthscout.conf.snippet` into edge nginx, reload nginx.

## Compose constraints

These follow from `docker-compose.prod.yml`. Changing them without reading the comment next to each setting is how the stack fails quietly.

**Dashboard bind address.** `scout-saas-dashboard` sets `HOSTNAME=0.0.0.0`. Next.js standalone binds `process.env.HOSTNAME` when that variable is set, and falls back to `0.0.0.0` only when it is unset. The container is on both `scout-saas` and `proxy`. Docker's hostname line in `/etc/hosts` can resolve to the `scout-saas` address, which nginx on `proxy` cannot reach, and that address is not stable across a recreate. Leave `HOSTNAME` forced. The healthcheck fetches `http://127.0.0.1:3005/`; a bind to the wrong interface fails the check.

**Which process is the engine.** `scout-engine/docker/entrypoint.sh` migrates, then runs `node dist/server.js` (`src/server.ts`). That process mounts `/v1`, `/api/dashboard`, and `/api/billing`. It does not mount `apiRouter` from `src/api/index.ts`. That router is attached only by `src/index.ts`, which the image does not start. Dashboard alert channels are `GET`/`PUT /api/dashboard/settings/alerts` (session JWT, `workspace_settings` for the org's first workspace). See `scout-dashboard/README.md`.

**Governance service.** `scout-saas-governance` joins `scout-saas` only. It is not on `proxy`. The engine calls it at `http://scout-saas-governance:18080` (`SCOUT_GOVERNANCE_API_URL`) and is the authenticated front for `/api/dashboard/governance/*`. The service's own HTTP port has no authentication. Do not attach it to `proxy`.

The container will not serve until both of these exist:

1. `deploy/scout-governance-tls/cert.pem` and `key.pem`. The directory is gitignored. Startup reads `SCOUT_MIDDLEWARE_TLS_CERT_PATH` and `SCOUT_MIDDLEWARE_TLS_KEY_PATH` for the middleware listener on 18082 (`src/config.ts` requires both). Compose does not publish 18082. The files only need to parse.
2. A database named `scout_governance` on `scout-saas-postgres`. The image creates `POSTGRES_DB=scout` and nothing else. Compose sets `SCOUT_POLICY_DATABASE_URL` to `.../scout_governance`. Create that database, then apply `openshell-governance-service/sql/0001_scout_policy.sql`, `0002_scout_governance_evidence.sql`, and `0003_scout_governance_linkage.sql` to it. The service does not migrate on boot. `0001` creates `scout_policy` and `scout_policy_binding` in the connected database. `0002` and `0003` create the `scout_governance` schema in that same database.

Chain identity is independent of this service. `SCOUT_CHAIN_CONTRACT_ADDRESS` and `SCOUT_CHAIN_OPERATOR_PRIVATE_KEY` are optional on the engine. When either is unset, registration still checks the signature, stores `chain_address`, leaves `identity_verified_onchain` false, and skips the chain write. See `scout-chain/README.md`. Put the operator private key only in the untracked `.env.production`.

## Smoke

```bash
curl -fsS https://console.labyrinthscout.com/health
curl -fsS https://console.labyrinthscout.com/v1/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://console.labyrinthscout.com/login
```

Expect `/health` and `/v1/health` to include `repository_secret_scanning.tables_ready` when migrations 011/012 are applied.

## Repository secret scanning ops

- Local delivery: `<workspace-root>/shared/secrets/README.md`

Capacity controls reuse org API rate limits plus ingest caps (`MAX_INGEST_BYTES` 256 KiB, max 500 findings per request).

Local published ports (optional override for laptop testing) can be added with a
`docker-compose.override.yml`; production compose only exposes containers on `proxy`.

## Rollback

Stop SaaS containers:

```bash
docker compose -f docker-compose.prod.yml down
```

Restore previous nginx upstream to the legacy Labyrinth console if you had switched it.

## Stripe webhooks (historical)

The engine still has a `/webhooks/stripe` route from the original SaaS build-out, but it is not
live and there is nothing to point a real webhook at. Price IDs, if ever needed again, are in
`/.access/.stripe-credentials-and-price-id.md` (marked retired).
