-- Scout Engine Core Schema
-- Targets: what Scout scans

-- Workspaces table (shared with Carina, defined here for standalone Scout)
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,                          -- "Production Web Server"
  type TEXT NOT NULL CHECK (type IN ('domain', 'ip', 'ip_range', 'url')),
  value TEXT NOT NULL,                         -- "example.com", "10.0.0.1", "10.0.0.0/24"
  schedule TEXT NOT NULL DEFAULT 'weekly',     -- 'hourly', 'daily', 'weekly', 'monthly'
  enabled BOOLEAN DEFAULT TRUE,
  last_scan_at TIMESTAMP,
  next_scan_at TIMESTAMP,
  scan_config JSONB DEFAULT '{}',             -- Per-target tool config overrides
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, type, value)
);

-- Scan runs: each time Scout scans a target
CREATE TABLE IF NOT EXISTS scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES targets(id),
  workspace_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  tools_run INTEGER DEFAULT 0,
  tools_failed INTEGER DEFAULT 0,
  findings_total INTEGER DEFAULT 0,
  findings_new INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tool executions within a scan run
CREATE TABLE IF NOT EXISTS tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id UUID NOT NULL REFERENCES scan_runs(id),
  tool_name TEXT NOT NULL,                     -- 'nmap', 'nuclei', 'amass', etc.
  tool_category TEXT NOT NULL,                 -- 'recon', 'vuln_scan', 'fuzzing', 'ids', 'reporting'
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timed_out')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  exit_code INTEGER,
  raw_output TEXT,
  raw_error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Findings: what Scout discovered
CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id UUID NOT NULL REFERENCES scan_runs(id),
  target_id UUID NOT NULL REFERENCES targets(id),
  workspace_id UUID NOT NULL,
  tool_name TEXT NOT NULL,
  finding_type TEXT NOT NULL CHECK (finding_type IN (
    'open_port', 'service', 'subdomain', 'vulnerability', 'cve',
    'exposed_secret', 'misconfiguration', 'certificate_issue',
    'suspicious_activity', 'intrusion_alert', 'compliance_gap'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  title TEXT NOT NULL,
  description TEXT,
  evidence JSONB,                              -- Raw tool output, structured
  affected_host TEXT,
  affected_port INTEGER,
  cve_id TEXT,                                 -- CVE-2026-XXXX if applicable
  cvss_score DECIMAL(3,1),                     -- CVSS score if applicable
  cvss_vector TEXT,                            -- CVSS vector string
  remediation TEXT,                            -- Suggested fix
  reference_urls TEXT[],                       -- Links to advisories
  fingerprint TEXT,                            -- Dedup key: hash of type+host+port+title
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  seen_count INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'false_positive', 'remediated', 'wont_fix', 'duplicate')),
  resolved_at TIMESTAMP,
  resolved_by UUID,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Unique index to prevent duplicate findings
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_fingerprint
  ON findings(fingerprint, target_id)
  WHERE status NOT IN ('false_positive', 'duplicate');

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_findings_workspace ON findings(workspace_id, severity, status);
CREATE INDEX IF NOT EXISTS idx_findings_target ON findings(target_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_cve ON findings(cve_id) WHERE cve_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_runs_target ON scan_runs(target_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_executions_run ON tool_executions(scan_run_id);

-- Asset inventory: discovered assets across all scans
CREATE TABLE IF NOT EXISTS discovered_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('domain', 'subdomain', 'ip', 'service', 'url', 'certificate')),
  value TEXT NOT NULL,
  source_tool TEXT NOT NULL,                   -- Which tool discovered this
  source_target_id UUID REFERENCES targets(id),
  first_seen_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(workspace_id, asset_type, value)
);

-- Compliance evidence (for SOC2 score calculation)
CREATE TABLE IF NOT EXISTS compliance_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  control_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  evidence_data JSONB DEFAULT '{}',
  collected_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
