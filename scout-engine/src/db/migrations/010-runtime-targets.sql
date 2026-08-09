-- Runtime agent targets (Keprix, future engines). Separate from network scan targets.
CREATE TABLE IF NOT EXISTS runtime_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  workspace_id UUID,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('keprix', 'carina', 'generic')),
  url TEXT NOT NULL,
  auth_token TEXT,
  agent_id UUID REFERENCES connected_agents(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  kill_switch_enabled BOOLEAN DEFAULT TRUE,
  prompt_filter_enabled BOOLEAN DEFAULT TRUE,
  last_health_at TIMESTAMPTZ,
  last_health_ok BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_runtime_targets_org ON runtime_targets(organization_id);
CREATE INDEX IF NOT EXISTS idx_runtime_targets_type ON runtime_targets(type);
CREATE INDEX IF NOT EXISTS idx_runtime_targets_agent ON runtime_targets(agent_id);
