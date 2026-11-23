// scout-engine/src/blockchain/chainClient.ts
// Thin viem wrapper around the ScoutAgentIdentity registry on Sepolia.
// Follows the same graceful-degradation pattern as ../integrations/keprix-connector.ts:
// when SCOUT_CHAIN_* env vars are unset, every write here returns
// { ok: false, skipped: true } instead of throwing, so the rest of Scout
// (kill switch, event ingest) works unchanged with blockchain identity
// disabled - e.g. in local dev before a contract is deployed.
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { SCOUT_AGENT_IDENTITY_ABI } from './abi.js';

export interface ChainWriteResult {
  ok: boolean;
  skipped?: boolean;
  txHash?: string;
  error?: string;
}

function resolveConfig() {
  const contractAddress = process.env.SCOUT_CHAIN_CONTRACT_ADDRESS || '';
  const privateKey = process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY || '';
  const rpcUrl = process.env.SCOUT_CHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const explorerBase = process.env.SCOUT_CHAIN_EXPLORER_BASE || 'https://sepolia.etherscan.io';
  return { contractAddress, privateKey, rpcUrl, explorerBase };
}

export function isChainConfigured(): boolean {
  const { contractAddress, privateKey } = resolveConfig();
  return Boolean(contractAddress && privateKey);
}

export function explorerTxUrl(txHash: string): string {
  return `${resolveConfig().explorerBase}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${resolveConfig().explorerBase}/address/${address}`;
}

/** keccak256(agentId) - the on-chain lookup key for a Scout agent UUID. */
export function agentKeyFor(agentId: string): `0x${string}` {
  return keccak256(toHex(agentId));
}

function getClients() {
  const { contractAddress, privateKey, rpcUrl } = resolveConfig();
  if (!contractAddress || !privateKey) return null;

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
  return { publicClient, walletClient, contractAddress: contractAddress as `0x${string}`, account };
}

async function writeContract(
  functionName: 'registerAgent' | 'revokeAgent' | 'reactivateAgent',
  args: readonly unknown[],
): Promise<ChainWriteResult> {
  const clients = getClients();
  if (!clients) return { ok: false, skipped: true };

  try {
    const hash: Hash = await clients.walletClient.writeContract({
      address: clients.contractAddress,
      abi: SCOUT_AGENT_IDENTITY_ABI,
      functionName,
      args: args as never,
    });
    await clients.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return { ok: true, txHash: hash };
  } catch (err) {
    console.warn(`[scout:chain] ${functionName} failed:`, err instanceof Error ? err.message : err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function registerAgentOnChain(
  agentId: string,
  agentAddress: `0x${string}`,
  metadataURI: string,
): Promise<ChainWriteResult> {
  return writeContract('registerAgent', [agentKeyFor(agentId), agentAddress, metadataURI]);
}

export async function revokeAgentOnChain(agentId: string, reason: string): Promise<ChainWriteResult> {
  return writeContract('revokeAgent', [agentKeyFor(agentId), reason.slice(0, 480)]);
}

export async function reactivateAgentOnChain(agentId: string): Promise<ChainWriteResult> {
  return writeContract('reactivateAgent', [agentKeyFor(agentId)]);
}

export interface OnChainAgentRecord {
  agentAddress: string;
  active: boolean;
  registeredAt: number;
  revokedAt: number;
  metadataURI: string;
}

/** Read-only chain state for an agent; null if not configured or not registered on-chain. */
export async function getAgentOnChain(agentId: string): Promise<OnChainAgentRecord | null> {
  const clients = getClients();
  if (!clients) return null;

  try {
    const result = await clients.publicClient.readContract({
      address: clients.contractAddress,
      abi: SCOUT_AGENT_IDENTITY_ABI,
      functionName: 'getAgent',
      args: [agentKeyFor(agentId)],
    });
    const [agentAddress, active, registeredAt, revokedAt, metadataURI] = result as [
      string,
      boolean,
      bigint,
      bigint,
      string,
    ];
    if (registeredAt === 0n) return null;
    return {
      agentAddress,
      active,
      registeredAt: Number(registeredAt),
      revokedAt: Number(revokedAt),
      metadataURI,
    };
  } catch (err) {
    console.warn('[scout:chain] getAgent read failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
