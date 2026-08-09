export interface ScoutConfig {
  /** API key issued from the Scout dashboard, e.g. sk_live_xxx. */
  apiKey: string;
  /**
   * Base URL of the Scout public API (no trailing slash).
   * Defaults to process.env.SCOUT_API_URL, then https://console.labyrinthscout.com
   * (path-proxied /v1 on the same host). Local: http://localhost:4444
   */
  baseUrl?: string;
  agentName?: string;
  timeoutMs?: number;
}

export interface RegisterAgentPayload {
  name: string;
  type?: string;
  tools?: string[];
  metadata?: Record<string, unknown>;
}

export interface RegisterAgentResponse {
  agent_id: string;
  id: string;
  monitoring_token: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

export interface FilterPayload {
  prompt: string;
  /** Required by the engine for kill-switch enforcement. */
  agentId: string;
  tools?: string[];
  metadata?: Record<string, unknown>;
}

export type FilterVerdict = 'allowed' | 'flagged' | 'blocked';
export type FilterRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface FilterResult {
  verdict: FilterVerdict;
  filtered_prompt: string;
  risk_level: FilterRiskLevel;
  distillation: {
    layer_1: string;
    layer_2: string;
    layer_3: string;
  };
  finding_id: string | null;
  agent_id?: string;
  blocked: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface TrackEventPayload {
  agentId: string;
  type: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  durationMs?: number;
  sessionId?: string;
  message?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical' | string;
  metadata?: Record<string, unknown>;
}

export interface TrackEventResponse {
  accepted: number;
  rejected: number;
  [key: string]: unknown;
}

export interface AgentStatusResponse {
  agent_id: string;
  name: string;
  type: string;
  status: string;
  kill_switch_active?: boolean;
  last_heartbeat: string | null;
  last_event: Record<string, unknown> | null;
  scout_score: number | null;
  created_at: string;
  [key: string]: unknown;
}

export interface HealthResponse {
  status?: string;
  [key: string]: unknown;
}

/** Versioned redacted repository secret-scan envelope (schema 1.0.0). */
export interface RepositorySecretScanPayload {
  schema_version: '1.0.0';
  connector_key: string;
  repository_alias: string;
  product?: string;
  scan_id: string;
  mode: 'current' | 'staged' | 'history' | 'environment';
  scanner_name: string;
  scanner_version: string;
  started_at: string;
  completed_at: string;
  observed_at: string;
  status: 'completed' | 'failed' | 'partial';
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findings: Array<{
    rule_id: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    relative_path?: string;
    line?: number;
    commit_id?: string;
    fingerprint: string;
  }>;
  hook?: { installed: boolean; last_check_at?: string };
  environment_policy?: { ok: boolean; detail?: string };
  idempotency_key: string;
  signature: {
    algorithm: 'hmac-sha256';
    timestamp: string;
    nonce: string;
    digest: string;
  };
  [key: string]: unknown;
}

export interface RepositorySecretScanResponse {
  scan_run_id: string;
  connector_id: string;
  duplicate: boolean;
  findings_accepted: number;
  findings_deduped: number;
  correlation_id: string;
  [key: string]: unknown;
}

export interface RepositorySecurityPostureResponse {
  posture: {
    schema_version: string;
    repositories_protected: number;
    open_findings: Record<string, number>;
    last_successful_scan_at: string | null;
    hook_coverage: {
      connectors_reporting: number;
      hooks_installed: number;
    };
    trend: { direction: string; open_delta: number };
    deep_links: { dashboard_path: string };
  };
  correlation_id: string;
  [key: string]: unknown;
}

export class ScoutApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code: string;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ScoutApiError';
    this.status = status;
    this.body = body;
    this.code =
      body && typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error?: unknown }).error)
        : 'error';
  }
}
