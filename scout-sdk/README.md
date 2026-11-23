# @scout-security/client

Official client for the Scout runtime security API (`/v1/*`).

Default API host: `https://console.labyrinthscout.com` (path-proxied `/v1`).  
Local: set `SCOUT_API_URL=http://localhost:4444`.

## Install (private pilot)

Until npm publish:

```bash
npm run build && npm pack
npm install ./scout-security-client-0.1.0.tgz
```

## Usage

See `examples/governed-loop.ts` for the supervised agent loop (filter, assertAgentRunnable, trackEvent).

```typescript
import { Scout } from '@scout-security/client';

const scout = new Scout({ apiKey: process.env.SCOUT_API_KEY!, baseUrl: process.env.SCOUT_API_URL });
const agent = await scout.registerAgent({ name: 'my-agent', tools: ['send_email'] });
const agentId = agent.agent_id;

await scout.assertAgentRunnable(agentId);
const result = await scout.filter({ agentId, prompt: userInput });
if (result.blocked) return;
await scout.trackEvent({ agentId, type: 'tool_call_completed', toolName: 'send_email' });
```

Kill switch: `filter`, `trackEvent`, and `assertAgentRunnable` throw `ScoutApiError` when the agent cannot run.

- `code === 'kill_switch'` — that agent's status is `suspended` or `killed`. `reason` is `suspension_reason`.
- `code === 'global_kill_switch'` — `organizations.global_kill_active` is set. This is checked first and blocks every agent in the org, including ones whose own status is still `online`. Resuming the global switch does not resume agents that were suspended individually.

`GET /v1/agents/:id/status` reports `kill_switch_active`, `kill_switch_scope` (`"agent"`, `"global"`, or `null`), and `suspension_reason`.

## On-chain identity

Optional. With no `SCOUT_CHAIN_*` env on the engine, registration still verifies the signature and stores `chain_address`, and the response has `verified_onchain: false`. See `scout-chain/README.md` for deploying the contract.

```typescript
import { Scout, generateIdentityKey } from '@scout-security/client';

const { privateKey } = generateIdentityKey(); // Scout never stores this
const scout = new Scout({
  apiKey: process.env.SCOUT_API_KEY!,
  baseUrl: process.env.SCOUT_API_URL,
  identityPrivateKey: privateKey,
});

const registered = await scout.registerIdentity(agentId);
// registered.verified_onchain is true only when the engine anchored the address
```

`registerIdentity` loads `GET /v1/agents/:id/identity/challenge` and posts the signature to `POST /v1/agents/:id/identity/register`. The challenge message is `scout-identity-register:<agentId>:<nonce>`, valid for 300 seconds and single-use. The body is `{ address, nonce, signature, metadata_uri? }`. `address` must be a `0x` + 40 hex character string. Both this client (`viem` `signMessage`) and `python/scout_client.py` (`eth_account` `encode_defunct`, install `eth_account`) sign that string as an EIP-191 personal message, which is what the engine verifies.

When the org has `require_onchain_identity` (Settings, or `PATCH /api/dashboard/org`), `filter` and `trackEvent` attach `signed_message` and `signature` automatically if `identityPrivateKey` (or per-call `signWith`) is set. The signed string is JSON with `agent_id`, `timestamp` (epoch milliseconds), and:

- `prompt` — must equal the submitted prompt (`POST /v1/prompts/filter`)
- `event_count` — must equal the batch length (`POST /v1/events`; this client sends one event, so `1`)

The engine rejects a timestamp more than 5 minutes from its clock with `403` and `error: "identity_required"`. The agent must already have `identity_verified_onchain` set; a signature-only claim (`verified_onchain: false`) does not satisfy strict mode. Without a configured key the client sends no signature fields, and strict mode rejects the call.
