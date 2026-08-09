export type Plan = 'free' | 'monitor' | 'govern' | 'team';

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  plan?: Plan;
  subscription_status?: string;
  created_at?: string;
}

export interface AuthResponse {
  token: string;
  organization?: Organization;
}

export interface OverviewData {
  agents_online?: number;
  agents_total?: number;
  alerts_today?: number;
  security_score?: number;
  api_calls_today?: number;
  score_trend?: Array<{ date: string; score: number }>;
  recent_alerts?: Alert[];
}

export type AgentStatus = 'active' | 'idle' | 'suspended' | 'killed' | 'offline' | string;

export interface Agent {
  id: string;
  name?: string;
  status?: AgentStatus;
  last_seen_at?: string;
  score?: number;
  tools?: string[];
  events?: AgentEvent[];
  created_at?: string;
}

export interface AgentEvent {
  id?: string;
  type?: string;
  message?: string;
  created_at?: string;
  severity?: string;
}

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical' | string;
export type AlertStatus = 'open' | 'resolved' | 'acknowledged' | string;

export interface Alert {
  id: string;
  title?: string;
  message?: string;
  severity?: AlertSeverity;
  status?: AlertStatus;
  agent_id?: string;
  agent_name?: string;
  created_at?: string;
  resolved_at?: string;
}

export interface ScoreCategory {
  category: string;
  score: number;
}

export interface ScoresData {
  current?: number;
  trend?: Array<{ date: string; score: number }>;
  categories?: ScoreCategory[];
}

export interface ApiKey {
  id: string;
  name?: string;
  prefix?: string;
  key_prefix?: string;
  created_at?: string;
  last_used_at?: string;
  revoked_at?: string | null;
}

export interface ApiKeyCreated extends ApiKey {
  key?: string;
  secret?: string;
}

export interface AlertSettings {
  alert_email: string;
  telegram_chat_id: string;
  slack_webhook_url: string;
}

export interface KeprixDashboardStatus {
  configured?: boolean;
  monitored?: boolean;
  kill_switch_active?: boolean;
  target?: { name?: string; url?: string; sensors?: string[] } | null;
  registered_targets?: Array<{ id?: string; name?: string; url?: string; enabled?: boolean }>;
  health?: { ok?: boolean; latency_ms?: number; error?: string };
  agents?: { total?: number; online?: number; suspended?: number };
  stats_24h?: {
    passed?: number;
    blocked?: number;
    flagged?: number;
    tool_calls?: number;
    responses?: number;
    anomalies?: number;
  };
  sensors?: unknown;
}

export type RemediationStatus =
  | 'open'
  | 'acknowledged'
  | 'rotation-required'
  | 'rotation-in-progress'
  | 'verification-pending'
  | 'resolved'
  | 'accepted-risk'
  | 'false-positive'
  | string;

export interface RepoOpenCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  open_total: number;
}

export interface RepositorySummary {
  id: string;
  connector_key: string;
  repository_alias: string;
  product?: string | null;
  status: string;
  last_ingest_at?: string | null;
  open_counts?: RepoOpenCounts;
  scan_modes?: Record<string, { status?: string; observed_at?: string } | null>;
  last_success_at?: string | null;
  hook_installed?: boolean | null;
  hook_last_check_at?: string | null;
  path_display_policy?: string;
  commit_display_policy?: string;
  retention_days?: number;
}

export interface RepoSecretFinding {
  id: string;
  connector_id: string;
  fingerprint: string;
  rule_id: string;
  severity: string;
  relative_path?: string | null;
  line?: number | null;
  commit_id?: string | null;
  remediation_status: RemediationStatus;
  first_seen_at?: string;
  last_seen_at?: string;
  seen_count?: number;
  remediation_owner?: string | null;
  due_at?: string | null;
  accepted_risk_expires_at?: string | null;
}

export interface RepoSecretScanRun {
  id: string;
  connector_id: string;
  scan_id: string;
  mode: string;
  scanner_name: string;
  scanner_version: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  observed_at?: string;
  counts?: RepoOpenCounts | Record<string, number>;
  findings_accepted?: number;
  findings_deduped?: number;
  hook_installed?: boolean | null;
  environment_policy_ok?: boolean | null;
  environment_policy_detail?: string | null;
  duration_ms?: number | null;
  safe_retry?: boolean;
  warnings?: string[];
  correlation_id?: string;
}

export interface RepoSecurityOverview {
  schema_version?: string;
  repositories_protected: number;
  open_findings: RepoOpenCounts;
  last_successful_scan_at?: string | null;
  hook_coverage?: { connectors_reporting: number; hooks_installed: number };
  trend?: { direction: string; open_delta: number };
  open_critical_high?: number;
  overdue_remediation?: number;
  failed_scans?: number;
  pending_scan_requests?: number;
  overdue_days?: number;
}

export interface RepoSecuritySettings {
  retention_days: number;
  overdue_days: number;
  severity_routing: Record<string, string>;
  path_display_policy: 'relative' | 'basename' | string;
  commit_display_policy: 'allow' | 'omit' | string;
}
