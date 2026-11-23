// scout-engine/src/blockchain/identity.integration.test.ts
// Opt-in DB integration tests. Set SCOUT_KILL_SWITCH_IT=1 and a reachable
// DATABASE_URL (same flag/pattern as ../control/agent-control.integration.test.ts,
// since both exercise the same connected_agents rows end to end). Runs with
// SCOUT_CHAIN_* unset by design, to prove the graceful "verified by
// signature, not yet anchored on-chain" path works before a contract is
// ever deployed - the same code path runs once SCOUT_CHAIN_CONTRACT_ADDRESS
// is set, just with isChainConfigured() true instead.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { disconnect, getDb } from '../db/index.js';
import { issueIdentityChallenge, registerAgentIdentity } from './identity.js';

const enabled = process.env.SCOUT_KILL_SWITCH_IT === '1';

const orgId = crypto.randomUUID();
const workspaceId = crypto.randomUUID();
let agentId: string;

async function runMigrations(): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../db/migrations');
  const db = getDb();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    try {
      await db.raw(sql);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('already exists') && !message.includes('duplicate')) throw err;
    }
  }
}

describe('identity (integration, chain unconfigured)', { skip: !enabled }, () => {
  before(async () => {
    await runMigrations();
    const db = getDb();
    await db('organizations')
      .insert({
        id: orgId,
        name: 'Identity Test Org',
        slug: `identity-${orgId.slice(0, 8)}`,
        plan: 'team',
        subscription_status: 'inactive',
      })
      .onConflict('id')
      .ignore();
    await db('workspaces')
      .insert({ id: workspaceId, name: 'WS', active: true, organization_id: orgId })
      .onConflict('id')
      .ignore();
    const [agent] = await db('connected_agents')
      .insert({
        organization_id: orgId,
        workspace_id: workspaceId,
        agent_type: 'generic',
        name: 'identity-test-agent',
        api_key_hash: 'n/a',
        status: 'online',
      })
      .returning('*');
    agentId = agent.id;
  });

  after(async () => {
    await disconnect();
  });

  it('registers an agent identity end to end: challenge -> sign -> verify -> persist', async () => {
    const db = getDb();
    const account = privateKeyToAccount(generatePrivateKey());

    const challenge = await issueIdentityChallenge(agentId);
    assert.match(challenge.message, new RegExp(`^scout-identity-register:${agentId}:`));

    const signature = await account.signMessage({ message: challenge.message });

    const result = await registerAgentIdentity({
      organizationId: orgId,
      agentId,
      address: account.address,
      nonce: challenge.nonce,
      signature,
      metadataURI: 'test-metadata',
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true, 'chain is unconfigured in this test env - expect the graceful skip path');
    assert.equal(result.chain_address, account.address);

    const agent = await db('connected_agents').where({ id: agentId }).first();
    assert.equal(agent.chain_address, account.address);
    assert.equal(agent.identity_verified_onchain, false, 'skipped path should not claim on-chain verification');
  });

  it('rejects registration with a signature from the wrong key', async () => {
    const challenge = await issueIdentityChallenge(agentId);
    const signer = privateKeyToAccount(generatePrivateKey());
    const claimedAddress = privateKeyToAccount(generatePrivateKey()).address;
    const signature = await signer.signMessage({ message: challenge.message });

    const result = await registerAgentIdentity({
      organizationId: orgId,
      agentId,
      address: claimedAddress,
      nonce: challenge.nonce,
      signature,
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /[Ss]ignature/);
  });

  it('rejects a nonce that was already consumed', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = await issueIdentityChallenge(agentId);
    const signature = await account.signMessage({ message: challenge.message });

    const first = await registerAgentIdentity({
      organizationId: orgId,
      agentId,
      address: account.address,
      nonce: challenge.nonce,
      signature,
    });
    assert.equal(first.ok, true);

    const replay = await registerAgentIdentity({
      organizationId: orgId,
      agentId,
      address: account.address,
      nonce: challenge.nonce,
      signature,
    });
    assert.equal(replay.ok, false);
    assert.match(replay.error ?? '', /nonce/i);
  });

  it('rejects an expired/unknown nonce outright', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const fakeNonce = 'never-issued-nonce';
    const message = `scout-identity-register:${agentId}:${fakeNonce}`;
    const signature = await account.signMessage({ message });

    const result = await registerAgentIdentity({
      organizationId: orgId,
      agentId,
      address: account.address,
      nonce: fakeNonce,
      signature,
    });
    assert.equal(result.ok, false);
  });
});
