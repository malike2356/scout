import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('chainClient', () => {
  const prev = {
    SCOUT_CHAIN_CONTRACT_ADDRESS: process.env.SCOUT_CHAIN_CONTRACT_ADDRESS,
    SCOUT_CHAIN_OPERATOR_PRIVATE_KEY: process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('agentKeyFor is a deterministic keccak256 of the agent id', async () => {
    const { agentKeyFor } = await import('./chainClient.js');
    const a = agentKeyFor('agent-123');
    const b = agentKeyFor('agent-123');
    const c = agentKeyFor('agent-456');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^0x[0-9a-f]{64}$/);
  });

  it('isChainConfigured is false when contract address or private key are unset', async () => {
    delete process.env.SCOUT_CHAIN_CONTRACT_ADDRESS;
    delete process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY;
    const { isChainConfigured } = await import(`./chainClient.js?t=${Date.now()}-1`);
    assert.equal(isChainConfigured(), false);
  });

  it('isChainConfigured is true once both are set', async () => {
    process.env.SCOUT_CHAIN_CONTRACT_ADDRESS = '0x' + '1'.repeat(40);
    process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY = '0x' + '2'.repeat(64);
    const { isChainConfigured } = await import(`./chainClient.js?t=${Date.now()}-2`);
    assert.equal(isChainConfigured(), true);
  });

  it('write helpers no-op with { ok: false, skipped: true } when chain is not configured', async () => {
    delete process.env.SCOUT_CHAIN_CONTRACT_ADDRESS;
    delete process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY;
    const { registerAgentOnChain, revokeAgentOnChain, reactivateAgentOnChain } = await import(
      `./chainClient.js?t=${Date.now()}-3`
    );

    const registered = await registerAgentOnChain('agent-1', '0x1111111111111111111111111111111111111111', 'uri');
    assert.deepEqual(registered, { ok: false, skipped: true });

    const revoked = await revokeAgentOnChain('agent-1', 'reason');
    assert.deepEqual(revoked, { ok: false, skipped: true });

    const reactivated = await reactivateAgentOnChain('agent-1');
    assert.deepEqual(reactivated, { ok: false, skipped: true });
  });

  it('getAgentOnChain returns null when chain is not configured', async () => {
    delete process.env.SCOUT_CHAIN_CONTRACT_ADDRESS;
    delete process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY;
    const { getAgentOnChain } = await import(`./chainClient.js?t=${Date.now()}-4`);
    const result = await getAgentOnChain('agent-1');
    assert.equal(result, null);
  });

  it('explorerTxUrl/explorerAddressUrl default to sepolia.etherscan.io', async () => {
    delete process.env.SCOUT_CHAIN_EXPLORER_BASE;
    const { explorerTxUrl, explorerAddressUrl } = await import(`./chainClient.js?t=${Date.now()}-5`);
    assert.equal(explorerTxUrl('0xabc'), 'https://sepolia.etherscan.io/tx/0xabc');
    assert.equal(explorerAddressUrl('0xdef'), 'https://sepolia.etherscan.io/address/0xdef');
  });
});
