// scout-engine/src/alerts/rules.ts
// Alert rules engine; defines what triggers an alert
import { db } from '../db/index.js';
import { isInstantAlert, isDigestAlert, isAlertMuted, isInDndWindow } from './delivery.js';

export interface AlertRule {
  id: string;
  workspaceId: string;
  name: string;
  trigger: {
    event: 'finding_new' | 'finding_severity_change' | 'score_drop' | 'scan_failed' | 'agent_suspicious' | 'keprix_agent_anomaly';
    conditions?: {
      minSeverity?: 'critical' | 'high' | 'medium' | 'low';
      minScoreDrop?: number;
      findingTypes?: string[];
    };
  };
  channels: ('email' | 'push' | 'webhook' | 'telegram' | 'slack')[];
  config: {
    email?: string;
    webhookUrl?: string;
    webhookSecret?: string;
    telegramChatId?: string;
    slackWebhookUrl?: string;
    slackChannel?: string;
    deliveryMode?: 'instant' | 'digest';
  };
  enabled: boolean;
  cooldownMinutes: number;
}

export const DEFAULT_ALERT_RULES: Omit<AlertRule, 'id' | 'workspaceId'>[] = [
  {
    name: 'Critical Findings; Instant All Channels',
    trigger: { event: 'finding_new', conditions: { minSeverity: 'critical' } },
    channels: ['email'],
    config: { deliveryMode: 'instant' },
    enabled: true,
    cooldownMinutes: 15,
  },
  {
    name: 'High Findings; Instant Email',
    trigger: { event: 'finding_new', conditions: { minSeverity: 'high' } },
    channels: ['email'],
    config: { deliveryMode: 'instant' },
    enabled: true,
    cooldownMinutes: 30,
  },
  {
    name: 'Medium+ Digest',
    trigger: { event: 'finding_new', conditions: { minSeverity: 'medium' } },
    channels: ['email'],
    config: { deliveryMode: 'digest' },
    enabled: true,
    cooldownMinutes: 240, // 4-hour digest
  },
  {
    name: 'Score Drop Alert',
    trigger: { event: 'score_drop', conditions: { minScoreDrop: 5 } },
    channels: ['email'],
    config: { deliveryMode: 'instant' },
    enabled: true,
    cooldownMinutes: 60,
  },
  {
    name: 'Scan Failure Alert',
    trigger: { event: 'scan_failed' },
    channels: ['email'],
    config: { deliveryMode: 'instant' },
    enabled: true,
    cooldownMinutes: 60,
  },
  {
    name: 'Suspicious Agent Activity',
    trigger: { event: 'agent_suspicious' },
    channels: ['email'],
    config: { deliveryMode: 'instant' },
    enabled: true,
    cooldownMinutes: 15,
  },
  {
    name: 'Keprix Agent Anomaly',
    trigger: {
      event: 'keprix_agent_anomaly',
      conditions: { minSeverity: 'high' },
    },
    channels: ['email', 'telegram'],
    config: { deliveryMode: 'instant' },
    enabled: true,
    cooldownMinutes: 15,
  },
];

export async function createDefaultRules(workspaceId: string): Promise<void> {
  for (const rule of DEFAULT_ALERT_RULES) {
    const existing = await db('alert_rules')
      .where({ workspace_id: workspaceId, name: rule.name })
      .first();
    if (!existing) {
      await db('alert_rules').insert({
        workspace_id: workspaceId,
        name: rule.name,
        trigger: JSON.stringify(rule.trigger),
        channels: rule.channels,
        config: JSON.stringify(rule.config),
        enabled: rule.enabled,
        cooldown_minutes: rule.cooldownMinutes,
      });
    }
  }
}

export async function getMatchingRules(
  workspaceId: string,
  event: AlertRule['trigger']['event'],
  severity?: string,
): Promise<AlertRule[]> {
  const rules = await db('alert_rules')
    .where({ workspace_id: workspaceId, enabled: true });

  return rules.filter((r: any) => {
    const trigger = typeof r.trigger === 'string' ? JSON.parse(r.trigger) : r.trigger;
    if (trigger.event !== event) return false;

    // Check severity condition
    if (trigger.conditions?.minSeverity && severity) {
      const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const condSev = trigger.conditions.minSeverity;
      if ((severityOrder[severity] ?? 99) > (severityOrder[condSev] ?? 0)) return false;
    }

    return true;
  }).map((r: any) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    trigger: typeof r.trigger === 'string' ? JSON.parse(r.trigger) : r.trigger,
    channels: r.channels,
    config: typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {}),
    enabled: r.enabled,
    cooldownMinutes: r.cooldown_minutes,
  }));
}

/** Get rules grouped by delivery mode (instant vs digest) */
export function partitionRulesByDelivery(rules: AlertRule[]): {
  instant: AlertRule[];
  digest: AlertRule[];
} {
  const instant: AlertRule[] = [];
  const digest: AlertRule[] = [];

  for (const rule of rules) {
    const deliveryMode = rule.config?.deliveryMode || 'instant';
    if (deliveryMode === 'digest') {
      digest.push(rule);
    } else {
      instant.push(rule);
    }
  }

  return { instant, digest };
}

export async function checkAlertCooldown(
  ruleId: string,
  findingId: string,
): Promise<boolean> {
  const recent = await db('alert_history')
    .where({ rule_id: ruleId, finding_id: findingId })
    .where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'"))
    .first();
  return !!recent; // true = in cooldown, don't alert
}

/** Full pre-checks before delivering an alert: cooldown, mute, DND */
export async function shouldSuppressAlert(
  workspaceId: string,
  ruleId: string,
  findingId?: string,
  targetId?: string,
): Promise<{ suppressed: boolean; reason?: string }> {
  // Check cooldown
  if (findingId) {
    const inCooldown = await checkAlertCooldown(ruleId, findingId);
    if (inCooldown) return { suppressed: true, reason: 'cooldown' };
  }

  // Check mute
  if (findingId || targetId) {
    const muted = await isAlertMuted(workspaceId, findingId, targetId);
    if (muted) return { suppressed: true, reason: 'muted' };
  }

  // Check DND
  const dnd = await isInDndWindow(workspaceId);
  if (dnd) return { suppressed: true, reason: 'dnd' };

  return { suppressed: false };
}
