# scout-chain

On-chain agent identity registry for Scout (`ScoutAgentIdentity.sol`),
deployed to the Sepolia testnet. See
`../docs/architecture/KILL-SWITCH-AND-BLOCKCHAIN-IDENTITY.md` for the full
design and why this exists; this README is just the how-to-run.

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

## Why Sepolia, and why a fresh contract instead of a public registry

Sepolia is a free, public Ethereum testnet: real chain semantics, a real
block explorer trail (`https://sepolia.etherscan.io`), no real-money risk.
`ScoutAgentIdentity.sol` is purpose-built for Scout rather than reusing an
existing standard registry (e.g. ERC-8004) - see the architecture doc,
Section 4.1, for why: a prior ERC-8004/8126 implementation already exists
in this codebase's history but is Carina-coupled and answers a different
question (attested trust/reputation) than what the kill switch needs
(is this request actually from the agent it claims to be).
