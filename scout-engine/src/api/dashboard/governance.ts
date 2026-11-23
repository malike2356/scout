// scout-engine/src/api/dashboard/governance.ts
// JWT-authenticated dashboard proxy to the OpenShell governance extension
// service (../openshell-governance-service, prompts 02-06 of
// pending-prompts/openshell-governance/). That service runs its own
// unauthenticated operator HTTP surface (GET /evidence/*, GET+POST
// /linkage/*) by design - it is meant to be reached from inside the
// deployment, not from a browser. This router is the thing that puts it
// behind the SAME login every other dashboard page already requires,
// rather than opening a second, unauthenticated path to governance data.
//
// Known limitation, stated plainly rather than silently assumed away: the
// governance service has no multi-tenant model yet (its own tenantId is a
// fixed "default" placeholder - see prompt 09). Every dashboard
// organization that reaches these routes sees the SAME governance data.
// That is acceptable for a single-operator research deployment and would
// need prompt 09 before it could serve more than one real tenant.
import { Router, type Router as ExpressRouter } from 'express';
import type { DashboardRequest } from '../middleware/dashboard-auth.js';

export const dashboardGovernanceRouter: ExpressRouter = Router();

function governanceBaseUrl(): string {
  return (process.env.SCOUT_GOVERNANCE_API_URL || 'http://localhost:18080').replace(/\/$/, '');
}

async function proxy(
  method: 'GET' | 'POST',
  path: string,
  options: { query?: URLSearchParams; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const qs = options.query && options.query.toString() ? `?${options.query.toString()}` : '';
  let response: Response;
  try {
    response = await fetch(`${governanceBaseUrl()}${path}${qs}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    return { status: 502, body: { error: 'unreachable', message: 'Could not reach the governance service.' } };
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: 'bad_upstream_response', raw: text.slice(0, 500) };
  }
  return { status: response.status, body };
}

function forward(res: import('express').Response, result: { status: number; body: unknown }): void {
  res.status(result.status).json(result.body);
}

dashboardGovernanceRouter.get('/governance/decisions', async (req, res) => {
  const query = new URLSearchParams(req.query as Record<string, string>);
  forward(res, await proxy('GET', '/evidence/decisions', { query }));
});

dashboardGovernanceRouter.get('/governance/decisions/:uid', async (req, res) => {
  forward(res, await proxy('GET', `/evidence/decisions/${encodeURIComponent(req.params.uid)}`));
});

dashboardGovernanceRouter.get('/governance/decisions/:uid/activity', async (req, res) => {
  forward(res, await proxy('GET', `/linkage/decisions/${encodeURIComponent(req.params.uid)}/activity`));
});

dashboardGovernanceRouter.get('/governance/grants', async (req, res) => {
  const query = new URLSearchParams(req.query as Record<string, string>);
  forward(res, await proxy('GET', '/linkage/grants', { query }));
});

dashboardGovernanceRouter.get('/governance/grants/:id', async (req, res) => {
  forward(res, await proxy('GET', `/linkage/grants/${encodeURIComponent(req.params.id)}`));
});

dashboardGovernanceRouter.get('/governance/policies', async (_req, res) => {
  forward(res, await proxy('GET', '/evidence/policies'));
});

dashboardGovernanceRouter.post('/governance/grants/:id/revoke', async (req, res) => {
  const dashboardReq = req as DashboardRequest;
  const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
  if (!note || !note.trim()) {
    res.status(400).json({ error: 'invalid', message: 'A revoke note is required.' });
    return;
  }
  // The author is always the authenticated caller's own identity, never a
  // client-supplied value - this is an audit trail, not a free-text field
  // an operator could spoof.
  const author = dashboardReq.email || dashboardReq.userId || 'dashboard-user';
  forward(res, await proxy('POST', `/linkage/grants/${encodeURIComponent(req.params.id)}/revoke`, {
    body: { author, note },
  }));
});

dashboardGovernanceRouter.post('/governance/inverse', async (req, res) => {
  forward(res, await proxy('POST', '/linkage/inverse', { body: req.body }));
});

dashboardGovernanceRouter.get('/governance/gaps', async (_req, res) => {
  forward(res, await proxy('GET', '/linkage/gaps'));
});

dashboardGovernanceRouter.get('/governance/policy-status', async (_req, res) => {
  forward(res, await proxy('GET', '/policy/status'));
});

// One combined health line, per prompt 08's overview requirement ("evidence
// health in one line") - fetched from both of the governance service's own
// health endpoints rather than duplicating their logic here.
dashboardGovernanceRouter.get('/governance/health', async (_req, res) => {
  const [evidence, linkage, policyStatus] = await Promise.all([
    proxy('GET', '/evidence/health'),
    proxy('GET', '/linkage/health'),
    proxy('GET', '/policy/status'),
  ]);
  if (evidence.status >= 500 || linkage.status >= 500) {
    res.status(502).json({ error: 'unreachable', message: 'Could not reach the governance service.' });
    return;
  }
  res.json({ evidence: evidence.body, linkage: linkage.body, policy: policyStatus.body });
});
