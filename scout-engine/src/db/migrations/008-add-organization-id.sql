-- Adds organization_id to workspace-owned tables, seeds the default organization,
-- backfills existing rows against it, and enforces NOT NULL plus indexes.
-- Idempotent: safe to run more than once.

INSERT INTO organizations (id, name, slug, plan, subscription_status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'default', 'free', 'inactive')
ON CONFLICT (id) DO NOTHING;

-- workspaces: ensure the default workspace exists and is linked to the default org
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

INSERT INTO workspaces (id, name, active, organization_id)
SELECT '00000000-0000-0000-0000-000000000001', 'Default Workspace', TRUE, '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000001');

UPDATE workspaces
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

ALTER TABLE workspaces ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(organization_id);

-- targets
ALTER TABLE targets ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE targets t
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE t.workspace_id = w.id AND t.organization_id IS NULL;
UPDATE targets SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE targets ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_targets_org ON targets(organization_id);

-- scan_runs
ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE scan_runs sr
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE sr.workspace_id = w.id AND sr.organization_id IS NULL;
UPDATE scan_runs SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE scan_runs ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_runs_org ON scan_runs(organization_id);

-- findings
ALTER TABLE findings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE findings f
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE f.workspace_id = w.id AND f.organization_id IS NULL;
UPDATE findings SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE findings ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_findings_org ON findings(organization_id);

-- scout_scores
ALTER TABLE scout_scores ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE scout_scores s
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE s.workspace_id = w.id AND s.organization_id IS NULL;
UPDATE scout_scores SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE scout_scores ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scout_scores_org ON scout_scores(organization_id);

-- alert_rules
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE alert_rules ar
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE ar.workspace_id = w.id AND ar.organization_id IS NULL;
UPDATE alert_rules SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE alert_rules ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rules_org ON alert_rules(organization_id);

-- alert_history
ALTER TABLE alert_history ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE alert_history ah
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE ah.workspace_id = w.id AND ah.organization_id IS NULL;
UPDATE alert_history SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE alert_history ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_history_org ON alert_history(organization_id);

-- connected_agents (also add metadata JSONB used to store registration tools/settings)
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE connected_agents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
UPDATE connected_agents ca
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE ca.workspace_id = w.id AND ca.organization_id IS NULL;
UPDATE connected_agents SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE connected_agents ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connected_agents_org ON connected_agents(organization_id);

-- agent_events
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE agent_events ae
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE ae.workspace_id = w.id AND ae.organization_id IS NULL;
UPDATE agent_events SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE agent_events ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_events_org ON agent_events(organization_id);

-- webhooks
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE webhooks wh
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE wh.workspace_id = w.id AND wh.organization_id IS NULL;
UPDATE webhooks SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE webhooks ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(organization_id);

-- report_cache
ALTER TABLE report_cache ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE report_cache rc
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE rc.workspace_id = w.id AND rc.organization_id IS NULL;
UPDATE report_cache SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE report_cache ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_cache_org ON report_cache(organization_id);

-- workspace_settings
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE workspace_settings ws
SET organization_id = COALESCE(w.organization_id, '00000000-0000-0000-0000-000000000001')
FROM workspaces w
WHERE ws.workspace_id = w.id AND ws.organization_id IS NULL;
UPDATE workspace_settings SET organization_id = '00000000-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE workspace_settings ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_settings_org ON workspace_settings(organization_id);

-- Auto-fill organization_id from workspace_id on insert. This keeps every
-- pre-existing engine write path (scheduler, scan runner, scoring, alerts,
-- etc.) working without having to teach each one about organizations; they
-- only ever set workspace_id, and organization_id NOT NULL is satisfied by
-- looking the workspace's organization up (falling back to the default org).
CREATE OR REPLACE FUNCTION scout_fill_organization_id() RETURNS trigger AS $body$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.workspace_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM workspaces WHERE id = NEW.workspace_id;
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := '00000000-0000-0000-0000-000000000001';
  END IF;
  RETURN NEW;
END;
$body$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_targets_org ON targets;
CREATE TRIGGER trg_targets_org BEFORE INSERT ON targets
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_scan_runs_org ON scan_runs;
CREATE TRIGGER trg_scan_runs_org BEFORE INSERT ON scan_runs
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_findings_org ON findings;
CREATE TRIGGER trg_findings_org BEFORE INSERT ON findings
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_scout_scores_org ON scout_scores;
CREATE TRIGGER trg_scout_scores_org BEFORE INSERT ON scout_scores
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_alert_rules_org ON alert_rules;
CREATE TRIGGER trg_alert_rules_org BEFORE INSERT ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_alert_history_org ON alert_history;
CREATE TRIGGER trg_alert_history_org BEFORE INSERT ON alert_history
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_connected_agents_org ON connected_agents;
CREATE TRIGGER trg_connected_agents_org BEFORE INSERT ON connected_agents
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_agent_events_org ON agent_events;
CREATE TRIGGER trg_agent_events_org BEFORE INSERT ON agent_events
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_webhooks_org ON webhooks;
CREATE TRIGGER trg_webhooks_org BEFORE INSERT ON webhooks
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_report_cache_org ON report_cache;
CREATE TRIGGER trg_report_cache_org BEFORE INSERT ON report_cache
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();

DROP TRIGGER IF EXISTS trg_workspace_settings_org ON workspace_settings;
CREATE TRIGGER trg_workspace_settings_org BEFORE INSERT ON workspace_settings
  FOR EACH ROW EXECUTE FUNCTION scout_fill_organization_id();
