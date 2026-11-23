import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  AgentStatusResponse,
  FilterPayload,
  FilterResult,
  HealthResponse,
  IdentityChallengeResponse,
  IdentityRegisterResponse,
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

/** Generates a fresh secp256k1 keypair for use with registerIdentity(). Store the private key securely. */
export function generateIdentityKey(): { privateKey: `0x${string}`; address: `0x${string}` } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

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
  private readonly identityPrivateKey?: `0x${string}`;
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
    this.identityPrivateKey = config.identityPrivateKey;
  }

  /** One-time nonce the agent must sign to prove it controls `address` before Scout will register it. */
  async getIdentityChallenge(agentId: string): Promise<IdentityChallengeResponse> {
    return this.request<IdentityChallengeResponse>(
      'GET',
      `/v1/agents/${encodeURIComponent(agentId)}/identity/challenge`,
    );
  }

  /**
   * Proves control of a key and anchors agentId <-> address in Scout's
   * on-chain identity registry (ScoutAgentIdentity.sol, Sepolia). Uses
   * `privateKey` if given, else config.identityPrivateKey, else generates a
   * fresh one via generateIdentityKey() - in which case, save the returned
   * key yourself; Scout never stores it.
   */
  async registerIdentity(
    agentId: string,
    privateKey?: `0x${string}`,
    metadataURI?: string,
  ): Promise<IdentityRegisterResponse & { privateKeyUsed: `0x${string}` }> {
    const key = privateKey ?? this.identityPrivateKey ?? generateIdentityKey().privateKey;
    const account = privateKeyToAccount(key);
    const challenge = await this.getIdentityChallenge(agentId);
    const signature = await account.signMessage({ message: challenge.message });

    const result = await this.request<IdentityRegisterResponse>(
      'POST',
      `/v1/agents/${encodeURIComponent(agentId)}/identity/register`,
      {
        address: account.address,
        nonce: challenge.nonce,
        signature,
        metadata_uri: metadataURI,
      },
    );
    return { ...result, privateKeyUsed: key };
  }

  /**
   * Signs a canonical envelope the way scout-engine's strict-mode
   * (organizations.require_onchain_identity) verifier expects: a JSON
   * string containing agent_id + timestamp + whatever domain fields the
   * caller passes, signed as a whole so key order can't be gamed.
   */
  private async signEnvelope(
    agentId: string,
    fields: Record<string, unknown>,
    privateKey?: `0x${string}`,
  ): Promise<{ signed_message: string; signature: string } | null> {
    const key = privateKey ?? this.identityPrivateKey;
    if (!key) return null;
    const account = privateKeyToAccount(key);
    const signed_message = JSON.stringify({ agent_id: agentId, timestamp: Date.now(), ...fields });
    const signature = await account.signMessage({ message: signed_message });
    return { signed_message, signature };
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
    const envelope = await this.signEnvelope(payload.agentId, { prompt: payload.prompt }, payload.signWith);
    const result = await this.request<RawFilterResult>('POST', '/v1/prompts/filter', {
      prompt: payload.prompt,
      agent_id: payload.agentId,
      tools: payload.tools,
      metadata: payload.metadata,
      ...envelope,
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
    // Signed as a single-event submission (event_count: 1) - matches how
    // scout-engine's /v1/events wraps one posted object into a 1-element
    // batch before checking the signature envelope.
    const envelope = await this.signEnvelope(payload.agentId, { event_count: 1 }, payload.signWith);
    return this.request<TrackEventResponse>('POST', '/v1/events', {
      agent_id: payload.agentId,
      event_type: payload.type,
      tool_name: payload.toolName,
      tool_args: payload.toolArgs,
      tool_result: payload.toolResult,
      duration_ms: payload.durationMs,
      session_id: payload.sessionId,
      ...envelope,
    });
  }

  async getStatus(agentId: string): Promise<AgentStatusResponse> {
    return this.request<AgentStatusResponse>('GET', `/v1/agents/${encodeURIComponent(agentId)}/status`);
  }

  /** Throws ScoutApiError(code=kill_switch|global_kill_switch) if the agent (or its org) is suspended. */
  async assertAgentRunnable(agentId: string): Promise<AgentStatusResponse> {
    const status = await this.getStatus(agentId);
    if (status.kill_switch_active || status.status === 'suspended' || status.status === 'killed') {
      const scope = status.kill_switch_scope as string | undefined;
      throw new ScoutApiError(
        scope === 'global'
          ? 'Organization-wide kill switch is active. All agents are blocked until an operator resumes it.'
          : 'Agent is suspended. Tool and prompt processing are blocked until an operator resumes it.',
        403,
        {
          error: scope === 'global' ? 'global_kill_switch' : 'kill_switch',
          agent_id: agentId,
          status: status.status,
          kill_switch_active: true,
          scope,
          reason: status.suspension_reason ?? null,
        },
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
