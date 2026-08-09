// scout-engine/src/event-server/api/health.ts
// Health check endpoint for the event ingestion server.
// GET /api/v1/health
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { pool } from '../db.js';
import { getRedis } from '../redis.js';

export const healthRouter: ExpressRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};

  // DB check
  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.database = `error: ${msg}`;
  }

  // Redis check
  try {
    const r = getRedis();
    if (r) {
      await r.ping();
      checks.redis = 'ok';
    } else {
      checks.redis = 'not_connected';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.redis = `error: ${msg}`;
  }

  const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'not_connected');

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    checks,
  });
});
