# Deploying Scout SaaS (pilot)

This stack is the **isolated SaaS** under `/opt/lampp/htdocs/verlox/scout/`.
It is parallel to the legacy Labyrinth console used by Carina. Do not cut over
`console.labyrinthscout.com` without explicit owner approval.

## Prerequisites

- Docker + Compose v2
- `docker network create proxy` (once on the host)
- TLS / DNS handled by existing edge nginx (Carina proxy)
- Copy `.env.production.example` to `scout/.env.production` and fill secrets

## Bring up

```bash
cd /opt/lampp/htdocs/verlox/scout
cp .env.production.example .env.production
# edit .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Always pass `--env-file .env.production` so `${SCOUT_DB_PASSWORD}` substitution matches the Postgres volume password. Do not let a host-shell `DATABASE_URL` (often `localhost:5433`) override compose service DNS.

Merge `deploy/nginx-console-labyrinthscout.conf.snippet` into edge nginx, reload nginx.

## Smoke

```bash
curl -fsS https://console.labyrinthscout.com/health
curl -fsS https://console.labyrinthscout.com/v1/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://console.labyrinthscout.com/login
```

Expect `/health` and `/v1/health` to include `repository_secret_scanning.tables_ready` when migrations 011/012 are applied.

## Repository secret scanning ops

- Scoring: `docs/SECRET-SCAN-SCORING.md`
- Incident: `docs/INCIDENT-COMMITTED-CREDENTIAL.md`
- Backup/restore: `docs/BACKUP-RESTORE-SECRET-SCANNING.md`
- Local delivery: `/opt/lampp/htdocs/verlox/shared/secrets/README.md`

Capacity controls reuse org API rate limits plus ingest caps (`MAX_INGEST_BYTES` 256 KiB, max 500 findings per request).

Local published ports (optional override for laptop testing) can be added with a
`docker-compose.override.yml`; production compose only exposes containers on `proxy`.

## Rollback

Stop SaaS containers:

```bash
docker compose -f docker-compose.prod.yml down
```

Restore previous nginx upstream to the legacy Labyrinth console if you had switched it.

## Stripe webhooks

Point Stripe (test) webhook to `https://console.labyrinthscout.com/webhooks/stripe`.
Use price IDs from `/.access/.stripe-credentials-and-price-id.md` only.
