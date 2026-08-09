// scout-engine/src/api/dashboard/index.ts
// Session-oriented API for the Scout customer dashboard (signup/login, overview,
// agents, alerts, scores, API keys, kill switch, org settings). Mounted at
// /api/dashboard. Auth is a JWT bearer token issued by /auth/signup or /auth/login.
import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../db/index.js';
import { dashboardAuthMiddleware, signDashboardToken, type DashboardRequest } from '../middleware/dashboard-auth.js';
import { requirePlanFeature } from '../middleware/plan-enforce.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../../lib/api-keys.js';
import { dashboardKeprixRouter } from '../admin/targets.js';
import {
  killAgentAndPropagateToKeprix,
  resumeAgentAndPropagateToKeprix,
} from '../../integrations/keprix-connector.js';
import { dashboardRepositorySecurityRouter } from './repository-security.js';

export const dashboardRouter: ExpressRouter = Router();

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

async function uniqueSlug(base: string): Promise<string> {
  const slugBase = slugify(base) || 'org';
  let slug = slugBase;
  let suffix = 0;
  // eslint-disable-next-line no-constant-condition
  while (await db('organizations').where({ slug }).first()) {
    suffix += 1;
    slug = `${slugBase}-${suffix}`;
  }
  return slug;
}

function publicOrganization(organization: Record<string, unknown>): Record<string, unknown> {
  const { stripe_customer_id, stripe_subscription_id, ...safe } = organization;
  return safe;
}

// ════════════════════════════════════════════
// Auth (no bearer token required)
// ════════════════════════════════════════════
dashboardRouter.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name, organization_name } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'internal', message: 'A valid email and a password of at least 8 characters are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db('dashboard_users').where({ email: normalizedEmail }).first();
    if (existing) {
      res.status(409).json({ error: 'internal', message: 'An account with that email already exists.' });
      return;
    }

    const orgName = typeof organization_name === 'string' && organization_name.trim()
      ? organization_name.trim()
      : `${normalizedEmail.split('@')[0]}'s Organization`;
    const slug = await uniqueSlug(orgName);

    const [organization] = await db('organizations')
      .insert({ name: orgName, slug, plan: 'free', subscription_status: 'inactive' })
      .returning('*');

    const [workspace] = await db('workspaces')
      .insert({ organization_id: organization.id, name: 'Default Workspace', active: true })
      .returning('*');

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db('dashboard_users')
      .insert({
        organization_id: organization.id,
        email: normalizedEmail,
        password_hash: passwordHash,
        name: typeof name === 'string' ? name.trim() : null,
      })
      .returning('*');

    const token = signDashboardToken({ organizationId: organization.id, userId: user.id, email: user.email });

    res.status(201).json({
      token,
      organization: publicOrganization(organization),
      workspace_id: workspace.id,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRouter.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'internal', message: 'email and password are required.' });
      return;
    }

    const user = await db('dashboard_users').where({ email: email.trim().toLowerCase() }).first();
    if (!user) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid credentials.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid credentials.' });
      return;
    }

    const organization = await db('organizations').where({ id: user.organization_id }).first();
    const token = signDashboardToken({ organizationId: user.organization_id, userId: user.id, email: user.email });

    res.json({
      token,
      organization: organization ? publicOrganization(organization) : null,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// Everything below requires a valid dashboard session
// ════════════════════════════════════════════
dashboardRouter.use(dashboardAuthMiddleware);

async function attachOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dashboardReq = req as DashboardRequest;
    if (!dashboardReq.organizationId) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing organization context.' });
      return;
    }
    const organization = await db('organizations').where({ id: dashboardReq.organizationId }).first();
    if (!organization) {
      res.status(404).json({ error: 'not_found', message: 'Organization not found.' });
      return;
    }
    dashboardReq.organization = organization;
    next();
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
}

dashboardRouter.use(attachOrganization);
dashboardRouter.use(dashboardKeprixRouter);
dashboardRouter.use(dashboardRepositorySecurityRouter);

// ════════════════════════════════════════════
// Overview
// ════════════════════════════════════════════
dashboardRouter.get('/overview', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;

    const workspaces = await db('workspaces').where({ organization_id: organizationId }).select('id');
    const workspaceIds = workspaces.map((w) => w.id);

    const agentsActive = await db('connected_agents')
      .where({ organization_id: organizationId, status: 'online' })
      .count('* as count')
      .first();
    const agentsTotal = await db('connected_agents')
      .where({ organization_id: organizationId })
      .count('* as count')
      .first();
    const alertsToday = await db('alert_history')
      .where({ organization_id: organizationId })
      .where('created_at', '>=', db.raw("date_trunc('day', now())"))
      .count('* as count')
      .first();

    const latestScore = workspaceIds.length
      ? await db('scout_scores').whereIn('workspace_id', workspaceIds).orderBy('calculated_at', 'desc').first()
      : null;

    res.json({
      agents_active: parseInt((agentsActive?.count as string) || '0', 10),
      agents_total: parseInt((agentsTotal?.count as string) || '0', 10),
      alerts_today: parseInt((alertsToday?.count as string) || '0', 10),
      scout_score: latestScore?.total ?? null,
      score_categories: latestScore?.categories ?? null,
      calculated_at: latestScore?.calculated_at ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// Agents
// ════════════════════════════════════════════
dashboardRouter.get('/agents', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const agents = await db('connected_agents')
      .where({ organization_id: organizationId })
      .orderBy('created_at', 'desc');
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRouter.get('/agents/:id', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const agent = await db('connected_agents')
      .where({ id: req.params.id, organization_id: organizationId })
      .first();
    if (!agent) {
      res.status(404).json({ error: 'not_found', message: 'Agent not found.' });
      return;
    }
    const events = await db('agent_events')
      .where({ agent_id: agent.id })
      .orderBy('occurred_at', 'desc')
      .limit(50);
    res.json({ agent, events });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// Alerts
// ════════════════════════════════════════════
dashboardRouter.get('/alerts', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const { severity, limit = '50' } = req.query as Record<string, string>;

    let query = db('alert_history as ah')
      .leftJoin('findings as f', 'ah.finding_id', 'f.id')
      .where('ah.organization_id', organizationId)
      .select('ah.*', 'f.severity as finding_severity', 'f.title as finding_title');

    if (severity) query = query.where('f.severity', severity);

    const alerts = await query
      .orderBy('ah.created_at', 'desc')
      .limit(Math.min(parseInt(limit, 10) || 50, 200));

    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// Scores
// ════════════════════════════════════════════
dashboardRouter.get('/scores', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const days = Math.min(parseInt((req.query.days as string) || '90', 10) || 90, 365);

    const workspaces = await db('workspaces').where({ organization_id: organizationId }).select('id');
    const workspaceIds = workspaces.map((w) => w.id);
    if (workspaceIds.length === 0) {
      res.json({ scores: [] });
      return;
    }

    const scores = await db('scout_scores')
      .whereIn('workspace_id', workspaceIds)
      .where('calculated_at', '>=', db.raw(`NOW() - INTERVAL '${days} days'`))
      .orderBy('calculated_at', 'asc');

    res.json({ scores });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// API keys
// ════════════════════════════════════════════
dashboardRouter.get('/api-keys', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const apiKeys = await listApiKeys(organizationId);
    res.json({ api_keys: apiKeys });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRouter.post('/api-keys', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const { name, scopes } = (req.body ?? {}) as { name?: unknown; scopes?: unknown };
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'internal', message: 'name is required' });
      return;
    }
    const created = await createApiKey(
      organizationId,
      name.trim(),
      Array.isArray(scopes) ? (scopes as string[]) : undefined,
    );
    res.status(201).json({ api_key: created });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRouter.delete('/api-keys/:id', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const revoked = await revokeApiKey(organizationId, req.params.id);
    if (!revoked) {
      res.status(404).json({ error: 'not_found', message: 'API key not found.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// Kill switch
// ════════════════════════════════════════════
dashboardRouter.post('/killswitch/:agentId', requirePlanFeature('killswitch'), async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const reason =
      typeof (req.body as { reason?: unknown })?.reason === 'string'
        ? String((req.body as { reason: string }).reason)
        : 'Operator-initiated kill from Scout dashboard';
    const { agent, keprix } = await killAgentAndPropagateToKeprix({
      organizationId,
      agentId: req.params.agentId,
      reason,
      activatedBy: 'scout',
    });
    res.json({ agent, keprix });
  } catch (err) {
    const status = (err as { status?: number }).status === 404 ? 404 : 500;
    if (status === 404) {
      res.status(404).json({ error: 'not_found', message: 'Agent not found.' });
      return;
    }
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRouter.post('/agents/:id/resume', requirePlanFeature('killswitch'), async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const { agent, keprix } = await resumeAgentAndPropagateToKeprix({
      organizationId,
      agentId: req.params.id,
    });
    res.json({ agent, keprix });
  } catch (err) {
    const status = (err as { status?: number }).status === 404 ? 404 : 500;
    if (status === 404) {
      res.status(404).json({ error: 'not_found', message: 'Agent not found.' });
      return;
    }
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// E2E / staging only: bump plan without Stripe when SCOUT_E2E_ALLOW_PLAN_OVERRIDE=true
dashboardRouter.post('/e2e/set-plan', async (req, res) => {
  if (process.env.SCOUT_E2E_ALLOW_PLAN_OVERRIDE !== 'true') {
    res.status(404).json({ error: 'not_found', message: 'Not found.' });
    return;
  }
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const plan = String((req.body as { plan?: unknown })?.plan ?? '');
    if (!['free', 'monitor', 'govern', 'team'].includes(plan)) {
      res.status(400).json({ error: 'internal', message: 'plan must be free|monitor|govern|team' });
      return;
    }
    const [organization] = await db('organizations')
      .where({ id: organizationId })
      .update({
        plan,
        subscription_status: plan === 'free' ? 'inactive' : 'active',
        updated_at: new Date().toISOString(),
      })
      .returning('*');
    res.json({ organization: publicOrganization(organization) });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// Organization
// ════════════════════════════════════════════
dashboardRouter.get('/org', (req, res) => {
  const organization = (req as DashboardRequest).organization!;
  res.json({ organization: publicOrganization(organization) });
});

dashboardRouter.patch('/org', async (req, res) => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const { name, settings } = (req.body ?? {}) as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (settings !== undefined) updates.settings = JSON.stringify(settings);

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'internal', message: 'No updatable fields provided.' });
      return;
    }

    updates.updated_at = new Date().toISOString();
    const [organization] = await db('organizations').where({ id: organizationId }).update(updates).returning('*');
    res.json({ organization: publicOrganization(organization) });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});
