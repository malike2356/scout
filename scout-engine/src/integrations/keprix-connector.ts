/**
 * Scout -> Keprix connector (C04).
 * Registers Keprix as a monitored runtime target and propagates kill/resume.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yamljs';
import { db } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const KEPRIX_SENSORS = [
  { id: 'keprix_prompt_sensor', monitors: 'Prompt injection patterns, sensitive data leakage' },
  { id: 'keprix_tool_sensor', monitors: 'Unusual tool call patterns, tool abuse, excessive calls' },
  { id: 'keprix_token_sensor', monitors: 'Token usage spikes, cost anomalies' },
  { id: 'keprix_session_sensor', monitors: 'Session hijacking, cross-workspace access attempts' },
] as const;

export interface KeprixTargetConfig {
  type: 'keprix';
  name: string;
  url: string;
  auth_token: string;
  health_check_interval?: string;
  prompt_filter_enabled?: boolean;
  kill_switch_enabled?: boolean;
  sensors?: string[];
  workspace_id?: string | null;
  agent_id?: string | null;
  organization_id?: string | null;
  enabled?: boolean;
}

export interface KeprixKillPayload {
  workspace_id?: string | null;
  scope?: 'workspace' | 'agent_global';
  reason?: string;
  activated_by?: string;
  channel?: string;
  command?: string;
  operator_id?: string;
}

export interface KeprixPropagateResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
  body?: unknown;
  latency_ms: number;
  url?: string;
}

function expandEnv(value: string): string {
  return value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (_m, key: string, fallback?: string) => {
    const envVal = process.env[key];
    if (envVal != null && envVal !== '') return envVal;
    return fallback ?? '';
  });
}

export function loadTargetsYaml(configPath?: string): KeprixTargetConfig | null {
  const candidates = [
    configPath,
    process.env.SCOUT_TARGETS_CONFIG,
    path.resolve(__dirname, '../../config/targets.yaml'),
    path.resolve(process.cwd(), 'config/targets.yaml'),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = YAML.load(file) as { targets?: { keprix?: Record<string, unknown> } };
      const keprix = raw?.targets?.keprix;
      if (!keprix || typeof keprix !== 'object') continue;
      const url = expandEnv(String(keprix.url ?? ''));
      const auth_token = expandEnv(String(keprix.auth_token ?? ''));
      if (!url) continue;
      return {
        type: 'keprix',
        name: String(keprix.name ?? 'keprix-aiva'),
        url: url.replace(/\/$/, ''),
        auth_token,
        health_check_interval: String(keprix.health_check_interval ?? '15s'),
        prompt_filter_enabled: keprix.prompt_filter_enabled !== false,
        kill_switch_enabled: keprix.kill_switch_enabled !== false,
        sensors: Array.isArray(keprix.sensors)
          ? keprix.sensors.map(String)
          : KEPRIX_SENSORS.map((s) => s.id),
        enabled: true,
      };
    } catch (err) {
      console.warn('[scout:keprix] Failed to load targets.yaml:', err instanceof Error ? err.message : err);
    }
  }
  return null;
}

export function resolveKeprixConfig(overrides?: Partial<KeprixTargetConfig>): KeprixTargetConfig | null {
  const fromYaml = loadTargetsYaml();
  const envUrl = (process.env.KEPRIX_URL || process.env.SCOUT_KEPRIX_URL || '').replace(/\/$/, '');
  const envToken =
    process.env.KEPRIX_SCOUT_KILL_TOKEN ||
    process.env.CARINA_KEPRIX_SHARED_TOKEN ||
    process.env.SCOUT_KEPRIX_AUTH_TOKEN ||
    '';

  if (!fromYaml && !envUrl && !overrides?.url) {
    return null;
  }

  const base: KeprixTargetConfig = fromYaml ?? {
    type: 'keprix',
    name: 'keprix-aiva',
    url: envUrl || 'http://127.0.0.1:3333',
    auth_token: envToken,
    prompt_filter_enabled: true,
    kill_switch_enabled: true,
    sensors: KEPRIX_SENSORS.map((s) => s.id),
    enabled: true,
  };

  return {
    ...base,
    ...overrides,
    url: (overrides?.url || base.url || envUrl).replace(/\/$/, ''),
    auth_token: overrides?.auth_token || base.auth_token || envToken,
    type: 'keprix',
  };
}

async function keprixFetch(
  target: KeprixTargetConfig,
  method: string,
  pathName: string,
  body?: unknown,
): Promise<KeprixPropagateResult> {
  const started = Date.now();
  const url = `${target.url.replace(/\/$/, '')}${pathName}`;
  if (!target.auth_token && pathName !== '/keprix/scout/sensors') {
    return { ok: false, error: 'auth_token not configured', latency_ms: 0, url };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${target.auth_token}`,
        'X-Scout-Kill-Token': target.auth_token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    let parsed: unknown = null;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    return {
      ok: res.ok,
      status: res.status,
      body: parsed,
      latency_ms: Date.now() - started,
      url,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - started,
      url,
    };
  }
}

export async function propagateKillToKeprix(
  payload: KeprixKillPayload,
  targetOverrides?: Partial<KeprixTargetConfig>,
): Promise<KeprixPropagateResult> {
  const target = resolveKeprixConfig(targetOverrides);
  if (!target || target.enabled === false || target.kill_switch_enabled === false) {
    return { ok: true, skipped: true, latency_ms: 0 };
  }
  const scope =
    payload.scope ||
    (payload.workspace_id ? 'workspace' : 'agent_global');
  return keprixFetch(target, 'POST', '/keprix/kill', {
    workspace_id: payload.workspace_id ?? undefined,
    scope,
    reason: payload.reason || 'Operator-initiated kill from Scout dashboard',
    activated_by: payload.activated_by || 'scout',
    channel: payload.channel,
    command: payload.command,
    operator_id: payload.operator_id,
  });
}

export async function propagateResumeToKeprix(
  payload: { workspace_id?: string | null; scope?: string | null },
  targetOverrides?: Partial<KeprixTargetConfig>,
): Promise<KeprixPropagateResult> {
  const target = resolveKeprixConfig(targetOverrides);
  if (!target || target.enabled === false || target.kill_switch_enabled === false) {
    return { ok: true, skipped: true, latency_ms: 0 };
  }
  return keprixFetch(target, 'POST', '/keprix/resume', {
    workspace_id: payload.workspace_id ?? undefined,
    scope: payload.scope ?? undefined,
  });
}

export async function fetchKeprixStatus(
  targetOverrides?: Partial<KeprixTargetConfig>,
  workspaceId?: string | null,
): Promise<KeprixPropagateResult> {
  const target = resolveKeprixConfig(targetOverrides);
  if (!target) {
    return { ok: false, error: 'Keprix target not configured', latency_ms: 0 };
  }
  const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return keprixFetch(target, 'GET', `/keprix/kill/status${qs}`);
}

export async function fetchKeprixSensors(
  targetOverrides?: Partial<KeprixTargetConfig>,
): Promise<KeprixPropagateResult> {
  const target = resolveKeprixConfig(targetOverrides);
  if (!target) {
    return { ok: false, error: 'Keprix target not configured', latency_ms: 0 };
  }
  return keprixFetch(target, 'GET', '/keprix/scout/sensors');
}

export async function upsertRuntimeTarget(input: {
  organizationId?: string | null;
  workspaceId?: string | null;
  name: string;
  type?: string;
  url: string;
  authToken?: string;
  agentId?: string | null;
  metadata?: Record<string, unknown>;
  killSwitchEnabled?: boolean;
  promptFilterEnabled?: boolean;
}): Promise<Record<string, unknown>> {
  const row = {
    organization_id: input.organizationId ?? null,
    workspace_id: input.workspaceId ?? null,
    name: input.name,
    type: input.type || 'keprix',
    url: input.url.replace(/\/$/, ''),
    auth_token: input.authToken ?? null,
    agent_id: input.agentId ?? null,
    metadata: JSON.stringify(input.metadata ?? { sensors: KEPRIX_SENSORS.map((s) => s.id) }),
    kill_switch_enabled: input.killSwitchEnabled !== false,
    prompt_filter_enabled: input.promptFilterEnabled !== false,
    enabled: true,
    updated_at: new Date().toISOString(),
  };

  const existing = await db('runtime_targets')
    .where({
      organization_id: row.organization_id,
      name: row.name,
    })
    .first()
    .catch(() => null);

  if (existing) {
    const [updated] = await db('runtime_targets')
      .where({ id: existing.id })
      .update(row)
      .returning('*');
    return updated;
  }

  const [created] = await db('runtime_targets').insert(row).returning('*');
  return created;
}

export async function listRuntimeTargets(organizationId?: string | null): Promise<Record<string, unknown>[]> {
  try {
    const q = db('runtime_targets').orderBy('created_at', 'desc');
    if (organizationId) q.where({ organization_id: organizationId });
    return await q;
  } catch {
    return [];
  }
}

export async function getRuntimeTargetForAgent(
  organizationId: string,
  agentId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const byAgent = await db('runtime_targets')
      .where({ organization_id: organizationId, agent_id: agentId, enabled: true })
      .first();
    if (byAgent) return byAgent;

    const agent = await db('connected_agents')
      .where({ id: agentId, organization_id: organizationId })
      .first();
    if (!agent) return null;

    const meta =
      typeof agent.metadata === 'string'
        ? JSON.parse(agent.metadata || '{}')
        : agent.metadata && typeof agent.metadata === 'object'
          ? agent.metadata
          : {};

    if (String(agent.agent_type || '').toLowerCase() === 'keprix' || meta.engine === 'keprix') {
      const cfg = resolveKeprixConfig({
        url: typeof meta.keprix_url === 'string' ? meta.keprix_url : undefined,
        auth_token: typeof meta.keprix_auth_token === 'string' ? meta.keprix_auth_token : undefined,
        workspace_id: typeof meta.workspace_id === 'string' ? meta.workspace_id : null,
        agent_id: agentId,
        organization_id: organizationId,
      });
      if (!cfg) return null;
      return {
        name: cfg.name,
        type: 'keprix',
        url: cfg.url,
        auth_token: cfg.auth_token,
        agent_id: agentId,
        metadata: meta,
        kill_switch_enabled: true,
      };
    }

    // Fallback: org-level keprix target
    return (
      (await db('runtime_targets')
        .where({ organization_id: organizationId, type: 'keprix', enabled: true })
        .orderBy('created_at', 'desc')
        .first()) ?? null
    );
  } catch {
    return null;
  }
}

export async function killAgentAndPropagateToKeprix(opts: {
  organizationId: string;
  agentId: string;
  reason?: string;
  activatedBy?: string;
  channel?: string;
  command?: string;
  operatorId?: string;
}): Promise<{ agent: Record<string, unknown>; keprix: KeprixPropagateResult }> {
  const [agent] = await db('connected_agents')
    .where({ id: opts.agentId, organization_id: opts.organizationId })
    .update({ status: 'suspended' })
    .returning('*');

  if (!agent) {
    throw Object.assign(new Error('Agent not found'), { status: 404 });
  }

  const target = await getRuntimeTargetForAgent(opts.organizationId, opts.agentId);
  const meta =
    target && typeof target.metadata === 'string'
      ? JSON.parse(target.metadata || '{}')
      : ((target?.metadata as Record<string, unknown>) || {});

  const workspaceId =
    (typeof meta.workspace_id === 'string' && meta.workspace_id) ||
    (typeof agent.workspace_id === 'string' ? agent.workspace_id : null);

  const keprix = await propagateKillToKeprix(
    {
      workspace_id: workspaceId,
      scope: workspaceId ? 'workspace' : 'agent_global',
      reason: opts.reason || 'Operator-initiated kill from Scout dashboard',
      activated_by: opts.activatedBy || 'scout',
      channel: opts.channel,
      command: opts.command,
      operator_id: opts.operatorId,
    },
    target
      ? {
          url: String(target.url),
          auth_token: String(target.auth_token || ''),
          name: String(target.name || 'keprix-aiva'),
        }
      : undefined,
  );

  return { agent, keprix };
}

export async function resumeAgentAndPropagateToKeprix(opts: {
  organizationId: string;
  agentId: string;
}): Promise<{ agent: Record<string, unknown>; keprix: KeprixPropagateResult }> {
  const [agent] = await db('connected_agents')
    .where({ id: opts.agentId, organization_id: opts.organizationId })
    .update({ status: 'offline' })
    .returning('*');

  if (!agent) {
    throw Object.assign(new Error('Agent not found'), { status: 404 });
  }

  const target = await getRuntimeTargetForAgent(opts.organizationId, opts.agentId);
  const meta =
    target && typeof target.metadata === 'string'
      ? JSON.parse(target.metadata || '{}')
      : ((target?.metadata as Record<string, unknown>) || {});
  const workspaceId =
    (typeof meta.workspace_id === 'string' && meta.workspace_id) ||
    (typeof agent.workspace_id === 'string' ? agent.workspace_id : null);

  const keprix = await propagateResumeToKeprix(
    { workspace_id: workspaceId, scope: workspaceId ? 'workspace' : 'agent_global' },
    target
      ? {
          url: String(target.url),
          auth_token: String(target.auth_token || ''),
          name: String(target.name || 'keprix-aiva'),
        }
      : undefined,
  );

  return { agent, keprix };
}

/** Channel /kill|/freeze entry point (Telegram/WhatsApp -> Scout -> Keprix). */
export async function handleChannelKill(opts: {
  organizationId: string;
  agentId: string;
  workspaceId?: string;
  channel: string;
  command: string;
  operatorId?: string;
}): Promise<{ agent: Record<string, unknown>; keprix: KeprixPropagateResult; audit_id: string }> {
  const auditId = `K-${Date.now()}`;
  const result = await killAgentAndPropagateToKeprix({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    reason: `Channel ${opts.command} via ${opts.channel} (${auditId})`,
    activatedBy: 'channel',
    channel: opts.channel,
    command: opts.command,
    operatorId: opts.operatorId,
  });
  return { ...result, audit_id: auditId };
}

export async function buildKeprixDashboardStatus(organizationId: string): Promise<Record<string, unknown>> {
  const cfg = resolveKeprixConfig();
  const targets = await listRuntimeTargets(organizationId);
  const keprixTargets = targets.filter((t) => String(t.type) === 'keprix');
  const agents = await db('connected_agents')
    .where({ organization_id: organizationId })
    .where(function () {
      this.where('agent_type', 'keprix').orWhereRaw(`metadata::text ILIKE '%keprix%'`);
    })
    .catch(async () =>
      db('connected_agents').where({ organization_id: organizationId }).where('agent_type', 'keprix'),
    );

  const agentIds = (agents as Record<string, unknown>[]).map((a) => String(a.id));
  let filterStats = { passed: 0, blocked: 0, flagged: 0, tool_calls: 0, responses: 0, anomalies: 0 };
  if (agentIds.length > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const events = await db('agent_events')
      .whereIn('agent_id', agentIds)
      .where('occurred_at', '>=', since)
      .select('event_type')
      .catch(() => []);
    for (const ev of events as Array<{ event_type: string }>) {
      const t = String(ev.event_type || '');
      if (t.includes('prompt') || t === 'prompt_filter') filterStats.passed += 1;
      if (t.includes('block') || t === 'prompt_blocked') filterStats.blocked += 1;
      if (t === 'anomaly' || t.includes('flag')) filterStats.flagged += 1;
      if (t.includes('tool')) filterStats.tool_calls += 1;
      if (t.includes('response') || t === 'agent_response') filterStats.responses += 1;
      if (t === 'anomaly') filterStats.anomalies += 1;
    }
  }

  const health = cfg ? await fetchKeprixStatus(cfg) : { ok: false, error: 'not_configured', latency_ms: 0 };
  const sensors = cfg ? await fetchKeprixSensors(cfg) : { ok: false, latency_ms: 0 };
  const killActive = Boolean(
    (agents as Record<string, unknown>[]).some((a) => String(a.status) === 'suspended') ||
      (health.body &&
        typeof health.body === 'object' &&
        (health.body as { active?: boolean }).active === true),
  );

  return {
    configured: Boolean(cfg),
    target: cfg
      ? {
          name: cfg.name,
          url: cfg.url,
          sensors: cfg.sensors ?? KEPRIX_SENSORS.map((s) => s.id),
          kill_switch_enabled: cfg.kill_switch_enabled !== false,
        }
      : null,
    registered_targets: keprixTargets.map((t) => ({
      id: t.id,
      name: t.name,
      url: t.url,
      enabled: t.enabled,
      agent_id: t.agent_id,
    })),
    health: {
      ok: health.ok,
      latency_ms: health.latency_ms,
      error: health.error,
      body: health.body,
    },
    sensors: sensors.ok ? sensors.body : { sensors: KEPRIX_SENSORS, monitored: true, product: 'keprix' },
    agents: {
      total: (agents as unknown[]).length,
      online: (agents as Record<string, unknown>[]).filter((a) => String(a.status) === 'online').length,
      suspended: (agents as Record<string, unknown>[]).filter((a) => String(a.status) === 'suspended')
        .length,
    },
    stats_24h: filterStats,
    kill_switch_active: killActive,
    monitored: true,
  };
}
