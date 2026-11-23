# scout-chain

On-chain agent identity registry for Scout (`ScoutAgentIdentity.sol`),
deployed to the Sepolia testnet. This README covers the how-to-run; see
the contract's own doc comments for the design rationale.

## What's here

- `contracts/ScoutAgentIdentity.sol` - the registry contract (~115 lines,
  hand-rolled, no OpenZeppelin dependency - small enough to read end to end).
- `test/ScoutAgentIdentity.ts` - 9 tests (Hardhat 3's `node:test` + viem
  integration via `@nomicfoundation/hardhat-toolbox-viem`).
- `scripts/generate-wallet.ts` - generates a throwaway operator wallet,
  writes the private key to `.env` (gitignored, never printed to stdout
  beyond the address).
- `scripts/deploy.ts` - deploys to Sepolia, writes `deployments/sepolia.json`
  (address + tx hash + block - all public chain data, safe to commit).

## Setup

```bash
pnpm install
pnpm generate-wallet   # prints a fresh deployer address - fund it with a
                        # few cents of Sepolia test ETH from any public
                        # faucet before deploying, e.g.:
                        # https://cloud.google.com/application/web3/faucet/ethereum/sepolia
                        # https://www.alchemy.com/faucets/ethereum-sepolia
```

## Compile and test (no funded wallet needed)

```bash
pnpm compile
pnpm test
```

## Deploy to Sepolia (needs a funded wallet)

```bash
pnpm deploy:sepolia
```

On success this writes `deployments/sepolia.json` and prints the exact
line to add to `scout-engine/.env`:

```
SCOUT_CHAIN_CONTRACT_ADDRESS=0x...
```

Also copy the operator private key from this package's `.env` into
`scout-engine/.env` as `SCOUT_CHAIN_OPERATOR_PRIVATE_KEY` - scout-engine
is what actually calls `registerAgent`/`revokeAgent`/`reactivateAgent` at
runtime (on an agent's behalf, after verifying its signature), not this
package.

The committed deployment record is `deployments/sepolia.json` (address, tx hash, block). That file is public chain data. Do not copy the operator private key into it.

## What the engine does with it

`isChainConfigured()` is true only when both `SCOUT_CHAIN_CONTRACT_ADDRESS` and `SCOUT_CHAIN_OPERATOR_PRIVATE_KEY` are set. Optional overrides, with these defaults in `scout-engine/src/blockchain/chainClient.ts`:

- `SCOUT_CHAIN_RPC_URL` — `https://ethereum-sepolia-rpc.publicnode.com`
- `SCOUT_CHAIN_EXPLORER_BASE` — `https://sepolia.etherscan.io`

Registration is two public API calls, both scoped by the org API key (`Authorization: Bearer sk_live_...` or `X-Scout-Key`):

1. `GET /v1/agents/:id/identity/challenge` returns `{ agent_id, nonce, message, expires_in_seconds: 300 }`. `message` is `scout-identity-register:<agentId>:<nonce>`.
2. `POST /v1/agents/:id/identity/register` with `{ address, nonce, signature }`. The nonce is consumed once. A bad, reused, or expired nonce, or a signature that does not recover to `address`, returns `400` with `error: "identity_registration_failed"`.

The engine's operator key sends the chain transaction. The agent's key only signs the challenge. When the chain is not configured, the signature is still checked and `chain_address` is stored, but `identity_verified_onchain` stays false and there is no `tx_hash`.

A later per-agent kill or resume syncs that identity: `revokeAgent` on suspend, `reactivateAgent` on resume, only if `identity_verified_onchain` is already true. A chain error is logged and does not roll back the database status. The org-wide global kill flag does not loop agents and does not send those transactions.

Strict mode (`organizations.require_onchain_identity`) checks a separate per-request signature against the registered address. The client shape is in `scout-sdk/README.md`. An agent that was only recorded locally (`verified_onchain: false`) fails that check with "Agent has no verified on-chain identity registered."

## Why Sepolia, and why a fresh contract instead of a public registry

Sepolia is a free, public Ethereum testnet: real chain semantics, a real
block explorer trail (`https://sepolia.etherscan.io`), no real-money risk.
`ScoutAgentIdentity.sol` is purpose-built for Scout rather than reusing an
existing standard registry (e.g. ERC-8004): a prior ERC-8004/8126
implementation exists elsewhere in this project's history, but it's
coupled to an unrelated product's data model and answers a different
question (attested trust/reputation) than what the kill switch needs
(is this request actually from the agent it claims to be).
