// scout-engine/src/blockchain/abi.ts
// Minimal ABI for ScoutAgentIdentity.sol (see ../../../scout-chain/contracts).
// Hand-written rather than imported from scout-chain's build artifacts: the
// two packages are deliberately not linked as a pnpm workspace (scout-chain
// is dev/deploy tooling, not a runtime dependency), and this contract's
// surface is small and stable enough that keeping the ABI here is simpler
// than wiring a cross-package import of a gitignored build artifact.
export const SCOUT_AGENT_IDENTITY_ABI = [
  {
    type: 'function',
    name: 'registerAgent',
    inputs: [
      { name: 'agentKey', type: 'bytes32' },
      { name: 'agentAddress', type: 'address' },
      { name: 'metadataURI', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeAgent',
    inputs: [
      { name: 'agentKey', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reactivateAgent',
    inputs: [{ name: 'agentKey', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isActive',
    inputs: [{ name: 'agentKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAgent',
    inputs: [{ name: 'agentKey', type: 'bytes32' }],
    outputs: [
      { name: 'agentAddress', type: 'address' },
      { name: 'active', type: 'bool' },
      { name: 'registeredAt', type: 'uint64' },
      { name: 'revokedAt', type: 'uint64' },
      { name: 'metadataURI', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'agentKey', type: 'bytes32', indexed: true },
      { name: 'agentAddress', type: 'address', indexed: true },
      { name: 'metadataURI', type: 'string', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentRevoked',
    inputs: [
      { name: 'agentKey', type: 'bytes32', indexed: true },
      { name: 'timestamp', type: 'uint64', indexed: false },
      { name: 'reason', type: 'string', indexed: false },
    ],
    anonymous: false,
  },
] as const;
