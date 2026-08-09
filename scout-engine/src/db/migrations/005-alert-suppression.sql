-- Alert suppression and workspace settings tables
-- Adds mute capabilities, DND scheduling, and workspace-level alert config

CREATE TABLE IF NOT EXISTS alert_mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  finding_id UUID REFERENCES findings(id) ON DELETE CASCADE,
  target_id UUID REFERENCES targets(id) ON DELETE CASCADE,
  muted_until TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_mutes_workspace ON alert_mutes(workspace_id, muted_until);
CREATE INDEX IF NOT EXISTS idx_alert_mutes_finding ON alert_mutes(finding_id) WHERE finding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_mutes_target ON alert_mutes(target_id) WHERE target_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID UNIQUE NOT NULL,
  alert_email TEXT,
  telegram_chat_id TEXT,
  slack_webhook_url TEXT,
  dnd_enabled BOOLEAN DEFAULT FALSE,
  dnd_start_hour INTEGER DEFAULT 22,
  dnd_end_hour INTEGER DEFAULT 7,
  digest_interval_minutes INTEGER DEFAULT 240,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_settings_ws ON workspace_settings(workspace_id);

-- Add config columns to alert_rules for Telegram/Slack
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
