import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { challengeMessage, verifyRequestSignature } from './identity.js';

describe('identity (pure signature logic, no DB)', () => {
  it('challengeMessage is deterministic for the same agent id + nonce', () => {
    assert.equal(challengeMessage('agent-1', 'nonce-a'), 'scout-identity-register:agent-1:nonce-a');
    assert.notEqual(challengeMessage('agent-1', 'nonce-a'), challengeMessage('agent-1', 'nonce-b'));
  });

  it('verifyRequestSignature accepts a real signature from the registered address', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = 'scout-event:agent-1:{"timestamp":123}';
    const signature = await account.signMessage({ message });

    const result = await verifyRequestSignature({
      agent: { chain_address: account.address, identity_verified_onchain: true },
      message,
      signature,
    });
    assert.deepEqual(result, { ok: true });
  });

  it('verifyRequestSignature rejects a signature from a different key', async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const claimedOwner = privateKeyToAccount(generatePrivateKey());
    const message = 'scout-event:agent-1:{"timestamp":123}';
    const signature = await signer.signMessage({ message });

    const result = await verifyRequestSignature({
      agent: { chain_address: claimedOwner.address, identity_verified_onchain: true },
      message,
      signature,
    });
    assert.equal(result.ok, false);
  });

  it('verifyRequestSignature rejects a tampered message', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({ message: 'original message' });

    const result = await verifyRequestSignature({
      agent: { chain_address: account.address, identity_verified_onchain: true },
      message: 'tampered message',
      signature,
    });
    assert.equal(result.ok, false);
  });

  it('verifyRequestSignature rejects an agent with no verified on-chain identity', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = 'anything';
    const signature = await account.signMessage({ message });

    const unverified = await verifyRequestSignature({
      agent: { chain_address: account.address, identity_verified_onchain: false },
      message,
      signature,
    });
    assert.equal(unverified.ok, false);

    const noAddress = await verifyRequestSignature({
      agent: { chain_address: null, identity_verified_onchain: true },
      message,
      signature,
    });
    assert.equal(noAddress.ok, false);
  });
});
