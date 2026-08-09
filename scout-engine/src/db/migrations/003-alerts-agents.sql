-- Alerting pipeline tables
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  trigger JSONB NOT NULL,           -- { event, conditions }
  channels TEXT[] NOT NULL,          -- ['email', 'push', 'webhook']
  config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  cooldown_minutes INTEGER DEFAULT 60,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  rule_id UUID REFERENCES alert_rules(id),
  finding_id UUID REFERENCES findings(id),
  channel TEXT NOT NULL,
  delivered BOOLEAN DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agent monitoring tables
CREATE TABLE IF NOT EXISTS connected_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  agent_type TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  last_heartbeat TIMESTAMP,
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'suspended')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES connected_agents(id),
  workspace_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  tool_args JSONB,
  tool_result JSONB,
  duration_ms INTEGER,
  session_id TEXT,
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_workspace ON agent_events(workspace_id, occurred_at DESC);
