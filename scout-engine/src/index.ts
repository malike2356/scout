// scout-engine/src/index.ts
// Scout Engine main entry point
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { apiRouter } from './api/index.js';
import { publicV1Router } from './api/public/v1/index.js';
import { dashboardRouter } from './api/dashboard/index.js';
import { billingRouter } from './api/billing.js';
import { stripeWebhook } from './api/webhooks/stripe.js';
import { startScheduler } from './engine/scheduler.js';
import { startScoreJob } from './scoring/score-job.js';
import { startDigestScheduler } from './alerts/digest.js';
import { startSecretScanMaintenanceJob } from './secret-scanning/jobs.js';
import { getSecretScanHealth } from './secret-scanning/health.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app: Express = express();
const PORT = parseInt(process.env.SCOUT_PORT || '4444', 10);
const startedAt = Date.now();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// Stripe webhook needs the raw request body for signature verification, so it
// must be mounted before the JSON body parser below.
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json({ limit: '10mb' }));

// Optional static UI: prefer SCOUT_DASHBOARD_STATIC_PATH, else local ./public
const dashboardPath = process.env.SCOUT_DASHBOARD_STATIC_PATH
  ? path.resolve(process.env.SCOUT_DASHBOARD_STATIC_PATH)
  : path.resolve(__dirname, '../public');
if (fs.existsSync(dashboardPath)) {
  app.use(express.static(dashboardPath, { index: false }));
}

// API routes
app.use('/api/v1', apiRouter);
app.use('/v1', publicV1Router);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/billing', billingRouter);

// Root health (SaaS acceptance)
app.get('/health', async (_req, res) => {
  const secretScan = await getSecretScanHealth().catch(() => ({ tables_ready: false }));
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version: '1.0.0',
    repository_secret_scanning: secretScan,
  });
});

// Health check at root
app.get('/', (_req, res) => {
  res.json({
    service: 'Scout Engine',
    version: '1.0.0',
    status: 'running',
    docs: '/api/v1/docs/ui',
    health: '/health',
  });
});

// Dashboard (SPA fallback)
app.get('/dashboard', (_req, res) => {
  const file = path.join(dashboardPath, 'dashboard.html');
  const fallback = path.join(dashboardPath, 'index.html');
  if (fs.existsSync(file)) {
    res.sendFile(file);
    return;
  }
  if (fs.existsSync(fallback)) {
    res.sendFile(fallback);
    return;
  }
  res.status(404).json({ error: 'not_found', message: 'Static dashboard not bundled. Use scout-dashboard.' });
});

app.get('/onboard', (_req, res) => {
  const file = path.join(dashboardPath, 'onboard.html');
  if (fs.existsSync(file)) {
    res.sendFile(file);
    return;
  }
  res.status(404).json({ error: 'not_found', message: 'Onboarding lives in scout-dashboard.' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n Scout Engine running on http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/v1`);
  console.log(`   Health: http://localhost:${PORT}/api/v1/health`);
  console.log(`   Dashboard: http://localhost:${PORT}/dashboard\n`);

  // Start services
  startScheduler();
  startScoreJob();
  startDigestScheduler();
  startSecretScanMaintenanceJob();
});

export default app;
