-- Repository secret scanning (standalone Scout).
-- Lifecycle truth lives in repo_secret_* tables. Optional mirror rows in findings
-- (finding_type = exposed_secret) feed existing Scout Score exposure without
-- duplicating remediation state. See src/secret-scanning/DECISION.md.

-- Agent and secret-scan paths insert findings without a network target/scan_run.
ALTER TABLE findings ALTER COLUMN scan_run_id DROP NOT NULL;
ALTER TABLE findings ALTER COLUMN target_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS repo_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector_key TEXT NOT NULL,
  repository_alias TEXT NOT NULL,
  product TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'offboarded')),
  path_display_policy TEXT NOT NULL DEFAULT 'relative'
    CHECK (path_display_policy IN ('relative', 'basename')),
  commit_display_policy TEXT NOT NULL DEFAULT 'allow'
    CHECK (commit_display_policy IN ('allow', 'omit')),
  retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days >= 30 AND retention_days <= 2555),
  revoked_at TIMESTAMP,
  last_ingest_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, workspace_id, connector_key)
);

CREATE INDEX IF NOT EXISTS idx_repo_connectors_workspace
  ON repo_connectors(organization_id, workspace_id, status);

CREATE TABLE IF NOT EXISTS repo_secret_scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector_id UUID NOT NULL REFERENCES repo_connectors(id),
  client_scan_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('current', 'staged', 'history', 'environment')),
  scanner_name TEXT NOT NULL,
  scanner_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'partial')),
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL,
  observed_at TIMESTAMP NOT NULL,
  count_critical INTEGER NOT NULL DEFAULT 0,
  count_high INTEGER NOT NULL DEFAULT 0,
  count_medium INTEGER NOT NULL DEFAULT 0,
  count_low INTEGER NOT NULL DEFAULT 0,
  count_info INTEGER NOT NULL DEFAULT 0,
  findings_accepted INTEGER NOT NULL DEFAULT 0,
  findings_deduped INTEGER NOT NULL DEFAULT 0,
  hook_installed BOOLEAN,
  hook_last_check_at TIMESTAMP,
  environment_policy_ok BOOLEAN,
  environment_policy_detail TEXT,
  idempotency_key TEXT NOT NULL,
  signature_algorithm TEXT,
  signature_nonce TEXT,
  correlation_id TEXT NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  retain_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, workspace_id, idempotency_key),
  UNIQUE (organization_id, workspace_id, connector_id, client_scan_id)
);

CREATE INDEX IF NOT EXISTS idx_repo_secret_scan_runs_connector
  ON repo_secret_scan_runs(organization_id, workspace_id, connector_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_repo_secret_scan_runs_status
  ON repo_secret_scan_runs(organization_id, workspace_id, status, observed_at DESC);

CREATE TABLE IF NOT EXISTS repo_secret_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector_id UUID NOT NULL REFERENCES repo_connectors(id),
  scout_finding_id UUID REFERENCES findings(id),
  fingerprint TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  relative_path TEXT,
  line_number INTEGER,
  commit_id TEXT,
  remediation_status TEXT NOT NULL DEFAULT 'open'
    CHECK (remediation_status IN (
      'open',
      'acknowledged',
      'rotation-required',
      'rotation-in-progress',
      'verification-pending',
      'resolved',
      'accepted-risk',
      'false-positive'
    )),
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_scan_run_id UUID REFERENCES repo_secret_scan_runs(id),
  seen_count INTEGER NOT NULL DEFAULT 1,
  remediation_owner TEXT,
  due_at TIMESTAMP,
  accepted_risk_expires_at TIMESTAMP,
  resolution_evidence TEXT,
  retain_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One open lifecycle row per tenant-local fingerprint (reopen creates a new cycle
-- by returning resolved/fp/accepted-risk rows to open and bumping last_seen).
CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_secret_findings_fingerprint_active
  ON repo_secret_findings(organization_id, workspace_id, connector_id, fingerprint)
  WHERE remediation_status NOT IN ('resolved', 'accepted-risk', 'false-positive');

CREATE INDEX IF NOT EXISTS idx_repo_secret_findings_list
  ON repo_secret_findings(organization_id, workspace_id, remediation_status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_repo_secret_findings_connector
  ON repo_secret_findings(organization_id, workspace_id, connector_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS repo_secret_remediation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  finding_id UUID NOT NULL REFERENCES repo_secret_findings(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_note TEXT,
  correlation_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repo_secret_remediation_finding
  ON repo_secret_remediation_events(organization_id, workspace_id, finding_id, created_at DESC);

CREATE TABLE IF NOT EXISTS repo_secret_ingestion_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  connector_id UUID REFERENCES repo_connectors(id),
  idempotency_key TEXT,
  client_scan_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'accepted',
    'duplicate',
    'rejected',
    'unauthorized',
    'rate_limited',
    'error'
  )),
  http_status INTEGER NOT NULL,
  error_code TEXT,
  correlation_id TEXT NOT NULL,
  findings_accepted INTEGER NOT NULL DEFAULT 0,
  findings_deduped INTEGER NOT NULL DEFAULT 0,
  -- Metadata only: never store request bodies or secret material.
  request_byte_length INTEGER,
  schema_version TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repo_secret_ingestion_receipts_org
  ON repo_secret_ingestion_receipts(organization_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repo_secret_ingestion_receipts_idem
  ON repo_secret_ingestion_receipts(organization_id, workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
