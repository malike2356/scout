import type { Request, Response } from 'express';
import { pool } from '../../event-server/db.js';
import type { SecurityEventRow } from '../../event-server/api/types.js';

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function serializeSecurityEvent(row: SecurityEventRow): SecurityEventRow {
  return {
    ...row,
    metadata: parseMetadata(row.metadata),
    created_at: new Date(row.created_at).toISOString(),
  };
}

export async function listEvents(req: Request, res: Response): Promise<void> {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const result = await pool.query<SecurityEventRow>(
      `SELECT id, severity, source, event_type, description, metadata,
              ip_address, session_id, instance_id, mitigated, created_at
       FROM security_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ events: result.rows.map(serializeSecurityEvent) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scout-engine:events] List failed:', msg);
    res.status(500).json({ error: 'Database error' });
  }
}
