-- Kill switch unification + blockchain agent identity.
-- Context: connected_agents.status was already the real per-agent kill
-- switch enforced by agent-guard.ts; this migration extends it (reason,
-- source, global org-wide kill, on-chain identity anchoring) and adds the
-- audit trail that was previously missing.

-- Per-agent kill switch: persist why/when/by-whom/how it was triggered.
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS suspended_by TEXT;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS kill_source TEXT
  CHECK (kill_source IN ('manual', 'policy', 'channel'));

-- On-chain identity anchoring (ScoutAgentIdentity.sol on Sepolia; see
-- scout-chain/). agentKey on-chain = keccak256(connected_agents.id).
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS chain_address TEXT;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS chain_tx_hash_registered TEXT;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS chain_tx_hash_revoked TEXT;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS chain_registered_at TIMESTAMPTZ;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS chain_revoked_at TIMESTAMPTZ;
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS identity_verified_onchain BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_connected_agents_chain_address ON connected_agents(chain_address);

-- Global, org-wide kill switch - an instant emergency stop that blocks every
-- agent in the org without touching individual agent rows (so resuming it
-- restores each agent's own prior state exactly, and it stays a single-row
-- flag check on the hot request path rather than an N-row update).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS global_kill_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS global_kill_reason TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS global_kill_at TIMESTAMPTZ;

-- Policy-triggered auto-kill: NULL disables it; otherwise the number of
-- critical-risk blocked prompts within the rolling window (see
-- agent-control.ts) that auto-suspends the offending agent.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_kill_threshold INTEGER;

-- Opt-in strict mode: require a valid on-chain-identity signature on every
-- /v1/events and /v1/prompts/filter call for this org (closes the gap where
-- any caller holding the org API key could act as any agent_id under it).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS require_onchain_identity BOOLEAN NOT NULL DEFAULT FALSE;

-- Unified kill-switch audit trail. Replaces the three previously-separate,
-- mostly-dead concepts (carina_instances-based admin kill, the never-read
-- kill_switch_state table) with one real, queried table.
CREATE TABLE IF NOT EXISTS kill_switch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES connected_agents(id) ON DELETE CASCADE, -- NULL for scope='global'
  scope TEXT NOT NULL CHECK (scope IN ('agent', 'global')),
  action TEXT NOT NULL CHECK (action IN ('kill', 'resume')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'policy', 'channel')),
  reason TEXT,
  triggered_by TEXT,
  chain_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kill_switch_events_org ON kill_switch_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kill_switch_events_agent ON kill_switch_events(agent_id, created_at DESC);

-- Durable log of prompt-filter verdicts per agent, needed to count recent
-- critical blocks for policy-triggered auto-kill (and useful on its own for
-- the agent detail page / audit).
CREATE TABLE IF NOT EXISTS prompt_filter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES connected_agents(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('allowed', 'flagged', 'blocked')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_filter_events_agent ON prompt_filter_events(agent_id, created_at DESC);

-- One-time challenge nonces for proving control of an agent's on-chain
-- address before Scout will register it (see /v1/agents/:id/identity/*).
CREATE TABLE IF NOT EXISTS identity_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES connected_agents(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_challenges_agent ON identity_challenges(agent_id, expires_at DESC);

-- Dead schema cleanup: kill_switch_state (event-server/migrations.ts) was
-- created on every server boot but never read by any route. Drop it here;
-- event-server/migrations.ts no longer (re)creates it.
DROP TABLE IF EXISTS kill_switch_state;
