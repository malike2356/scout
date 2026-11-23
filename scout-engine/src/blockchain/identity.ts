// scout-engine/src/blockchain/identity.ts
// Challenge/response agent-identity registration and per-request signature
// verification, on top of chainClient.ts's raw contract calls.
//
// Why a challenge at all: registerAgentOnChain() is called by Scout's own
// operator key (the agent never sends its own transaction - see
// chainClient.ts), so without a proof step Scout would be writing
// "this address belongs to this agent" on the agent's unverified say-so.
// The challenge forces the agent to sign a Scout-issued nonce with the
// private key behind the address it's claiming, which Scout verifies
// before ever calling the contract.
import crypto from 'crypto';
import { verifyMessage } from 'viem';
import { db } from '../db/index.js';
import {
  agentKeyFor,
  getAgentOnChain,
  isChainConfigured,
  registerAgentOnChain,
  revokeAgentOnChain,
  reactivateAgentOnChain,
  explorerTxUrl,
  type ChainWriteResult,
} from './chainClient.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function challengeMessage(agentId: string, nonce: string): string {
  return `scout-identity-register:${agentId}:${nonce}`;
}

export async function issueIdentityChallenge(agentId: string): Promise<{ nonce: string; message: string }> {
  const nonce = crypto.randomBytes(16).toString('hex');
  await db('identity_challenges').insert({
    agent_id: agentId,
    nonce,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  return { nonce, message: challengeMessage(agentId, nonce) };
}

async function consumeChallenge(agentId: string, nonce: string): Promise<boolean> {
  const row = await db('identity_challenges')
    .where({ agent_id: agentId, nonce })
    .whereNull('consumed_at')
    .andWhere('expires_at', '>', new Date().toISOString())
    .first();
  if (!row) return false;

  await db('identity_challenges').where({ id: row.id }).update({ consumed_at: new Date().toISOString() });
  return true;
}

export interface RegisterIdentityResult {
  ok: boolean;
  error?: string;
  chain_address?: string;
  tx_hash?: string;
  explorer_url?: string;
  skipped?: boolean;
}

/**
 * Verifies the agent controls `address` (via the signed challenge), then
 * registers it on-chain and persists the result on connected_agents.
 * Returns ok:false (not a thrown error) for any validation/signature
 * failure - callers map that to a 4xx without a stack trace.
 */
export async function registerAgentIdentity(opts: {
  organizationId: string;
  agentId: string;
  address: `0x${string}`;
  nonce: string;
  signature: `0x${string}`;
  metadataURI?: string;
}): Promise<RegisterIdentityResult> {
  const validNonce = await consumeChallenge(opts.agentId, opts.nonce);
  if (!validNonce) {
    return { ok: false, error: 'Challenge nonce is invalid, already used, or expired. Request a new one.' };
  }

  const message = challengeMessage(opts.agentId, opts.nonce);
  const signatureValid = await verifyMessage({
    address: opts.address,
    message,
    signature: opts.signature,
  }).catch(() => false);

  if (!signatureValid) {
    return { ok: false, error: 'Signature does not match the claimed address for this challenge.' };
  }

  if (!isChainConfigured()) {
    // Record the verified claim even without a live chain write, so the
    // relationship (agent <-> address, proven by signature) is not lost -
    // just not yet anchored on-chain.
    await db('connected_agents').where({ id: opts.agentId, organization_id: opts.organizationId }).update({
      chain_address: opts.address,
      identity_verified_onchain: false,
    });
    return { ok: true, skipped: true, chain_address: opts.address };
  }

  const result: ChainWriteResult = await registerAgentOnChain(
    opts.agentId,
    opts.address,
    opts.metadataURI || '',
  );

  if (!result.ok) {
    return { ok: false, error: result.error || 'On-chain registration failed.' };
  }

  await db('connected_agents').where({ id: opts.agentId, organization_id: opts.organizationId }).update({
    chain_address: opts.address,
    chain_tx_hash_registered: result.txHash,
    chain_registered_at: new Date().toISOString(),
    identity_verified_onchain: true,
  });

  return {
    ok: true,
    chain_address: opts.address,
    tx_hash: result.txHash,
    explorer_url: result.txHash ? explorerTxUrl(result.txHash) : undefined,
  };
}

/** Called from agent-control.ts when an agent with an on-chain identity is killed/resumed. */
export async function syncAgentRevocationOnChain(
  agentId: string,
  action: 'kill' | 'resume',
  reason: string,
): Promise<ChainWriteResult | null> {
  const agent = await db('connected_agents').where({ id: agentId }).first();
  if (!agent?.chain_address || !agent.identity_verified_onchain) return null;

  const result =
    action === 'kill' ? await revokeAgentOnChain(agentId, reason) : await reactivateAgentOnChain(agentId);

  if (result.ok) {
    await db('connected_agents')
      .where({ id: agentId })
      .update(
        action === 'kill'
          ? { chain_tx_hash_revoked: result.txHash, chain_revoked_at: new Date().toISOString() }
          : { chain_tx_hash_revoked: null, chain_revoked_at: null },
      );
  }
  return result;
}

/**
 * Verifies a per-request signature against an agent's registered on-chain
 * address. Used when organizations.require_onchain_identity is true, to
 * stop any caller holding the org API key from submitting events/prompts
 * as an agent_id it does not actually control.
 */
export async function verifyRequestSignature(opts: {
  agent: Record<string, unknown>;
  message: string;
  signature: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const address = opts.agent.chain_address as string | null;
  const verified = opts.agent.identity_verified_onchain as boolean;
  if (!address || !verified) {
    return { ok: false, reason: 'Agent has no verified on-chain identity registered.' };
  }

  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message: opts.message,
    signature: opts.signature as `0x${string}`,
  }).catch(() => false);

  if (!valid) return { ok: false, reason: 'Signature does not match the agent\'s registered on-chain address.' };
  return { ok: true };
}

export { agentKeyFor, getAgentOnChain, isChainConfigured };
