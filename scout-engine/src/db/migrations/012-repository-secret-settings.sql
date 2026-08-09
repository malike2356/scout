-- Workspace-level repository secret-scan settings and manual scan request queue.
-- Settings hold policy only; never store secrets or source content.

CREATE TABLE IF NOT EXISTS repo_secret_workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days >= 30 AND retention_days <= 2555),
  overdue_days INTEGER NOT NULL DEFAULT 14 CHECK (overdue_days >= 1 AND overdue_days <= 365),
  severity_routing JSONB NOT NULL DEFAULT '{"critical":"immediate","high":"immediate","medium":"digest","low":"digest","info":"digest"}'::jsonb,
  path_display_policy TEXT NOT NULL DEFAULT 'relative'
    CHECK (path_display_policy IN ('relative', 'basename')),
  commit_display_policy TEXT NOT NULL DEFAULT 'allow'
    CHECK (commit_display_policy IN ('allow', 'omit')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS repo_secret_scan_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector_id UUID NOT NULL REFERENCES repo_connectors(id),
  mode TEXT NOT NULL CHECK (mode IN ('current', 'staged', 'history', 'environment')),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'acknowledged', 'cancelled', 'expired')),
  requested_by TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_repo_secret_scan_requests_connector
  ON repo_secret_scan_requests(organization_id, workspace_id, connector_id, created_at DESC);
