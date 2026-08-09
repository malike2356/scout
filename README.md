# Scout SaaS



## Plans (Stripe SoT)

Free, Monitor (£99), Govern (£199), Team (£399). Price IDs in `/opt/lampp/htdocs/verlox/.access/.stripe-credentials-and-price-id.md`.

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
cd /opt/lampp/htdocs/verlox/scout
SCOUT_API_BASE=http://localhost:4444 SCOUT_E2E_ALLOW_PLAN_OVERRIDE=true bash scripts/e2e-pilot.sh
```

## Production (pilot)

See `deploy/README.md`. Host target: `console.labyrinthscout.com` (path-proxied `/v1` + `/api`). Do not cut over DNS without owner approval. Carina Scout remains on the legacy console until migrated.
