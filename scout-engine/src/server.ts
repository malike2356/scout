// scout-engine/src/server.ts
// Scout Event Ingestion Server (P1); Express API server for Carina → Scout event streaming.
// Handles: event ingestion, heartbeat, SSE stream, health checks.
import express, { type Express } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { serverConfig } from './event-server/config.js';
import { initDb, pool } from './event-server/db.js';
import { initRedis, getRedis, createSubscriber } from './event-server/redis.js';
import { requireApiKey } from './event-server/middleware/auth.js';
import { eventsRouter } from './event-server/api/events.js';
import { sseRouter, broadcastEvent } from './event-server/api/sse.js';
import { healthRouter } from './event-server/api/health.js';
import { adminRouter } from './api/admin.js';
import { customerRouter } from './api/customer.js';
import { publicV1Router } from './api/public/v1/index.js';
import { dashboardRouter } from './api/dashboard/index.js';
import { billingRouter } from './api/billing.js';
import { stripeWebhook } from './api/webhooks/stripe.js';
import { getSecretScanHealth } from './secret-scanning/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();
const startedAt = Date.now();

// Trust one proxy layer (for correct req.ip behind nginx)
app.set('trust proxy', 1);

// Stripe webhook needs the raw request body for signature verification, so it
// must be mounted before the JSON body parser below.
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

// Body parsing (256kb supports repository secret-scan ingest; app still caps at 256kb)
app.use(express.json({ limit: '256kb' }));

// CORS; allow dashboard origin(s)
app.use((req, res, next) => {
  const allowed = (process.env.DASHBOARD_ORIGIN || process.env.SCOUT_CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.includes('*') || (origin && allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (allowed.length === 1) {
    res.setHeader('Access-Control-Allow-Origin', allowed[0]);
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Scout-Key, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT, PATCH');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Optional static UI: prefer SCOUT_DASHBOARD_STATIC_PATH, else local ./public
const dashboardPath = process.env.SCOUT_DASHBOARD_STATIC_PATH
  ? path.resolve(process.env.SCOUT_DASHBOARD_STATIC_PATH)
  : path.resolve(__dirname, '../public');
if (fs.existsSync(dashboardPath)) {
  app.use(express.static(dashboardPath, { index: false }));
}

// SaaS root health
app.get('/health', async (_req, res) => {
  const secretScan = await getSecretScanHealth().catch(() => ({ tables_ready: false }));
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version: '1.0.0',
    repository_secret_scanning: secretScan,
  });
});

// Boundary API routes. Ops uses /api/admin. The customer console uses /api/customer.
app.use('/api/admin', requireApiKey, adminRouter);
app.use('/api/customer', requireApiKey, customerRouter);

// SaaS routes: public org API-key gateway, customer dashboard, and billing.
app.use('/v1', publicV1Router);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/billing', billingRouter);

// Legacy event ingestion routes kept for compatibility with existing Carina agents.
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/events', requireApiKey, eventsRouter);
app.use('/api/v1/events/stream', sseRouter); // no auth for SSE; local network

// Root health check
app.get('/', (_req, res) => {
  res.json({
    service: 'Scout Event Ingestion Server',
    version: '1.0.0',
    status: 'running',
    docs: '/api/v1/health',
    adminApi: '/api/admin',
    customerApi: '/api/customer',
  });
});

// Global error handler (must be last middleware)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[scout:error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(chalk.gray(`\n[scout] ${signal} received, shutting down...`));
  const redis = getRedis();
  if (redis) redis.disconnect();
  await pool.end().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// SSE subscriber; listens on Redis channel for events and fans out to SSE clients
async function initSseSubscriber(): Promise<void> {
  try {
    const sub = createSubscriber();
    await sub.subscribe('scout:events');
    sub.on('message', (_channel, message) => {
      try {
        const event = JSON.parse(message) as Record<string, unknown>;
        broadcastEvent(event);
      } catch {
        // malformed message, ignore
      }
    });
    console.log(chalk.gray('[scout] SSE Redis subscriber active on channel scout:events'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(chalk.yellow(`[scout] SSE subscriber unavailable: ${msg}`));
  }
}

// Startup
async function main(): Promise<void> {
  console.log(chalk.bold.hex('#d4af37')('LABYRINTH SCOUT') + chalk.gray(' - event ingestion server'));

  await initDb();
  await initRedis();
  await initSseSubscriber();

  app.listen(serverConfig.port, () => {
    console.log(chalk.green(`[scout] Listening on http://localhost:${serverConfig.port}`));
    console.log(chalk.gray(`[scout] Health: http://localhost:${serverConfig.port}/api/v1/health`));
    console.log(chalk.gray(`[scout] Admin API: http://localhost:${serverConfig.port}/api/admin`));
    console.log(chalk.gray(`[scout] Customer API: http://localhost:${serverConfig.port}/api/customer`));
    console.log(chalk.gray(`[scout] Events: http://localhost:${serverConfig.port}/api/v1/events`));
    console.log(chalk.gray(`[scout] SSE Stream: http://localhost:${serverConfig.port}/api/v1/events/stream`));
    console.log(chalk.gray('[scout] Ready to receive events from Carina instances'));
  });
}

main().catch((err) => {
  console.error(chalk.red('[scout] Fatal startup error:'), err);
  process.exit(1);
});

export default app;
