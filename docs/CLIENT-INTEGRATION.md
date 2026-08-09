# Client integration (Scout SaaS pilot)

## What Scout does

- Filters prompts before your agent acts (`POST /v1/prompts/filter`)
- Ingests tool/runtime events (`POST /v1/events`)
- Ingests redacted repository secret-scan envelopes (`POST /v1/repository-secret-scans`)
- Shows agents, alerts, scores, API keys, and repository security posture in the dashboard
- Enforces kill switch: suspended agents get HTTP 403 `kill_switch` on filter/events

## What Scout does not do (this SaaS cut)

- Automatic local git scanning on the workstation (that stays in `shared/secrets/`; Scout receives metadata only)
- Transparent API gateway without your code calling Scout
- Full Carina console features (Trust Passport, connectors, LLM judge Injection Shield parity)

Keep Carina-bundled Scout on the existing Labyrinth console until a migration is planned.

## Repository secret-scan ingest (schema 1.0.0)

Authenticated with the same org API key (`Authorization: Bearer sk_live_...` or `X-Scout-Key`). Workspace and organization are bound from the key, never from the body.

```http
POST /v1/repository-secret-scans
Content-Type: application/json
```

Contract rules:

- Strict schema; unknown fields are rejected.
- Forbidden: credential values, match text, source content, environment content, absolute paths, author emails, tokens, passwords, authorization headers.
- Required HMAC signature (`signature.algorithm = hmac-sha256`) over timestamp, nonce, idempotency key, and a SHA-256 of the unsigned body (stable key order).
- Timestamp skew window: 5 minutes. Duplicate `idempotency_key` returns the prior receipt (`duplicate: true`).
- Max payload: 256 KiB; max 500 findings per request.

Related read APIs (same auth):

- `GET /v1/repository-connectors`
- `GET /v1/repository-secret-scans`
- `GET /v1/repository-secret-findings`
- `POST /v1/repository-secret-findings/:id/remediation`
- `GET /v1/repository-security/posture` (versioned aggregate for later Verlox MIS; includes trend and remediation-time)
- `GET /v1/repository-security/export` (redacted findings export)
- `GET /v1/repository-security/health` (authenticated deep check; public `/v1/health` also embeds a summary)

Decision note: `scout-engine/src/secret-scanning/DECISION.md`. Scoring: `docs/SECRET-SCAN-SCORING.md`.

## Connect

1. Sign up: `https://console.labyrinthscout.com/signup` (local: `http://localhost:3005/signup`)
2. Create an API key (Onboarding or API Keys)
3. Install the SDK (private pack first): see `scout-sdk/PUBLISH.md`
4. Set env:

```bash
export SCOUT_API_KEY=sk_live_...
export SCOUT_API_URL=https://console.labyrinthscout.com
# local engine: http://localhost:4444
```

## Where to call what

```text
on each user / LLM input:
  await scout.assertAgentRunnable(agentId)
  const result = await scout.filter({ agentId, prompt })
  if (result.blocked) -> do not call model/tools

before each tool execution:
  await scout.assertAgentRunnable(agentId)

after each tool:
  await scout.trackEvent({ agentId, type: 'tool_call_completed', toolName, ... })

after a local redacted secret scan (optional):
  export SCOUT_DELIVER=1 and SCOUT_* connector settings
  python3 shared/secrets/secret_scan.py current --repo <path> --deliver-scout
  # or SDK:
  await scout.ingestRepositorySecretScan(signedEnvelope)
```

Canonical example: `scout-sdk/examples/governed-loop.ts`

Python: `scout_client.assert_agent_runnable`, `filter`, `track_event`. Local secret-scan delivery lives in `shared/secrets/scout_delivery.py` (schema 1.0.0).

## Kill switch

Operator clicks Kill in the dashboard (Monitor+ plans), **or** (when channel kill is shipped) sends `/kill` in the linked Telegram bot and confirms. Your loop must stop when:

- `assertAgentRunnable` throws `ScoutApiError` with `code === 'kill_switch'`, or
- `filter` / `trackEvent` return HTTP 403 with `error: kill_switch`

Resume: dashboard resume or `/resume` with stronger confirm. See `docs/CHANNEL-KILL-SWITCH-DESIGN.md`.

## Emergency halt from Telegram (design)

Channel-native kill is the intended panic path (Telegram first, WhatsApp next). Dashboard remains for audit and linking. Until that series is built and e2e-green, treat phone kill as **not yet live** on the SaaS cut.

## Plans (Stripe SoT)

| Plan | Amount | Notes |
|------|--------|-------|
| Free | £0 | 1 agent; no kill switch |
| Monitor | £99/mo | kill switch |
| Govern | £199/mo | deeper limits |
| Team | £399/mo | highest caps |

Price IDs live in `/opt/lampp/htdocs/verlox/.access/.stripe-credentials-and-price-id.md`. Do not invent prices.

## Support boundary

Supervised pilot: we help wire the SDK. This is not full Govern marketing parity yet.
