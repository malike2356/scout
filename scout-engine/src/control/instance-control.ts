import { pool } from '../event-server/db.js';
import { getRedis } from '../event-server/redis.js';
import type { SecurityEventRow } from '../event-server/api/types.js';
import { broadcastEvent } from '../event-server/api/sse.js';
import {
  CONTROL_CHANNEL,
  EVENT_KILL_ACTIVATED,
  EVENT_KILL_RESUMED,
  STATUS_ACTIVE,
  STATUS_SUSPENDED,
} from './constants.js';

export function validateKillReason(body: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'reason is required and must be a non-empty string' };
  }
  const reason = (body as Record<string, unknown>).reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    return { ok: false, error: 'reason is required and must be a non-empty string' };
  }
  return { ok: true, reason: reason.trim() };
}

async function publishControlMessage(payload: Record<string, unknown>): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.publish(CONTROL_CHANNEL, JSON.stringify(payload));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[scout-engine:control] Redis publish failed:', msg);
  }
}

async function insertControlEvent(
  instanceId: string,
  eventType: string,
  severity: 'info' | 'critical',
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const result = await pool.query<SecurityEventRow>(
    `INSERT INTO security_events
      (severity, source, event_type, description, metadata, instance_id)
     VALUES ($1, 'scout-engine', $2, $3, $4, $5)
     RETURNING id, severity, source, event_type, description, metadata,
       ip_address, session_id, instance_id, mitigated, created_at`,
    [severity, eventType, description, JSON.stringify(metadata), instanceId],
  );

  const inserted = result.rows[0];
  if (!inserted) return;

  broadcastEvent({
    ...inserted,
    metadata:
      typeof inserted.metadata === 'object' && inserted.metadata !== null
        ? inserted.metadata
        : {},
    created_at: new Date(inserted.created_at).toISOString(),
  });
}

export async function suspendInstance(
  instanceId: string,
  reason: string,
): Promise<{ ok: true; instance_id: string; status: typeof STATUS_SUSPENDED } | { ok: false; status: number; error: string }> {
  const lookup = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM carina_instances WHERE id = $1`,
    [instanceId],
  );

  const row = lookup.rows[0];
  if (!row) return { ok: false, status: 404, error: 'Instance not found' };
  if (row.status === STATUS_SUSPENDED) {
    return { ok: false, status: 400, error: 'Instance already suspended' };
  }

  await pool.query(
    `UPDATE carina_instances
     SET status = $1, suspension_reason = $2, updated_at = NOW()
     WHERE id = $3`,
    [STATUS_SUSPENDED, reason, instanceId],
  );

  await publishControlMessage({
    action: 'suspend',
    instance_id: instanceId,
    reason,
    timestamp: new Date().toISOString(),
  });

  await insertControlEvent(instanceId, EVENT_KILL_ACTIVATED, 'critical', 'Agent suspended via kill switch', {
    reason,
    triggered_by: 'scout-engine-admin-api',
  });

  return { ok: true, instance_id: instanceId, status: STATUS_SUSPENDED };
}

export async function resumeInstance(
  instanceId: string,
): Promise<{ ok: true; instance_id: string; status: typeof STATUS_ACTIVE } | { ok: false; status: number; error: string }> {
  const result = await pool.query<{ id: string }>(
    `UPDATE carina_instances
     SET status = $1, suspension_reason = NULL, updated_at = NOW()
     WHERE id = $2 AND status = $3
     RETURNING id`,
    [STATUS_ACTIVE, instanceId, STATUS_SUSPENDED],
  );

  if (!result.rows[0]) {
    return { ok: false, status: 404, error: 'Instance not found or not suspended' };
  }

  await publishControlMessage({
    action: 'resume',
    instance_id: instanceId,
    timestamp: new Date().toISOString(),
  });

  await insertControlEvent(instanceId, EVENT_KILL_RESUMED, 'info', 'Agent resumed via kill switch', {
    triggered_by: 'scout-engine-admin-api',
  });

  return { ok: true, instance_id: instanceId, status: STATUS_ACTIVE };
}
