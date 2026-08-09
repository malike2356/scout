import type {
  Agent,
  ApiKey,
  ApiKeyCreated,
  Alert,
  AuthResponse,
  AlertSettings,
  Organization,
  OverviewData,
  ScoresData,
  KeprixDashboardStatus,
  RepositorySummary,
  RepoSecretFinding,
  RepoSecretScanRun,
  RepoSecurityOverview,
  RepoSecuritySettings,
} from './types';

export const API_BASE =
  process.env.NEXT_PUBLIC_SCOUT_API_URL?.replace(/\/$/, '') || 'http://localhost:4444';

export const TOKEN_KEY = 'scout_dashboard_token';
export const ORG_KEY = 'scout_dashboard_org';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function getStoredOrg(): Organization | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(ORG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Organization;
  } catch {
    return null;
  }
}

export function setStoredOrg(org: Organization | null): void {
  if (typeof window === 'undefined') return;
  if (org) {
    window.localStorage.setItem(ORG_KEY, JSON.stringify(org));
  } else {
    window.localStorage.removeItem(ORG_KEY);
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (auth) {
    const token = getToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the Scout API. Is scout-engine running?', 0);
  }

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const obj = data && typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    const message =
      (obj?.message != null ? String(obj.message) : undefined) ||
      (obj?.error != null ? String(obj.error) : undefined) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  signup(payload: { email: string; password: string; organization_name: string; name?: string }) {
    return request<AuthResponse>('/api/dashboard/auth/signup', {
      method: 'POST',
      body: payload,
      auth: false,
    });
  },

  login(payload: { email: string; password: string }) {
    return request<AuthResponse>('/api/dashboard/auth/login', {
      method: 'POST',
      body: payload,
      auth: false,
    });
  },

  async overview() {
    const raw = await request<Record<string, unknown>>('/api/dashboard/overview');
    return {
      agents_online: Number(raw.agents_active ?? raw.agents_online ?? 0),
      agents_total: Number(raw.agents_total ?? 0),
      alerts_today: Number(raw.alerts_today ?? 0),
      security_score:
        raw.scout_score != null
          ? Number(raw.scout_score)
          : raw.security_score != null
            ? Number(raw.security_score)
            : undefined,
      api_calls_today: Number(raw.api_calls_today ?? 0),
      score_trend: (raw.score_trend as OverviewData['score_trend']) ?? [],
      recent_alerts: (raw.recent_alerts as OverviewData['recent_alerts']) ?? [],
    } satisfies OverviewData;
  },

  async agents() {
    const raw = await request<Agent[] | { agents?: Agent[] }>('/api/dashboard/agents');
    return unwrapList(raw, 'agents');
  },

  async agent(id: string) {
    const raw = await request<Agent | { agent?: Agent; events?: Agent['events'] }>(
      `/api/dashboard/agents/${id}`,
    );
    if (raw && typeof raw === 'object' && 'agent' in raw && raw.agent) {
      return { ...raw.agent, events: raw.events ?? raw.agent.events };
    }
    return raw as Agent;
  },

  async alerts() {
    const raw = await request<Alert[] | { alerts?: Alert[] }>('/api/dashboard/alerts');
    return unwrapList(raw, 'alerts');
  },

  alertSettings() {
    return request<AlertSettings>('/api/settings/alerts');
  },

  updateAlertSettings(payload: AlertSettings) {
    return request<{ settings?: AlertSettings; alert_settings?: AlertSettings }>('/api/settings/alerts', {
      method: 'PUT',
      body: payload,
    });
  },

  resolveAlert(id: string) {
    return request<Alert>(`/api/dashboard/alerts/${id}/resolve`, { method: 'POST' });
  },

  async scores() {
    const raw = await request<ScoresData | { scores?: Array<Record<string, unknown>> }>(
      '/api/dashboard/scores',
    );
    if (raw && typeof raw === 'object' && 'scores' in raw && Array.isArray(raw.scores)) {
      const rows = raw.scores;
      const last = rows[rows.length - 1];
      const categoriesRaw = last?.categories;
      const categories =
        categoriesRaw && typeof categoriesRaw === 'object' && !Array.isArray(categoriesRaw)
          ? Object.entries(categoriesRaw as Record<string, number>).map(([category, score]) => ({
              category,
              score: Number(score),
            }))
          : Array.isArray(categoriesRaw)
            ? (categoriesRaw as ScoresData['categories'])
            : [];
      return {
        current: last ? Number(last.total ?? last.score ?? 0) : undefined,
        trend: rows.map((r) => ({
          date: String(r.calculated_at ?? r.date ?? ''),
          score: Number(r.total ?? r.score ?? 0),
        })),
        categories,
      } satisfies ScoresData;
    }
    return raw as ScoresData;
  },

  async apiKeys() {
    const raw = await request<ApiKey[] | { api_keys?: ApiKey[] }>('/api/dashboard/api-keys');
    return unwrapList(raw, 'api_keys');
  },

  async createApiKey(name: string) {
    const raw = await request<ApiKeyCreated | { api_key?: ApiKeyCreated }>('/api/dashboard/api-keys', {
      method: 'POST',
      body: { name },
    });
    if (raw && typeof raw === 'object' && 'api_key' in raw && raw.api_key) {
      return raw.api_key;
    }
    return raw as ApiKeyCreated;
  },

  deleteApiKey(id: string) {
    return request<void>(`/api/dashboard/api-keys/${id}`, { method: 'DELETE' });
  },

  async killswitch(agentId: string) {
    const raw = await request<Agent | { agent?: Agent }>(`/api/dashboard/killswitch/${agentId}`, {
      method: 'POST',
    });
    if (raw && typeof raw === 'object' && 'agent' in raw && raw.agent) return raw.agent;
    return raw as Agent;
  },

  keprixStatus() {
    return request<KeprixDashboardStatus>('/api/dashboard/keprix/status');
  },

  async org() {
    const raw = await request<Organization | { organization?: Organization }>('/api/dashboard/org');
    if (raw && typeof raw === 'object' && 'organization' in raw && raw.organization) {
      return raw.organization;
    }
    return raw as Organization;
  },

  checkout(payload: { plan: string; success_url: string; cancel_url: string }) {
    return request<{ url?: string }>('/api/billing/checkout', {
      method: 'POST',
      body: payload,
    });
  },

  billingPortal() {
    return request<{ url?: string }>('/api/billing/portal');
  },

  repositorySecurityOverview() {
    return request<{ overview: RepoSecurityOverview }>('/api/dashboard/repository-security/overview');
  },

  repositoryConnectors() {
    return request<{ repositories: RepositorySummary[] }>('/api/dashboard/repository-connectors');
  },

  repositoryConnector(id: string) {
    return request<{
      connector: RepositorySummary;
      latest_scan: RepoSecretScanRun | null;
      scan_runs: RepoSecretScanRun[];
      findings: RepoSecretFinding[];
      scan_requests: Array<Record<string, unknown>>;
    }>(`/api/dashboard/repository-connectors/${id}`);
  },

  revokeRepositoryConnector(id: string) {
    return request<{ connector: RepositorySummary }>(
      `/api/dashboard/repository-connectors/${id}/revoke`,
      { method: 'POST' },
    );
  },

  offboardRepositoryConnector(id: string) {
    return request<{ connector: RepositorySummary }>(
      `/api/dashboard/repository-connectors/${id}/offboard`,
      { method: 'POST' },
    );
  },

  exportRepositorySecurityFindings() {
    return request<Record<string, unknown>>('/api/dashboard/repository-security/export');
  },

  requestRepositoryScan(id: string, payload: { mode: string; note?: string }) {
    return request<{ request: Record<string, unknown> }>(
      `/api/dashboard/repository-connectors/${id}/scan-requests`,
      { method: 'POST', body: payload },
    );
  },

  repositoryScan(id: string) {
    return request<{
      scan_run: RepoSecretScanRun;
      ingestion_receipt: Record<string, unknown> | null;
    }>(`/api/dashboard/repository-secret-scans/${id}`);
  },

  repositoryFinding(id: string) {
    return request<{
      finding: RepoSecretFinding;
      remediation_events: Array<Record<string, unknown>>;
    }>(`/api/dashboard/repository-secret-findings/${id}`);
  },

  transitionRepositoryFinding(
    id: string,
    payload: {
      status: string;
      reason: string;
      evidence_note?: string;
      due_at?: string;
      accepted_risk_expires_at?: string;
      remediation_owner?: string;
    },
  ) {
    return request<{ finding: RepoSecretFinding }>(
      `/api/dashboard/repository-secret-findings/${id}/remediation`,
      { method: 'POST', body: payload },
    );
  },

  repositorySecuritySettings() {
    return request<{
      settings: RepoSecuritySettings;
      connectors: Array<{ id: string; repository_alias: string; status: string; connector_key: string }>;
    }>('/api/dashboard/repository-security/settings');
  },

  updateRepositorySecuritySettings(payload: Partial<RepoSecuritySettings>) {
    return request<{ settings: RepoSecuritySettings }>('/api/dashboard/repository-security/settings', {
      method: 'PUT',
      body: payload,
    });
  },
};

export function unwrapList<T>(
  value: T[] | { data?: T[]; items?: T[]; agents?: T[]; alerts?: T[]; api_keys?: T[] } | null | undefined,
  nestedKey?: 'agents' | 'alerts' | 'api_keys',
): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (nestedKey && Array.isArray(value[nestedKey])) return value[nestedKey] as T[];
  return value.data ?? value.items ?? [];
}
