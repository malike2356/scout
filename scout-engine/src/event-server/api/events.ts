// scout-engine/src/event-server/api/events.ts
// Event ingestion endpoint; receives security events from Carina agent instances.
// POST /api/v1/events; ingest a new event
// GET  /api/v1/events; query recent events
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { pool } from '../db.js';
import { getRedis } from '../redis.js';
import type { SecurityEventRow } from './types.js';

export const eventsRouter: ExpressRouter = Router();

// Validation helpers
const VALID_SEVERITIES = new Set(['info', 'warning', 'critical', 'breach']);
const EVENT_TYPE_RE = /^[a-z0-9_]+$/;
const INSTANCE_ID_RE = /^[a-z0-9_\-]+$/;

function validateEventBody(body: unknown): { valid: true; data: Record<string, unknown> } | { valid: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Body must be a JSON object' };
  }

  const data = body as Record<string, unknown>;

  if (!data.severity || !VALID_SEVERITIES.has(data.severity as string)) {
    return { valid: false, error: 'severity must be one of: info, warning, critical, breach' };
  }

  if (!data.source || typeof data.source !== 'string' || data.source.length === 0 || data.source.length > 100) {
    return { valid: false, error: 'source must be a non-empty string (max 100 chars)' };
  }

  if (!data.event_type || typeof data.event_type !== 'string' || !EVENT_TYPE_RE.test(data.event_type) || data.event_type.length > 100) {
    return { valid: false, error: 'event_type must match /^[a-z0-9_]+$/ (max 100 chars)' };
  }

  if (!data.description || typeof data.description !== 'string' || data.description.length === 0 || data.description.length > 1000) {
    return { valid: false, error: 'description must be a non-empty string (max 1000 chars)' };
  }

  if (data.metadata !== undefined && (typeof data.metadata !== 'object' || data.metadata === null || Array.isArray(data.metadata))) {
    return { valid: false, error: 'metadata must be a plain object if provided' };
  }

  if (data.instance_id !== undefined && data.instance_id !== null) {
    if (typeof data.instance_id !== 'string' || !INSTANCE_ID_RE.test(data.instance_id) || data.instance_id.length > 64) {
      return { valid: false, error: 'instance_id must match /^[a-z0-9_\\-]+$/ (max 64 chars)' };
    }
  }

  return { valid: true, data };
}

// POST /api/v1/events; ingest a security event
eventsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const validation = validateEventBody(req.body);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { severity, source, event_type, description, metadata, ip_address, session_id, instance_id } = validation.data;

    const insertResult = await pool.query<SecurityEventRow>(
      `INSERT INTO security_events (severity, source, event_type, description, metadata, ip_address, session_id, instance_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, severity, source, event_type, description, metadata, ip_address, session_id, instance_id, mitigated, created_at`,
      [
        severity as string,
        source as string,
        event_type as string,
        description as string,
        JSON.stringify(metadata ?? {}),
        (ip_address as string) ?? req.ip ?? null,
        (session_id as string) ?? null,
        (instance_id as string) ?? null,
      ],
    );

    const insertedRow = insertResult.rows[0]!;

    // Publish to Redis for SSE fan-out
    const redis = getRedis();
    if (redis) {
      redis.publish('scout:events', JSON.stringify(insertedRow)).catch((err: Error) => {
        console.warn('[scout:events] Redis publish failed:', err.message);
      });
    }

    res.status(201).json({ ok: true, id: insertedRow.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scout:events] Insert error:', msg);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/v1/events; query recent events (with optional filters)
eventsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const severity = req.query.severity as string | undefined;
    const eventType = req.query.event_type as string | undefined;
    const instanceId = req.query.instance_id as string | undefined;
    const sessionId = req.query.session_id as string | undefined;

    let query = 'SELECT * FROM security_events WHERE 1=1';
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (severity && VALID_SEVERITIES.has(severity)) {
      query += ` AND severity = $${paramIdx++}`;
      params.push(severity);
    }
    if (eventType && EVENT_TYPE_RE.test(eventType)) {
      query += ` AND event_type = $${paramIdx++}`;
      params.push(eventType);
    }
    if (instanceId && INSTANCE_ID_RE.test(instanceId)) {
      query += ` AND instance_id = $${paramIdx++}`;
      params.push(instanceId);
    }
    if (sessionId) {
      query += ` AND session_id = $${paramIdx++}`;
      params.push(sessionId);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.total as string || '0', 10);

    // Fetch page
    query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pool.query<SecurityEventRow>(query, params);
    res.json({ events: result.rows, total, limit, offset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scout:events] Query error:', msg);
    res.status(500).json({ error: 'Database error' });
  }
});
