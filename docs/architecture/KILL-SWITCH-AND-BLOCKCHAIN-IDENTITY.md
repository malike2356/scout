# Kill switch unification and blockchain agent identity

Status: implemented 2026-11-23. Scope: `scout-engine/`, `scout-dashboard/`,
`scout-sdk/` (TypeScript + Python), `scout-chain/` (new).

## 1. Motivation

Scout exists to answer two questions about an AI agent at runtime: *can we
stop it right now*, and *is the thing calling itself "agent X" actually
agent X*. Before this work, Scout had partial, fragmented answers to both:

- **Three parallel "kill switch" concepts** existed in the codebase at
  once: the real one (`connected_agents.status`, enforced by
  `agent-guard.ts`), a Carina-era one that read a table
  (`carina_instances`) that does not exist in a standalone Scout database,
  and a `kill_switch_state` table that was created on every server boot and
  never read by any route. Only the first was ever reachable from a live
  request path.
- **No agent had a cryptographic identity.** `POST /v1/agents/register`
  issued a `monitoring_token`, but nothing on any subsequent request path
  ever checked it. In practice, any caller holding the organization's API
  key could submit events or prompts as *any* `agent_id` under that
  org - Scout could tell you an agent existed, not that the thing talking
  to it over HTTP was that agent.

This document covers the fix: one unified kill switch (per-agent, global,
and policy-triggered), and a signed, on-chain-anchored agent identity that
closes the impersonation gap above.

## 2. Threat model (what this does and doesn't protect against)

**In scope:**
- An operator needs to stop one misbehaving agent, or everything in an
  organization, immediately and have that decision durably recorded.
- A policy (repeated critical prompt-injection blocks) should be able to
  trigger the same stop automatically, with the same audit trail as a
  human doing it.
- A caller holding a valid organization API key should not be able to
  submit events/prompts *as* an agent it doesn't actually run, when the
  organization opts into requiring proof.

**Out of scope / explicitly not solved here:**
- **Real-time interruption of an in-flight call.** Both the kill switch
  and signed-identity checks are enforced at the *next* request
  (poll-before-call, matching the SDK's existing `assertAgentRunnable`
  pattern) - an agent mid-tool-call when killed is not interrupted
  mid-flight. A push-based channel (the already-designed but unbuilt
  `docs/CHANNEL-KILL-SWITCH-DESIGN.md`) is the natural next step, not
  attempted here.
- **Protecting the organization API key itself.** If that key leaks, the
  attacker can still register new agents and sign their requests with a
  key the attacker also controls - on-chain identity authenticates *which
  agent* within the org, not *which org*. API key custody is a separate,
  already-existing control (bcrypt-hashed, revocable).
- **Non-repudiation against Scout's own operator.** `registerAgent`/
  `revokeAgent`/`reactivateAgent` on-chain are all `onlyOwner` (Scout's
  operator wallet). This buys public auditability of *when* an identity
  was registered or revoked and *why* (the revoke reason is an on-chain
  event argument), not independence from Scout's own backend - a fully
  decentralized version would have the agent transact directly, which
  would also mean every agent needs its own funded wallet. That tradeoff
  (see Section 6) was made deliberately for this iteration.

## 3. Kill switch: one path, three triggers

### 3.1 Before

| Path | Table | Reachable from a live request? |
|---|---|---|
| `agent-guard.ts` (`/v1` routes) | `connected_agents.status` | Yes - the real one |
| `instance-control.ts` (`/api/admin/kill`) | `carina_instances` | No - table doesn't exist in standalone Scout |
| `event-server/migrations.ts` | `kill_switch_state` | Created every boot, read by nothing |

### 3.2 After

Everything now funnels through `scout-engine/src/control/agent-control.ts`:

```
suspendAgent()             -> connected_agents.status = 'suspended'
                               + suspension_reason/suspended_at/suspended_by/kill_source
                               + on-chain revoke (if the agent has a verified identity)
                               + kill_switch_events audit row
                               + security_events row (same timeline as every other finding)
                               + Redis pub/sub (labyrinth:control) for any future push listener

resumeAgent()               -> the mirror image

suspendAllAgentsForOrg()    -> organizations.global_kill_active = true (+ reason, timestamp)
resumeAllAgentsForOrg()     -> the mirror image

recordPromptFilterEventAndMaybeAutoKill()
                             -> logs every prompt-filter verdict to prompt_filter_events,
                                then calls suspendAgent() with source='policy' once an
                                agent accumulates >= organizations.auto_kill_threshold
                                blocked+critical verdicts within a 15-minute window
```

`api/admin.ts` (static-key ops route), `api/dashboard/index.ts`
(JWT-gated dashboard route), and `integrations/keprix-connector.ts`
(Keprix propagation) all call into this one module rather than touching
`connected_agents` directly. `agent-guard.ts`'s `assertAgentRunnable()`
checks the **global** flag first, then the **per-agent** status, so a
global kill blocks every agent without having to rewrite every agent row
(and resuming it restores each agent's own prior state exactly, since
their individual rows were never touched).

**Why global kill doesn't also revoke on-chain identities:** a global
kill is an emergency stop that has to be instant; an on-chain write is a
Sepolia block confirmation away (seconds, sometimes more). Per-agent
kill/resume *does* sync to the chain (see Section 4), because a single
agent being killed is not time-critical in the same way an "everything
stop now" button is.

**Dead schema removed, not left behind:** `kill_switch_state` is no
longer created by `event-server/migrations.ts`, and a `DROP TABLE IF
EXISTS` cleans it up on any database that already has it (both the boot
path and `db/migrations/013-kill-switch-and-identity.sql` do this, so it's
gone regardless of which migration path a given environment uses).
`instance-control.ts` itself is deleted; `api/boundary/status.ts` now
reads `connected_agents` instead of the nonexistent `carina_instances`.

## 4. Blockchain agent identity

### 4.1 Why a blockchain at all, and why not reuse what already existed

A prior, real implementation of on-chain agent identity already exists in
this codebase's history: `console/trust/*` (ERC-8004 identity
registration + ERC-8126 weighted-verification trust scoring, using
`viem` against a real registry contract on Base). It was deliberately
*not* reused here. Two reasons, both already on record in
`docs/decisions/SUPERSESSION-MAP-2026-10-24.md`:

1. It is Carina-coupled at the data layer (hardcodes a `'carina-reference'`
   identity, queries `carina_instances`, assumes `core.carinaai.uk`
   URIs) - porting it would reintroduce exactly the cross-product
   coupling Scout's own separation rules forbid.
2. It answers a different question. ERC-8004/8126 is about *attesting
   that an agent's claimed action matches what actually happened* - a
   trust/reputation problem. What Scout's kill switch needs is narrower
   and more basic: *is the caller the agent it claims to be, right now,
   on this request*. Building the smaller, Scout-native thing was more
   honest than stretching a bigger piece of prior art to fit.

So `ScoutAgentIdentity.sol` (`scout-chain/contracts/`) is a new, ~115-line
contract, not a derivative of that prior work - worth reading in full,
since that is also the point: small enough to audit end to end for a
paper artifact.

### 4.2 Design

- **Identity = a secp256k1 keypair**, the same curve Ethereum uses. An
  agent's "address" is its identity.
- **Registration is challenge/response, not self-asserted.** Scout issues
  a one-time nonce (`GET /v1/agents/:id/identity/challenge`,
  `identity_challenges` table, 5-minute TTL, consumed on use); the agent
  signs `scout-identity-register:{agentId}:{nonce}` with its private key;
  Scout verifies that signature (`viem`'s `verifyMessage` /
  `eth_account`'s `recover_message` on the Python side - both implement
  the same EIP-191 "personal_sign" scheme, cross-checked empirically
  during this work) before ever touching the chain.
- **Scout's operator wallet pays gas, not the agent.** `registerAgent`/
  `revokeAgent`/`reactivateAgent` on `ScoutAgentIdentity.sol` are
  `onlyOwner`, called by `scout-engine` itself
  (`SCOUT_CHAIN_OPERATOR_PRIVATE_KEY`). An agent needs a keypair, never a
  funded wallet.
- **Per-request signing is opt-in per organization**
  (`organizations.require_onchain_identity`). When on, `/v1/events` and
  `/v1/prompts/filter` require a `signed_message` (a JSON envelope:
  `agent_id` + `timestamp` + the field(s) being authenticated, e.g.
  `prompt` or `event_count`) + `signature` from the agent's *registered*
  address, checked with a 5-minute replay window. When off (the default),
  behavior is unchanged from before this work - fully backward compatible.
- **Graceful degradation when the chain isn't configured.** Every
  on-chain write in `blockchain/chainClient.ts` returns
  `{ ok: false, skipped: true }` instead of throwing when
  `SCOUT_CHAIN_CONTRACT_ADDRESS`/`SCOUT_CHAIN_OPERATOR_PRIVATE_KEY` are
  unset - the same resilience pattern already used for the optional Keprix
  integration. The signature is still verified and the
  agent<->address binding still persisted
  (`identity_verified_onchain: false`); only the on-chain anchor is
  deferred. This matters in practice: it means the whole identity flow is
  testable and demoable before a contract is ever deployed, and the exact
  same code path runs once it is, with no code change - just the four
  `SCOUT_CHAIN_*` env vars.

### 4.3 Data model

```
connected_agents
  chain_address               -- the agent's claimed+verified address
  chain_tx_hash_registered    -- Sepolia tx hash, once anchored
  chain_tx_hash_revoked       -- set while killed with a verified identity; cleared on resume
  chain_registered_at / chain_revoked_at
  identity_verified_onchain   -- true only once the on-chain write actually succeeded

identity_challenges            -- one-time nonces, 5-minute TTL, consumed on use

organizations
  require_onchain_identity     -- opt-in strict mode for /v1/events and /v1/prompts/filter
```

### 4.4 Contract

`scout-chain/contracts/ScoutAgentIdentity.sol` - registry keyed by
`keccak256(scoutAgentId)`:

```solidity
function registerAgent(bytes32 agentKey, address agentAddress, string calldata metadataURI) external onlyOwner;
function revokeAgent(bytes32 agentKey, string calldata reason) external onlyOwner;
function reactivateAgent(bytes32 agentKey) external onlyOwner;
function isActive(bytes32 agentKey) external view returns (bool);
function getAgent(bytes32 agentKey) external view returns (address, bool, uint64, uint64, string memory);
```

Hand-rolled rather than importing OpenZeppelin's `Ownable`: the whole
contract is small enough to read in one sitting, which mattered more here
than reusing a library for a single modifier. 9 Hardhat tests
(`scout-chain/test/ScoutAgentIdentity.ts`, Node's built-in test runner via
`@nomicfoundation/hardhat-toolbox-viem` v5 on Hardhat 3) cover
registration, double-registration rejection, zero-address rejection,
revoke/reactivate round-tripping, double-revoke rejection, ownership
checks, and ownership transfer.

Deployment target: Sepolia (a free, public Ethereum testnet - real chain
semantics and a real explorer trail, without spending real ETH).
`scout-chain/scripts/deploy.ts` deploys with `viem`, writes
`deployments/sepolia.json` (address, tx hash, block, deployer - all
public, safe to commit), and prints the exact env var to set in
`scout-engine`.

### 4.5 API surface (scout-engine, `/v1`)

```
GET  /v1/agents/:id/identity/challenge   -> { nonce, message, expires_in_seconds }
POST /v1/agents/:id/identity/register    { address, nonce, signature, metadata_uri? }
                                          -> { chain_address, tx_hash, explorer_url, verified_onchain }
```

Strict mode adds `signed_message` + `signature` fields to the existing
`POST /v1/events` and `POST /v1/prompts/filter` bodies.

### 4.6 SDK usage

TypeScript (`@scout-security/client`):

```ts
import { Scout, generateIdentityKey } from '@scout-security/client';

const { privateKey } = generateIdentityKey(); // store this yourself
const scout = new Scout({ apiKey, identityPrivateKey: privateKey });

const { chain_address, tx_hash, explorer_url } = await scout.registerIdentity(agentId);
// filter()/trackEvent() now auto-sign whenever require_onchain_identity is on
```

Python (`scout_client.py`; needs `pip install eth_account` - lazily
imported, so the base client still only needs `requests` if you never use
this feature):

```python
from scout_client import Scout, generate_identity_key

private_key, _address = generate_identity_key()
scout = Scout(api_key=api_key, identity_private_key=private_key)
result = scout.register_identity(agent_id)
```

Cross-language compatibility was verified directly, not assumed: a
message signed in Python with `eth_account` was verified successfully by
`viem`'s `verifyMessage` in Node, confirming both sides implement the
same EIP-191 scheme.

## 5. Policy-triggered auto-kill

`organizations.auto_kill_threshold` (nullable; disabled by default).
Every `/v1/prompts/filter` call now logs its verdict to
`prompt_filter_events`. When an agent accumulates `>= threshold`
`blocked` + `critical` verdicts within a rolling 15-minute window,
`recordPromptFilterEventAndMaybeAutoKill()` calls `suspendAgent()` with
`source: 'policy'`, `triggered_by: 'scout-auto-kill'` - visible in the
dashboard and the audit trail exactly like a manual kill, just
attributable to policy instead of an operator.

## 6. Known limitations / honest tradeoffs (future work)

- **Poll, not push.** Covered in Section 2 - a killed agent isn't
  interrupted mid-call. The channel-native kill switch design
  (`docs/CHANNEL-KILL-SWITCH-DESIGN.md`) already anticipates reusing this
  exact mechanism and is the natural next increment.
- **Centralized registry ownership.** `ScoutAgentIdentity.sol`'s
  `onlyOwner` model means Scout's own operator key is a single point of
  trust for registration/revocation. A fully agent-sovereign version
  (agents submit their own transactions) would remove that, at the cost
  of every agent needing a funded wallet - a real design tradeoff, not an
  oversight.
- **Strict-mode signature scope is coarse for event batches.** A single
  `POST /v1/events` signature covers `{event_count}`, not a per-event
  content hash - it authenticates *that this agent submitted this batch*,
  not a tamper-proof binding to each individual event's contents. Tighter
  per-event binding is a reasonable follow-on if batches start carrying
  more sensitive payloads.
- **`scout-sdk`'s packaging is still mixed** (pnpm lockfile for the
  TypeScript package per the rest of the monorepo, but the root README
  documents `npm install` for this one package, and there's no
  `pyproject.toml`/`setup.py` for the Python client at all - it's
  distributed as a loose script + `requirements.txt`). Not changed here;
  flagged for whoever formalizes packaging next.
