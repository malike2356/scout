-- Report cache and webhooks tables
CREATE TABLE IF NOT EXISTS report_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  type TEXT NOT NULL,
  date_range JSONB DEFAULT '{}',
  html TEXT,
  pdf_data BYTEA,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT[] DEFAULT '{finding_new,score_drop}',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
