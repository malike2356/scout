-- Scout Scores table
CREATE TABLE IF NOT EXISTS scout_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  total INTEGER NOT NULL,
  categories JSONB NOT NULL,       -- { exposure, vulnerabilities, compliance, agentSafety }
  weights JSONB NOT NULL,
  finding_counts JSONB NOT NULL,
  calculated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_workspace ON scout_scores(workspace_id, calculated_at DESC);

-- Score change alerts: notify when score drops significantly
CREATE TABLE IF NOT EXISTS score_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  previous_score INTEGER NOT NULL,
  current_score INTEGER NOT NULL,
  change INTEGER NOT NULL,
  reason TEXT,                     -- "3 new critical CVEs", "5 high findings resolved"
  notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
