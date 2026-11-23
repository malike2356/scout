import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { network } from 'hardhat';
import { keccak256, toHex, getAddress, zeroAddress } from 'viem';

function agentKey(id: string): `0x${string}` {
  return keccak256(toHex(id));
}

async function assertReverts(promise: Promise<unknown>, expectedError: string): Promise<void> {
  try {
    await promise;
    assert.fail(`Expected revert "${expectedError}" but call succeeded`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(
      message.includes(expectedError),
      `Expected error to include "${expectedError}", got: ${message}`,
    );
  }
}

describe('ScoutAgentIdentity', async function () {
  const { viem } = await network.create();

  async function deployFixture() {
    const [owner, other] = await viem.getWalletClients();
    const contract = await viem.deployContract('ScoutAgentIdentity');
    return { contract, owner, other };
  }

  it('sets the deployer as owner', async function () {
    const { contract, owner } = await deployFixture();
    assert.equal(getAddress(await contract.read.owner()), getAddress(owner.account.address));
  });

  it('registers an agent and marks it active', async function () {
    const { contract, other } = await deployFixture();
    const key = agentKey('agent-123');

    await contract.write.registerAgent([key, other.account.address, 'ipfs://agent-123']);

    assert.equal(await contract.read.isActive([key]), true);
    const rec = await contract.read.getAgent([key]);
    assert.equal(getAddress(rec[0]), getAddress(other.account.address));
    assert.equal(rec[1], true);
    assert.equal(rec[4], 'ipfs://agent-123');
  });

  it('rejects double registration of the same agent key', async function () {
    const { contract, other } = await deployFixture();
    const key = agentKey('agent-dup');
    await contract.write.registerAgent([key, other.account.address, '']);

    await assertReverts(
      contract.write.registerAgent([key, other.account.address, '']),
      'AlreadyRegistered',
    );
  });

  it('rejects registering the zero address', async function () {
    const { contract } = await deployFixture();
    const key = agentKey('agent-zero');
    await assertReverts(contract.write.registerAgent([key, zeroAddress, '']), 'ZeroAddress');
  });

  it('revokes and reactivates an agent, toggling isActive and timestamps', async function () {
    const { contract, other } = await deployFixture();
    const key = agentKey('agent-revoke');
    await contract.write.registerAgent([key, other.account.address, '']);

    await contract.write.revokeAgent([key, 'kill_switch: critical prompt injection threshold exceeded']);
    assert.equal(await contract.read.isActive([key]), false);
    let rec = await contract.read.getAgent([key]);
    assert.notEqual(rec[3], 0n);

    await contract.write.reactivateAgent([key]);
    assert.equal(await contract.read.isActive([key]), true);
    rec = await contract.read.getAgent([key]);
    assert.equal(rec[3], 0n);
  });

  it('rejects revoking an agent that is already revoked', async function () {
    const { contract, other } = await deployFixture();
    const key = agentKey('agent-double-revoke');
    await contract.write.registerAgent([key, other.account.address, '']);
    await contract.write.revokeAgent([key, 'first kill']);

    await assertReverts(contract.write.revokeAgent([key, 'second kill']), 'AlreadyInState');
  });

  it('rejects revoking an agent that was never registered', async function () {
    const { contract } = await deployFixture();
    const key = agentKey('never-registered');
    await assertReverts(contract.write.revokeAgent([key, 'nope']), 'NotRegistered');
  });

  it('only allows the owner to register, revoke, or reactivate', async function () {
    const { contract, other } = await deployFixture();
    const key = agentKey('agent-not-owner');

    const asOther = await viem.getContractAt('ScoutAgentIdentity', contract.address, {
      client: { wallet: other },
    });

    await assertReverts(
      asOther.write.registerAgent([key, other.account.address, '']),
      'NotOwner',
    );
  });

  it('transfers ownership', async function () {
    const { contract, other } = await deployFixture();
    await contract.write.transferOwnership([other.account.address]);
    assert.equal(getAddress(await contract.read.owner()), getAddress(other.account.address));
  });
});
