// scout-engine/src/api/index.ts
// Full Scout REST API; composes sub-routers for targets, scans, findings, and more
import { Router, Request, Response, type Router as ExpressRouter } from 'express';
import { join } from 'path';
import { createRequire } from 'module';
import swaggerUi from 'swagger-ui-express';
import { db } from '../db/index.js';
import { targetsRouter } from './targets.js';
import { scansRouter } from './scans.js';
import { findingsRouter } from './findings.js';
import { calculateScoutScore } from '../scoring/scout-score.js';
import { createDefaultRules, getMatchingRules, checkAlertCooldown } from '../alerts/rules.js';
import { deliverAlert } from '../alerts/delivery.js';
import { ingestAgentEvent, registerAgent } from '../agents/event-ingest.js';
import { generateReport } from '../reports/generator.js';
import {
  authMiddleware,
  createApiRateLimiter,
  DEFAULT_WORKSPACE_ID,
  issueWorkspaceToken,
  validateApiKey,
} from './auth-middleware.js';
import crypto from 'crypto';

export const apiRouter: ExpressRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

apiRouter.post('/auth/token', (req, res) => {
  const apiKey = String(req.body?.api_key ?? '');
  if (!validateApiKey(apiKey)) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  const workspaceId = String(req.body?.workspace_id ?? DEFAULT_WORKSPACE_ID);
  res.json({
    token: issueWorkspaceToken(workspaceId, apiKey),
    workspace_id: workspaceId,
    expires_in: 86400,
  });
});

apiRouter.post('/auth/login', (req, res) => {
  const apiKey = String(req.body?.api_key ?? req.body?.password ?? '');
  if (!validateApiKey(apiKey)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const workspaceId = String(req.body?.workspace_id ?? DEFAULT_WORKSPACE_ID);
  res.json({
    token: issueWorkspaceToken(workspaceId, apiKey),
    workspace_id: workspaceId,
    expires_in: 86400,
  });
});

const require = createRequire(import.meta.url);
const YAML = require('yamljs') as { load: (path: string) => Record<string, unknown> };
const openapiPath = join(import.meta.dirname ?? __dirname, 'openapi.yaml');
const openapiSpec = YAML.load(openapiPath);
apiRouter.use('/docs/ui', swaggerUi.serve, swaggerUi.setup(openapiSpec));
apiRouter.get('/docs', (_req, res) => {
  res.json(openapiSpec);
});

apiRouter.use(createApiRateLimiter());
apiRouter.use(authMiddleware);

// ════════════════════════════════════════════
// Workspace
// ════════════════════════════════════════════
apiRouter.get('/workspace', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    let ws = await db('workspaces').where({ id: workspaceId }).first();
    if (!ws) {
      await db('workspaces').insert({ id: workspaceId, name: 'Default Workspace' });
      ws = await db('workspaces').where({ id: workspaceId }).first();
    }
    res.json({ workspace: ws });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// Mount sub-routers
// ════════════════════════════════════════════
apiRouter.use('/targets', targetsRouter);
apiRouter.use('/scans', scansRouter);
apiRouter.use('/findings', findingsRouter);

// ════════════════════════════════════════════
// Assets (discovered by scans)
// ════════════════════════════════════════════
apiRouter.get('/discovered-assets', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { asset_type, limit = '100', offset = '0' } = req.query as any;

    let query = db('discovered_assets').where('workspace_id', workspaceId);
    if (asset_type) query = query.where('asset_type', asset_type);

    const total = await query.clone().count('* as count').first();
    const assets = await query.orderBy('last_seen_at', 'desc').limit(parseInt(limit)).offset(parseInt(offset));

    res.json({ assets, total: parseInt((total?.count as string) || '0'), limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
// Scout Score
// ════════════════════════════════════════════
apiRouter.get('/scout-score', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const score = await calculateScoutScore(workspaceId);
    res.json({
      score: score.total,
      breakdown: score.categories,
      trend: score.trend,
      findingCounts: score.findingCounts,
      calculatedAt: score.calculatedAt,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.get('/scout-score/history', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const days = Math.min(parseInt(req.query.days as string) || 90, 365);

    const scores = await db('scout_scores')
      .where({ workspace_id: workspaceId })
      .where('calculated_at', '>=', db.raw(`NOW() - INTERVAL '${days} days'`))
      .orderBy('calculated_at', 'asc');

    res.json(scores.map((s: any) => ({
      score: s.total,
      categories: typeof s.categories === 'string' ? JSON.parse(s.categories) : s.categories,
      date: s.calculated_at,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
// Agents (Prompt 05)
// ════════════════════════════════════════════
apiRouter.get('/agents', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const agents = await db('connected_agents').where({ workspace_id: workspaceId }).orderBy('last_heartbeat', 'desc');
    res.json({ agents });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.post('/agents', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { name, agent_type, api_key } = req.body;
    if (!name || !agent_type || !api_key) return res.status(400).json({ error: 'name, agent_type, and api_key required' });

    const workspace = await db('workspaces').where({ id: workspaceId }).first();
    const agentId = await registerAgent(workspaceId, name, agent_type, api_key, workspace?.organization_id ?? null);
    res.status(201).json({ agent_id: agentId });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.post('/agents/events', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const event = { ...req.body, workspaceId };

    if (!event.agentId || !event.eventType) return res.status(400).json({ error: 'agentId and eventType required' });

    const result = await ingestAgentEvent(event);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.get('/agents/:id/events', async (req, res) => {
  try {
    const { limit = '50' } = req.query as any;
    const events = await db('agent_events')
      .where({ agent_id: req.params.id })
      .orderBy('occurred_at', 'desc')
      .limit(parseInt(limit));
    res.json({ events });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.get('/agents/:id/findings', async (req, res) => {
  try {
    const findings = await db('findings')
      .where({ tool_name: 'agent_monitor' })
      .whereRaw('evidence->>?', ['agentId'])
      .andWhere('evidence->>agentId', req.params.id)
      .orderBy('last_seen_at', 'desc')
      .limit(50);
    res.json({ findings });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
// Alerts (Prompt 04)
// ════════════════════════════════════════════
apiRouter.get('/alerts/rules', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const rules = await db('alert_rules').where({ workspace_id: workspaceId });
    res.json({ rules });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.post('/alerts/rules', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { name, trigger, channels, config, cooldown_minutes } = req.body;

    const [rule] = await db('alert_rules').insert({
      workspace_id: workspaceId,
      name,
      trigger: JSON.stringify(trigger),
      channels: channels || ['email'],
      config: JSON.stringify(config || {}),
      cooldown_minutes: cooldown_minutes || 60,
    }).returning('*');

    res.status(201).json({ rule });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.put('/alerts/rules/:id', async (req, res) => {
  try {
    const { name, trigger, channels, config, enabled, cooldown_minutes } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (trigger !== undefined) updates.trigger = JSON.stringify(trigger);
    if (channels !== undefined) updates.channels = channels;
    if (config !== undefined) updates.config = JSON.stringify(config);
    if (enabled !== undefined) updates.enabled = enabled;
    if (cooldown_minutes !== undefined) updates.cooldown_minutes = cooldown_minutes;

    const [rule] = await db('alert_rules').where({ id: req.params.id }).update(updates).returning('*');
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.delete('/alerts/rules/:id', async (req, res) => {
  try {
    await db('alert_rules').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.get('/alerts/history', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { limit = '50' } = req.query as any;
    const history = await db('alert_history')
      .where({ workspace_id: workspaceId })
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit));
    res.json({ history });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
// Reports (Prompt 06)
// ════════════════════════════════════════════
apiRouter.post('/reports/generate', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { type = 'custom', start_date, end_date, title } = req.body;

    const dateRange = {
      start: start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      end: end_date || new Date().toISOString(),
    };

    const { html, pdf } = await generateReport({ workspaceId, type, dateRange, title });

    const reportId = crypto.randomUUID();
    await db('report_cache').insert({
      id: reportId,
      workspace_id: workspaceId,
      type,
      date_range: JSON.stringify(dateRange),
      html,
      pdf_data: pdf || null,
    }).catch(() => {});

    res.json({ report_id: reportId, html: html.slice(0, 5000) + '...', pdf_available: !!pdf });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.get('/reports', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const reports = await db('report_cache')
      .where({ workspace_id: workspaceId })
      .select('id', 'workspace_id', 'type', 'date_range', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(20);
    res.json({ reports });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.get('/reports/:id/download', async (req, res) => {
  try {
    const report = await db('report_cache').where({ id: req.params.id }).first();
    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (report.pdf_data) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="scout-report-${req.params.id}.pdf"`);
      res.send(report.pdf_data);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.send(report.html);
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
// Compliance (SOC2)
// ════════════════════════════════════════════
apiRouter.get('/compliance/score', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const result = await db('compliance_evidence')
      .where('workspace_id', workspaceId)
      .countDistinct('control_id as count')
      .first();
    const covered = parseInt((result?.count as string) || '0');
    res.json({ score: Math.round((covered / 14) * 100), controls_covered: covered, total_controls: 14 });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.post('/compliance/export', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const evidence = await db('compliance_evidence')
      .where('workspace_id', workspaceId)
      .orderBy('control_id', 'asc');
    res.json({ evidence, exported_at: new Date().toISOString() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
// Webhooks
// ════════════════════════════════════════════
apiRouter.get('/webhooks', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const webhooks = await db('webhooks').where({ workspace_id: workspaceId });
    res.json({ webhooks });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.post('/webhooks', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { url, secret, events } = req.body;
    const [webhook] = await db('webhooks').insert({
      workspace_id: workspaceId,
      url,
      secret: secret || crypto.randomBytes(16).toString('hex'),
      events: events || ['finding_new', 'score_drop'],
    }).returning('*');
    res.status(201).json({ webhook });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.delete('/webhooks/:id', async (req, res) => {
  try {
    await db('webhooks').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
// Alert Suppression (mute / DND)
// ════════════════════════════════════════════

// Mute a finding or target
apiRouter.post('/suppressions/mute', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { finding_id, target_id, duration_hours = 24 } = req.body;

    if (!finding_id && !target_id) {
      return res.status(400).json({ error: 'finding_id or target_id required' });
    }

    const mutedUntil = new Date(Date.now() + duration_hours * 60 * 60 * 1000);

    const [mute] = await db('alert_mutes').insert({
      workspace_id: workspaceId,
      finding_id: finding_id || null,
      target_id: target_id || null,
      muted_until: mutedUntil,
    }).returning('*');

    res.status(201).json({ mute });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Unmute
apiRouter.delete('/suppressions/mute/:id', async (req, res) => {
  try {
    await db('alert_mutes').where({ id: req.params.id }).delete();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// List active mutes
apiRouter.get('/suppressions/mutes', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const now = new Date();
    const mutes = await db('alert_mutes')
      .where('workspace_id', workspaceId)
      .where('muted_until', '>', now)
      .orderBy('muted_until', 'asc');
    res.json({ mutes });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DND settings
apiRouter.get('/settings/dnd', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const settings = await db('workspace_settings').where('workspace_id', workspaceId).first();
    res.json({
      dnd_enabled: settings?.dnd_enabled || false,
      dnd_start_hour: settings?.dnd_start_hour || 22,
      dnd_end_hour: settings?.dnd_end_hour || 7,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.put('/settings/dnd', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { dnd_enabled, dnd_start_hour, dnd_end_hour } = req.body;

    const existing = await db('workspace_settings').where('workspace_id', workspaceId).first();
    if (existing) {
      await db('workspace_settings').where('workspace_id', workspaceId).update({
        dnd_enabled: dnd_enabled !== undefined ? dnd_enabled : existing.dnd_enabled,
        dnd_start_hour: dnd_start_hour ?? existing.dnd_start_hour,
        dnd_end_hour: dnd_end_hour ?? existing.dnd_end_hour,
      });
    } else {
      await db('workspace_settings').insert({
        workspace_id: workspaceId,
        dnd_enabled: dnd_enabled || false,
        dnd_start_hour: dnd_start_hour || 22,
        dnd_end_hour: dnd_end_hour || 7,
      });
    }

    const updated = await db('workspace_settings').where('workspace_id', workspaceId).first();
    res.json({ settings: updated });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Alert settings (email for digest, etc.)
apiRouter.get('/settings/alerts', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const settings = await db('workspace_settings').where('workspace_id', workspaceId).first();
    res.json({
      alert_email: settings?.alert_email || '',
      telegram_chat_id: settings?.telegram_chat_id || '',
      slack_webhook_url: settings?.slack_webhook_url || '',
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

apiRouter.put('/settings/alerts', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { alert_email, telegram_chat_id, slack_webhook_url } = req.body;

    const existing = await db('workspace_settings').where('workspace_id', workspaceId).first();
    if (existing) {
      await db('workspace_settings').where('workspace_id', workspaceId).update({
        alert_email: alert_email ?? existing.alert_email,
        telegram_chat_id: telegram_chat_id ?? existing.telegram_chat_id,
        slack_webhook_url: slack_webhook_url ?? existing.slack_webhook_url,
      });
    } else {
      await db('workspace_settings').insert({
        workspace_id: workspaceId,
        alert_email: alert_email || '',
        telegram_chat_id: telegram_chat_id || '',
        slack_webhook_url: slack_webhook_url || '',
      });
    }

    const updated = await db('workspace_settings').where('workspace_id', workspaceId).first();
    res.json({ settings: updated });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Test alert endpoint; trigger a test delivery for a rule
apiRouter.post('/alerts/test', async (req, res) => {
  try {
    const workspaceId = (req as any).workspaceId;
    const { rule_id, channel } = req.body;

    const rule = await db('alert_rules').where({ id: rule_id, workspace_id: workspaceId }).first();
    if (!rule) return res.status(404).json({ error: 'Rule not found' });

    const { deliverAlert } = await import('../alerts/delivery.js');
    const testData = {
      finding: {
        id: 'test-finding',
        title: 'Test Alert; This is a Scout test notification',
        severity: 'critical',
        cve_id: 'CVE-TEST-001',
        cvss_score: 9.8,
        affected_host: 'test.example.com',
        affected_port: 443,
        description: 'This is a test alert to verify your notification channels are working.',
        remediation: 'No action needed; this is a test.',
        tool_name: 'Scout Test',
        first_seen_at: new Date().toISOString(),
      },
      event: 'finding_new',
      score: { total: 75 },
    };

    const results = await deliverAlert(
      {
        id: rule.id,
        workspaceId,
        name: rule.name,
        trigger: typeof rule.trigger === 'string' ? JSON.parse(rule.trigger) : rule.trigger,
        channels: channel ? [channel] : rule.channels,
        config: typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config,
        enabled: true,
        cooldownMinutes: 0,
      },
      testData,
    );

    res.json({ results, message: 'Test alert sent' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});
