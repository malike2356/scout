import {
  AgentStatusResponse,
  FilterPayload,
  FilterResult,
  HealthResponse,
  RegisterAgentPayload,
  RegisterAgentResponse,
  RepositorySecretScanPayload,
  RepositorySecretScanResponse,
  RepositorySecurityPostureResponse,
  ScoutApiError,
  ScoutConfig,
  TrackEventPayload,
  TrackEventResponse,
} from './types.js';

const DEFAULT_BASE_URL = 'https://console.labyrinthscout.com';
const DEFAULT_TIMEOUT_MS = 10_000;

interface RawFilterResult {
  verdict: FilterResult['verdict'];
  filtered_prompt: string;
  risk_level: FilterResult['risk_level'];
  distillation: FilterResult['distillation'];
  finding_id: string | null;
  agent_id?: string;
}

export class Scout {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  readonly agentName?: string;

  constructor(config: ScoutConfig) {
    if (!config?.apiKey) {
      throw new Error('Scout: apiKey is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (
      config.baseUrl ||
      (typeof process !== 'undefined' ? process.env?.SCOUT_API_URL : undefined) ||
      DEFAULT_BASE_URL
    ).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.agentName = config.agentName;
  }

  async registerAgent(payload: RegisterAgentPayload): Promise<RegisterAgentResponse> {
    return this.request<RegisterAgentResponse>('POST', '/v1/agents/register', {
      name: payload.name,
      type: payload.type,
      tools: payload.tools,
      metadata: payload.metadata,
    });
  }

  async filter(payload: FilterPayload): Promise<FilterResult> {
    if (!payload.agentId) {
      throw new Error('Scout.filter: agentId is required');
    }
    const result = await this.request<RawFilterResult>('POST', '/v1/prompts/filter', {
      prompt: payload.prompt,
      agent_id: payload.agentId,
      tools: payload.tools,
      metadata: payload.metadata,
    });
    return {
      verdict: result.verdict,
      filtered_prompt: result.filtered_prompt,
      risk_level: result.risk_level,
      distillation: result.distillation,
      finding_id: result.finding_id,
      agent_id: result.agent_id,
      blocked: result.verdict === 'blocked',
      reason: result.distillation?.layer_3,
    };
  }

  async trackEvent(payload: TrackEventPayload): Promise<TrackEventResponse> {
    return this.request<TrackEventResponse>('POST', '/v1/events', {
      agent_id: payload.agentId,
      event_type: payload.type,
      tool_name: payload.toolName,
      tool_args: payload.toolArgs,
      tool_result: payload.toolResult,
      duration_ms: payload.durationMs,
      session_id: payload.sessionId,
    });
  }

  async getStatus(agentId: string): Promise<AgentStatusResponse> {
    return this.request<AgentStatusResponse>('GET', `/v1/agents/${encodeURIComponent(agentId)}/status`);
  }

  /** Throws ScoutApiError(code=kill_switch) if the agent is suspended. */
  async assertAgentRunnable(agentId: string): Promise<AgentStatusResponse> {
    const status = await this.getStatus(agentId);
    if (status.kill_switch_active || status.status === 'suspended' || status.status === 'killed') {
      throw new ScoutApiError(
        'Agent is suspended. Tool and prompt processing are blocked until an operator resumes it.',
        403,
        { error: 'kill_switch', agent_id: agentId, status: status.status, kill_switch_active: true },
      );
    }
    return status;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/v1/health', undefined, { auth: false });
  }

  /** Deliver a signed, redacted repository secret-scan envelope. Never include secret values. */
  async ingestRepositorySecretScan(
    payload: RepositorySecretScanPayload,
  ): Promise<RepositorySecretScanResponse> {
    return this.request<RepositorySecretScanResponse>('POST', '/v1/repository-secret-scans', payload);
  }

  async getRepositorySecurityPosture(): Promise<RepositorySecurityPostureResponse> {
    return this.request<RepositorySecurityPostureResponse>('GET', '/v1/repository-security/posture');
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    options: { auth?: boolean } = {},
  ): Promise<T> {
    const { auth = true } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const data = text ? safeParse(text) : undefined;

      if (!response.ok) {
        const obj = data && typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
        const message =
          (obj?.message != null ? String(obj.message) : undefined) ||
          (obj?.error != null ? String(obj.error) : undefined) ||
          `Scout API request failed with status ${response.status}`;
        throw new ScoutApiError(message, response.status, data);
      }

      return data as T;
    } catch (err) {
      if (err instanceof ScoutApiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ScoutApiError(`Scout API request timed out after ${this.timeoutMs}ms`, 0);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ScoutApiError(`Scout API request failed: ${message}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
