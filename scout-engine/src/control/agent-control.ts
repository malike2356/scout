// scout-engine/src/control/agent-control.ts
// The single, unified kill-switch implementation. Supersedes the old
// instance-control.ts (which read a `carina_instances` table that does not
// exist in a standalone Scout database - see
// docs/decisions/SUPERSESSION-MAP-2026-10-24.md) and the dead
// kill_switch_state table. Everything else that triggers a kill - the
// dashboard, the admin API, Keprix propagation, policy auto-kill - now
// calls into this module so there is exactly one code path that decides
// what "an agent is killed" means.
import { db } from '../db/index.js';
import { getRedis } from '../event-server/redis.js';
import { broadcastEvent } from '../event-server/api/sse.js';
import { syncAgentRevocationOnChain } from '../blockchain/identity.js';
import { CONTROL_CHANNEL } from './constants.js';

export type KillSource = 'manual' | 'policy' | 'channel';

export class AgentControlError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AgentControlError';
    this.status = status;
  }
}

async function publishControl(payload: Record<string, unknown>): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.publish(CONTROL_CHANNEL, JSON.stringify(payload));
  } catch (err) {
    console.warn('[scout:control] Redis publish failed:', err instanceof Error ? err.message : err);
  }
}

async function recordAudit(opts: {
  organizationId: string;
  agentId: string | null;
  scope: 'agent' | 'global';
  action: 'kill' | 'resume';
  source: KillSource;
  reason: string | null;
  triggeredBy: string | null;
  chainTxHash?: string | null;
}): Promise<void> {
  await db('kill_switch_events').insert({
    organization_id: opts.organizationId,
    agent_id: opts.agentId,
    scope: opts.scope,
    action: opts.action,
    source: opts.source,
    reason: opts.reason,
    triggered_by: opts.triggeredBy,
    chain_tx_hash: opts.chainTxHash ?? null,
  });

  await db('security_events')
    .insert({
      severity: opts.action === 'kill' ? 'critical' : 'info',
      source: 'scout-engine',
      event_type: opts.action === 'kill' ? 'kill_switch_activated' : 'kill_switch_resumed',
      description:
        opts.scope === 'global'
          ? `Global kill switch ${opts.action === 'kill' ? 'activated' : 'resumed'} for organization`
          : `Agent ${opts.action === 'kill' ? 'suspended' : 'resumed'} via kill switch`,
      metadata: JSON.stringify({
        organization_id: opts.organizationId,
        agent_id: opts.agentId,
        scope: opts.scope,
        source: opts.source,
        reason: opts.reason,
        triggered_by: opts.triggeredBy,
      }),
      instance_id: opts.agentId,
    })
    .returning('*')
    .then(([row]) => {
      if (row) {
        broadcastEvent({
          ...row,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
          created_at: new Date(row.created_at).toISOString(),
        });
      }
    })
    .catch((err) => console.warn('[scout:control] audit security_events insert failed:', err));
}

export interface KillResult {
  agent: Record<string, unknown>;
  chain_tx_hash: string | null;
}

export async function suspendAgent(opts: {
  organizationId: string;
  agentId: string;
  reason: string;
  source: KillSource;
  triggeredBy?: string;
}): Promise<KillResult> {
  const [agent] = await db('connected_agents')
    .where({ id: opts.agentId, organization_id: opts.organizationId })
    .update({
      status: 'suspended',
      suspension_reason: opts.reason,
      suspended_at: new Date().toISOString(),
      suspended_by: opts.triggeredBy || opts.source,
      kill_source: opts.source,
    })
    .returning('*');

  if (!agent) throw new AgentControlError(404, 'Agent not found');

  const chain = await syncAgentRevocationOnChain(opts.agentId, 'kill', opts.reason).catch((err) => {
    console.warn('[scout:control] on-chain revoke failed:', err instanceof Error ? err.message : err);
    return null;
  });

  await recordAudit({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    scope: 'agent',
    action: 'kill',
    source: opts.source,
    reason: opts.reason,
    triggeredBy: opts.triggeredBy ?? null,
    chainTxHash: chain?.txHash ?? null,
  });

  await publishControl({ action: 'suspend', scope: 'agent', agent_id: opts.agentId, reason: opts.reason });

  return { agent, chain_tx_hash: chain?.txHash ?? null };
}

export async function resumeAgent(opts: {
  organizationId: string;
  agentId: string;
  triggeredBy?: string;
}): Promise<KillResult> {
  const [agent] = await db('connected_agents')
    .where({ id: opts.agentId, organization_id: opts.organizationId })
    .update({
      status: 'offline',
      suspension_reason: null,
      suspended_at: null,
      suspended_by: null,
      kill_source: null,
    })
    .returning('*');

  if (!agent) throw new AgentControlError(404, 'Agent not found');

  const chain = await syncAgentRevocationOnChain(opts.agentId, 'resume', '').catch((err) => {
    console.warn('[scout:control] on-chain reactivate failed:', err instanceof Error ? err.message : err);
    return null;
  });

  await recordAudit({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    scope: 'agent',
    action: 'resume',
    source: 'manual',
    reason: null,
    triggeredBy: opts.triggeredBy ?? null,
  });

  await publishControl({ action: 'resume', scope: 'agent', agent_id: opts.agentId });

  return { agent, chain_tx_hash: chain?.txHash ?? null };
}

export async function suspendAllAgentsForOrg(opts: {
  organizationId: string;
  reason: string;
  triggeredBy?: string;
}): Promise<{ organization: Record<string, unknown> }> {
  const [organization] = await db('organizations')
    .where({ id: opts.organizationId })
    .update({
      global_kill_active: true,
      global_kill_reason: opts.reason,
      global_kill_at: new Date().toISOString(),
    })
    .returning('*');

  if (!organization) throw new AgentControlError(404, 'Organization not found');

  await recordAudit({
    organizationId: opts.organizationId,
    agentId: null,
    scope: 'global',
    action: 'kill',
    source: 'manual',
    reason: opts.reason,
    triggeredBy: opts.triggeredBy ?? null,
  });

  await publishControl({ action: 'suspend', scope: 'global', organization_id: opts.organizationId, reason: opts.reason });

  return { organization };
}

export async function resumeAllAgentsForOrg(opts: {
  organizationId: string;
  triggeredBy?: string;
}): Promise<{ organization: Record<string, unknown> }> {
  const [organization] = await db('organizations')
    .where({ id: opts.organizationId })
    .update({
      global_kill_active: false,
      global_kill_reason: null,
      global_kill_at: null,
    })
    .returning('*');

  if (!organization) throw new AgentControlError(404, 'Organization not found');

  await recordAudit({
    organizationId: opts.organizationId,
    agentId: null,
    scope: 'global',
    action: 'resume',
    source: 'manual',
    reason: null,
    triggeredBy: opts.triggeredBy ?? null,
  });

  await publishControl({ action: 'resume', scope: 'global', organization_id: opts.organizationId });

  return { organization };
}

const AUTO_KILL_WINDOW_MINUTES = 15;

/**
 * Logs a prompt-filter verdict, then auto-kills the agent if it has
 * accumulated >= org.auto_kill_threshold critical/blocked verdicts within
 * the rolling window. No-op (returns null) if auto-kill is disabled
 * (threshold is null/0) or the threshold hasn't been reached.
 */
export async function recordPromptFilterEventAndMaybeAutoKill(opts: {
  organizationId: string;
  agentId: string;
  verdict: 'allowed' | 'flagged' | 'blocked';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  autoKillThreshold: number | null;
}): Promise<KillResult | null> {
  await db('prompt_filter_events').insert({
    organization_id: opts.organizationId,
    agent_id: opts.agentId,
    verdict: opts.verdict,
    risk_level: opts.riskLevel,
  });

  if (!opts.autoKillThreshold || opts.verdict !== 'blocked' || opts.riskLevel !== 'critical') {
    return null;
  }

  const windowStart = new Date(Date.now() - AUTO_KILL_WINDOW_MINUTES * 60 * 1000).toISOString();
  const result = await db('prompt_filter_events')
    .where({ agent_id: opts.agentId, verdict: 'blocked', risk_level: 'critical' })
    .andWhere('created_at', '>=', windowStart)
    .count('* as count')
    .first();
  const count = parseInt((result?.count as string) || '0', 10);

  if (count < opts.autoKillThreshold) return null;

  return suspendAgent({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    reason: `Auto-killed by policy: ${count} critical prompt-injection blocks in the last ${AUTO_KILL_WINDOW_MINUTES} minutes (threshold: ${opts.autoKillThreshold}).`,
    source: 'policy',
    triggeredBy: 'scout-auto-kill',
  });
}
