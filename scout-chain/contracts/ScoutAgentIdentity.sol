// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ScoutAgentIdentity
/// @notice Minimal on-chain identity registry for Scout-monitored AI agents.
///
/// Design intent (see scout/docs/architecture/KILL-SWITCH-AND-BLOCKCHAIN-IDENTITY.md):
///   - Each Scout agent gets a secp256k1 keypair; its address is the agent's
///     cryptographic identity, anchored here so no single party (including
///     Scout's own database) can silently rewrite an agent's registration or
///     active/revoked history without leaving a public, timestamped trace.
///   - `owner` is Scout's operational key, not the agent's key. The agent
///     proves it controls `agentAddress` off-chain (a signed challenge,
///     verified by Scout before calling registerAgent) rather than sending
///     its own transaction, so agents never need their own gas.
///   - Revocation here is deliberately a *separate, slower* channel from the
///     per-agent kill switch's instant database flip (see agent-control.ts).
///     A real-time emergency stop cannot wait on block confirmations; the
///     on-chain write is the durable, publicly-auditable record that a kill
///     happened and why, made shortly after the instant in-app suspension.
///
/// Intentionally hand-rolled instead of importing OpenZeppelin's Ownable:
/// the whole contract is small enough to read end to end in one sitting,
/// which matters more here than reusing a library for a single modifier.
contract ScoutAgentIdentity {
    struct AgentRecord {
        address agentAddress;
        bool active;
        uint64 registeredAt;
        uint64 revokedAt;
        string metadataURI;
    }

    address public owner;

    /// @dev key = keccak256(bytes(scoutAgentId)) - Scout's UUID agent id,
    /// hashed so the UUID string itself need not be stored on-chain.
    mapping(bytes32 => AgentRecord) public agents;

    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event AgentRegistered(bytes32 indexed agentKey, address indexed agentAddress, string metadataURI, uint64 timestamp);
    event AgentRevoked(bytes32 indexed agentKey, uint64 timestamp, string reason);
    event AgentReactivated(bytes32 indexed agentKey, uint64 timestamp);

    error NotOwner();
    error ZeroAddress();
    error AlreadyRegistered();
    error NotRegistered();
    error AlreadyInState();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnerTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Register a new agent identity. Reverts if `agentKey` already exists -
    /// registration is one-shot; use revoke/reactivate for lifecycle changes.
    function registerAgent(bytes32 agentKey, address agentAddress, string calldata metadataURI) external onlyOwner {
        if (agentAddress == address(0)) revert ZeroAddress();
        AgentRecord storage rec = agents[agentKey];
        if (rec.registeredAt != 0) revert AlreadyRegistered();

        rec.agentAddress = agentAddress;
        rec.active = true;
        rec.registeredAt = uint64(block.timestamp);
        rec.metadataURI = metadataURI;

        emit AgentRegistered(agentKey, agentAddress, metadataURI, rec.registeredAt);
    }

    /// @notice Mark an agent inactive (e.g. kill-switch-triggered suspension).
    function revokeAgent(bytes32 agentKey, string calldata reason) external onlyOwner {
        AgentRecord storage rec = agents[agentKey];
        if (rec.registeredAt == 0) revert NotRegistered();
        if (!rec.active) revert AlreadyInState();

        rec.active = false;
        rec.revokedAt = uint64(block.timestamp);

        emit AgentRevoked(agentKey, rec.revokedAt, reason);
    }

    /// @notice Restore a previously revoked agent to active.
    function reactivateAgent(bytes32 agentKey) external onlyOwner {
        AgentRecord storage rec = agents[agentKey];
        if (rec.registeredAt == 0) revert NotRegistered();
        if (rec.active) revert AlreadyInState();

        rec.active = true;
        rec.revokedAt = 0;

        emit AgentReactivated(agentKey, uint64(block.timestamp));
    }

    function isActive(bytes32 agentKey) external view returns (bool) {
        return agents[agentKey].active;
    }

    function getAgent(bytes32 agentKey) external view returns (
        address agentAddress,
        bool active,
        uint64 registeredAt,
        uint64 revokedAt,
        string memory metadataURI
    ) {
        AgentRecord storage rec = agents[agentKey];
        return (rec.agentAddress, rec.active, rec.registeredAt, rec.revokedAt, rec.metadataURI);
    }
}
