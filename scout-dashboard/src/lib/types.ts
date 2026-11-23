export type Plan = 'free' | 'monitor' | 'govern' | 'team';

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  plan?: Plan;
  subscription_status?: string;
  global_kill_active?: boolean;
  global_kill_reason?: string | null;
  global_kill_at?: string | null;
  auto_kill_threshold?: number | null;
  require_onchain_identity?: boolean;
  created_at?: string;
}

export interface KillSwitchEvent {
  id: string;
  organization_id: string;
  agent_id: string | null;
  scope: 'agent' | 'global';
  action: 'kill' | 'resume';
  source: 'manual' | 'policy' | 'channel';
  reason?: string | null;
  triggered_by?: string | null;
  chain_tx_hash?: string | null;
  created_at: string;
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
  suspension_reason?: string | null;
  suspended_at?: string | null;
  suspended_by?: string | null;
  kill_source?: 'manual' | 'policy' | 'channel' | null;
  chain_address?: string | null;
  chain_tx_hash_registered?: string | null;
  chain_tx_hash_revoked?: string | null;
  identity_verified_onchain?: boolean;
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

// OpenShell governance extension (openshell-governance-service, proxied
// through scout-engine's /api/dashboard/governance/* behind the same
// dashboard login). Field names below are intentionally mixed case: rows
// selected straight off Postgres (BoundaryDecision, BoundaryGrant,
// GrantObservation, PolicyProvenanceEvent) are snake_case because the
// service forwards `pool.query` rows as-is; the health/gaps/policy-chain
// summaries are camelCase because those handlers build plain objects by
// hand. This matches openshell-governance-service/src/{evidence,linkage}/http.ts
// and src/health.ts exactly - do not "normalize" one style without
// re-checking those handlers.
export type GovernanceVerdict = 'allow' | 'deny' | string;

export interface BoundaryDecision {
  decision_uid: string;
  correlation_id: string | null;
  occurred_at: string;
  layer: 'control' | 'data' | string;
  rpc: string;
  phase: string | null;
  tenant_id: string;
  workspace_id: string | null;
  sandbox_id: string | null;
  subject_label: string | null;
  verdict: GovernanceVerdict;
  rule_id: string | null;
  reason: string;
  policy_slug: string;
  policy_version: number;
  policy_digest: string;
  authority_kind: string;
  authority_ref: string | null;
  residual_risk: string | null;
  latency_us: number | null;
  evaluation_mode: string;
  service_version: string;
}

export interface PolicyProvenanceEvent {
  event: 'authored' | 'signed' | 'activated' | 'superseded' | 'revoked' | string;
  actor: string;
  actor_kind: 'human' | 'agent' | 'system' | string;
  signature_subject: string | null;
  note: string | null;
  occurred_at: string;
}

export interface BoundaryGrant {
  id: string;
  decision_uid: string;
  tenant_id: string;
  sandbox_id: string;
  capability: string;
  policy_digest: string;
  effective_from: string;
  effective_to: string | null;
  closed_reason: 'sandbox_ended' | 'policy_superseded' | 'revoked' | null;
}

export interface GrantObservation {
  grant_id?: string;
  observed_at: string;
  kind: 'outbound_call' | 'data_egress' | 'credential_use' | 'policy_change' | string;
  destination_host: string | null;
  outcome: 'succeeded' | 'denied' | 'errored' | string;
  byte_count: number | null;
  detail: Record<string, unknown> | null;
}

export interface PolicyProvenanceChain {
  policyDigest: string;
  policySlug: string | null;
  version: number | null;
  events: PolicyProvenanceEvent[];
}

export interface GovernanceGaps {
  decisionsWithoutGrants: Array<{
    decision_uid: string;
    rpc: string;
    phase: string | null;
    sandbox_id: string | null;
    occurred_at: string;
  }>;
  decisionsWithoutGrantsCount: number;
  grantsWithoutObservations: Array<{
    id: string;
    sandbox_id: string;
    capability: string;
    effective_from: string;
    effective_to: string | null;
    closed_reason: string | null;
  }>;
  grantsWithoutObservationsCount: number;
}

export interface GovernanceHealth {
  evidence: {
    queueDepth: number;
    oldestQueuedAgeMs: number | null;
    drainLagMs: number | null;
    lastDrainAt: string | null;
    decisionsWrittenTotal: number;
    writeFailuresTotal: number;
    deadLetterTotal: number;
    droppedDueToFullBufferTotal: number;
    refusedIncompleteTotal: number;
  };
  linkage: {
    queueDepth: number;
    lastDrainAt: string | null;
    drainLagMs: number | null;
    grantsOpenedTotal: number;
    grantsClosedTotal: number;
    observationsWrittenTotal: number;
    observationsUnattributedTotal: number;
    grantOpenSkippedUnresolvedSandboxTotal: number;
  };
  policy: {
    loadedAt: string;
    policyCount: number;
    bindingCount: number;
    digests: Array<{ policySlug: string; version: number; digestSha256: string }>;
    lastReloadAttemptAt: string | null;
    lastSuccessfulReloadAt: string | null;
    lastReloadError: string | null;
  };
}
