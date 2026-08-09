/**
 * Keprix anomaly alert evaluation (C04).
 * Fires when prompt_blocked / anomaly bursts exceed threshold in a short window.
 */
import { db } from '../db/index.js';
import { deliverAlert } from './delivery.js';
import { getMatchingRules, shouldSuppressAlert, type AlertRule } from './rules.js';

const BLOCKED_TYPES = new Set([
  'prompt_blocked',
  'anomaly',
  'keprix_prompt_blocked',
  'keprix_anomaly',
  'tool_abuse',
  'prompt_injection',
]);

const WINDOW_MINUTES = 5;
const THRESHOLD = 5;

export function isKeprixAnomalyEventType(eventType: string): boolean {
  const t = eventType.toLowerCase();
  if (BLOCKED_TYPES.has(t)) return true;
  return t.includes('block') || t.includes('anomaly') || t.includes('injection');
}

export async function evaluateKeprixAnomalyOnEvent(opts: {
  organizationId: string;
  workspaceId: string;
  agentId: string;
  agentType?: string;
  eventType: string;
}): Promise<{ fired: boolean; count?: number; alertIds?: string[] }> {
  if (!isKeprixAnomalyEventType(opts.eventType)) {
    return { fired: false };
  }

  const agentType = String(opts.agentType || '').toLowerCase();
  const isKeprixish = agentType === 'keprix' || agentType.includes('keprix');
  // Still count for any agent when event type is explicitly keprix_*
  if (!isKeprixish && !opts.eventType.toLowerCase().startsWith('keprix_')) {
    // Allow generic anomaly events to still trigger agent_suspicious / keprix rule if org uses Keprix target
    const hasTarget = await db('runtime_targets')
      .where({ organization_id: opts.organizationId, type: 'keprix', enabled: true })
      .first()
      .catch(() => null);
    if (!hasTarget) return { fired: false };
  }

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const row = await db('agent_events')
    .where({ organization_id: opts.organizationId, agent_id: opts.agentId })
    .where('occurred_at', '>=', since)
    .where(function () {
      this.whereIn('event_type', [...BLOCKED_TYPES]).orWhere('event_type', 'ilike', '%block%').orWhere(
        'event_type',
        'ilike',
        '%anomaly%',
      );
    })
    .count('* as count')
    .first();

  const count = parseInt(String(row?.count ?? '0'), 10);
  if (count <= THRESHOLD) {
    return { fired: false, count };
  }

  const workspaceId = opts.workspaceId;
  if (!workspaceId) return { fired: false, count };

  // Ensure default rule exists (idempotent)
  await ensureKeprixAnomalyRule(workspaceId);

  const rules = await getMatchingRules(workspaceId, 'keprix_agent_anomaly', 'high');
  const fallback = rules.length
    ? rules
    : await getMatchingRules(workspaceId, 'agent_suspicious', 'high');

  const alertIds: string[] = [];
  for (const rule of fallback) {
    const suppress = await shouldSuppressAlert(workspaceId, rule.id, undefined, opts.agentId);
    if (suppress.suppressed) continue;

    const recentSame = await db('alert_history')
      .where({ workspace_id: workspaceId, rule_id: rule.id })
      .where('created_at', '>', db.raw("NOW() - INTERVAL '15 minutes'"))
      .first()
      .catch(() => null);
    if (recentSame) continue;

    const [history] = await db('alert_history')
      .insert({
        workspace_id: workspaceId,
        organization_id: opts.organizationId,
        rule_id: rule.id,
        finding_id: null,
        channel: rule.channels[0] || 'dashboard',
        delivered: false,
        error: null,
      })
      .returning('id');

    if (history?.id) alertIds.push(String(history.id));

    await deliverAlert(rule as AlertRule, {
      event: 'keprix_agent_anomaly',
      agent: { id: opts.agentId, type: opts.agentType },
      finding: {
        id: `keprix-anomaly-${opts.agentId}`,
        title: `Keprix agent anomaly: ${count} blocked/anomaly events in ${WINDOW_MINUTES}m`,
        severity: 'high',
        description: `Agent ${opts.agentId} exceeded Keprix anomaly threshold (${count} > ${THRESHOLD}). Last event: ${opts.eventType}`,
        tool_name: 'keprix_prompt_sensor',
        first_seen_at: new Date().toISOString(),
      },
    }).catch((err) => {
      console.warn('[scout:keprix-anomaly] deliver failed:', err instanceof Error ? err.message : err);
    });

    if (history?.id) {
      await db('alert_history')
        .where({ id: history.id })
        .update({ delivered: true })
        .catch(() => undefined);
    }
  }

  // Also mirror into security_events audit stream (alongside Carina events)
  await db
    .raw(
      `INSERT INTO security_events (severity, source, event_type, description, metadata, session_id, instance_id)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)`,
      [
        'warning',
        'keprix',
        'keprix_agent_anomaly',
        `Keprix anomaly threshold exceeded for agent ${opts.agentId}`,
        JSON.stringify({
          agent_id: opts.agentId,
          organization_id: opts.organizationId,
          workspace_id: workspaceId,
          count,
          threshold: THRESHOLD,
          window_minutes: WINDOW_MINUTES,
          last_event_type: opts.eventType,
        }),
        null,
        opts.agentId,
      ],
    )
    .catch(() => undefined);

  return { fired: alertIds.length > 0, count, alertIds };
}

export async function ensureKeprixAnomalyRule(workspaceId: string): Promise<void> {
  const name = 'Keprix Agent Anomaly';
  const existing = await db('alert_rules').where({ workspace_id: workspaceId, name }).first();
  if (existing) return;
  await db('alert_rules').insert({
    workspace_id: workspaceId,
    name,
    trigger: JSON.stringify({
      event: 'keprix_agent_anomaly',
      conditions: { minSeverity: 'high', window_minutes: WINDOW_MINUTES, threshold: THRESHOLD },
    }),
    channels: ['email', 'telegram'],
    config: JSON.stringify({ deliveryMode: 'instant' }),
    enabled: true,
    cooldown_minutes: 15,
  });
}
