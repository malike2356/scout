// scout-engine/src/api/dashboard/repository-security.ts
// JWT-authenticated dashboard wrappers around repository secret-scan services.
import { Router, type Router as ExpressRouter } from 'express';
import { getOrCreateDefaultWorkspace } from '../../lib/org-workspace.js';
import { db } from '../../db/index.js';
import type { DashboardRequest } from '../middleware/dashboard-auth.js';
import {
  createScanRequest,
  exportRedactedFindings,
  getDashboardOverview,
  getFinding,
  getOrCreateSettings,
  getRepositoryDetail,
  getScanRunDetail,
  listFindings,
  listRepositorySummaries,
  listScanRuns,
  revokeConnector,
  transitionRemediation,
  updateSettings,
} from '../../secret-scanning/service.js';
import { offboardConnector } from '../../secret-scanning/jobs.js';

export const dashboardRepositorySecurityRouter: ExpressRouter = Router();

async function scopeFromDashboard(req: DashboardRequest) {
  const organizationId = req.organizationId!;
  const workspaceId = await getOrCreateDefaultWorkspace(organizationId);
  return { organizationId, workspaceId };
}

async function actorFromDashboard(req: DashboardRequest): Promise<string> {
  if (req.email) return req.email;
  if (!req.userId) return 'dashboard-user';
  const user = await db('dashboard_users').where({ id: req.userId }).first();
  return (user?.email as string) || req.userId;
}

function parsePaging(query: Record<string, unknown>) {
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(query.offset ?? '0'), 10) || 0, 0);
  return { limit, offset };
}

dashboardRepositorySecurityRouter.get('/repository-security/overview', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const overview = await getDashboardOverview(scope);
    res.json({ overview });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-connectors', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const repositories = await listRepositorySummaries(scope);
    res.json({ repositories });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-connectors/:id', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const detail = await getRepositoryDetail(scope, req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.post('/repository-connectors/:id/revoke', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const connector = await revokeConnector(scope, req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ connector });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.post('/repository-connectors/:id/offboard', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const connector = await offboardConnector(scope, req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ connector });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-security/export', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const exportPayload = await exportRedactedFindings(scope);
    res.json(exportPayload);
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.post('/repository-connectors/:id/scan-requests', async (req, res) => {
  try {
    const dashboardReq = req as DashboardRequest;
    const scope = await scopeFromDashboard(dashboardReq);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await createScanRequest({
      scope,
      connectorId: req.params.id,
      mode: String(body.mode ?? ''),
      requestedBy: await actorFromDashboard(dashboardReq),
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.code });
      return;
    }
    res.status(201).json({ request: result.request });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-secret-scans', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const q = req.query as Record<string, unknown>;
    const page = parsePaging(q);
    const result = await listScanRuns(scope, {
      connectorId: typeof q.connector_id === 'string' ? q.connector_id : undefined,
      ...page,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-secret-scans/:id', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const detail = await getScanRunDetail(scope, req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-secret-findings', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const q = req.query as Record<string, unknown>;
    const page = parsePaging(q);
    const result = await listFindings(scope, {
      connectorId: typeof q.connector_id === 'string' ? q.connector_id : undefined,
      status: typeof q.status === 'string' ? q.status : undefined,
      severity: typeof q.severity === 'string' ? q.severity : undefined,
      ...page,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-secret-findings/:id', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const detail = await getFinding(scope, req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.post('/repository-secret-findings/:id/remediation', async (req, res) => {
  try {
    const dashboardReq = req as DashboardRequest;
    const scope = await scopeFromDashboard(dashboardReq);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const actor = await actorFromDashboard(dashboardReq);
    const result = await transitionRemediation({
      scope,
      findingId: req.params.id,
      toStatus: String(body.status ?? ''),
      actor,
      reason: String(body.reason ?? ''),
      evidenceNote: typeof body.evidence_note === 'string' ? body.evidence_note : undefined,
      dueAt: typeof body.due_at === 'string' ? body.due_at : undefined,
      acceptedRiskExpiresAt:
        typeof body.accepted_risk_expires_at === 'string'
          ? body.accepted_risk_expires_at
          : undefined,
      remediationOwner:
        typeof body.remediation_owner === 'string' ? body.remediation_owner : undefined,
      correlationId: `dash_${dashboardReq.userId || 'user'}`,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.code });
      return;
    }
    res.json({ finding: result.finding });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.get('/repository-security/settings', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const settings = await getOrCreateSettings(scope);
    const connectors = await listRepositorySummaries(scope);
    res.json({
      settings,
      connectors: connectors.map((c) => ({
        id: c.id,
        repository_alias: c.repository_alias,
        status: c.status,
        connector_key: c.connector_key,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

dashboardRepositorySecurityRouter.put('/repository-security/settings', async (req, res) => {
  try {
    const scope = await scopeFromDashboard(req as DashboardRequest);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const settings = await updateSettings(scope, {
      retention_days: typeof body.retention_days === 'number' ? body.retention_days : undefined,
      overdue_days: typeof body.overdue_days === 'number' ? body.overdue_days : undefined,
      severity_routing:
        body.severity_routing && typeof body.severity_routing === 'object'
          ? (body.severity_routing as Record<string, string>)
          : undefined,
      path_display_policy:
        typeof body.path_display_policy === 'string' ? body.path_display_policy : undefined,
      commit_display_policy:
        typeof body.commit_display_policy === 'string' ? body.commit_display_policy : undefined,
    });
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});
