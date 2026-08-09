/**
 * Admin + dashboard APIs for Scout runtime targets (Keprix C04).
 * POST /api/admin/targets  and  /api/dashboard/runtime-targets
 */
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import {
  KEPRIX_SENSORS,
  buildKeprixDashboardStatus,
  fetchKeprixSensors,
  fetchKeprixStatus,
  handleChannelKill,
  listRuntimeTargets,
  loadTargetsYaml,
  resolveKeprixConfig,
  upsertRuntimeTarget,
} from '../../integrations/keprix-connector.js';
import type { DashboardRequest } from '../middleware/dashboard-auth.js';

export const adminTargetsRouter: ExpressRouter = Router();
export const dashboardKeprixRouter: ExpressRouter = Router();

adminTargetsRouter.get('/targets', async (_req: Request, res: Response): Promise<void> => {
  try {
    const yaml = loadTargetsYaml();
    const dbTargets = await listRuntimeTargets();
    res.json({
      config: yaml,
      sensors: KEPRIX_SENSORS,
      targets: dbTargets,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

adminTargetsRouter.post('/targets', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as {
      name?: string;
      type?: string;
      url?: string;
      auth_token?: string;
      workspace_id?: string;
      organization_id?: string;
      agent_id?: string;
      metadata?: Record<string, unknown>;
    };

    const name = String(body.name || 'keprix-aiva').trim();
    const type = String(body.type || 'keprix').trim().toLowerCase();
    const url = String(body.url || '').trim();
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    if (type !== 'keprix' && type !== 'carina' && type !== 'generic') {
      res.status(400).json({ error: 'type must be keprix|carina|generic' });
      return;
    }

    const target = await upsertRuntimeTarget({
      organizationId: body.organization_id ?? null,
      workspaceId: body.workspace_id ?? null,
      name,
      type,
      url,
      authToken: body.auth_token,
      agentId: body.agent_id ?? null,
      metadata: {
        ...(body.metadata || {}),
        workspace_id: body.workspace_id,
        sensors: KEPRIX_SENSORS.map((s) => s.id),
      },
    });

    res.status(201).json({
      target,
      sensors: KEPRIX_SENSORS,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

adminTargetsRouter.post('/targets/channel-kill', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as {
      organization_id?: string;
      agent_id?: string;
      workspace_id?: string;
      channel?: string;
      command?: string;
      operator_id?: string;
    };
    if (!body.organization_id || !body.agent_id || !body.channel || !body.command) {
      res.status(400).json({
        error: 'organization_id, agent_id, channel, and command are required',
      });
      return;
    }
    const result = await handleChannelKill({
      organizationId: body.organization_id,
      agentId: body.agent_id,
      workspaceId: body.workspace_id,
      channel: body.channel,
      command: body.command,
      operatorId: body.operator_id,
    });
    res.json({
      ok: true,
      audit_id: result.audit_id,
      agent: result.agent,
      keprix: result.keprix,
      message: `Workspace halted. Audit: ${result.audit_id}`,
    });
  } catch (err) {
    const status = (err as { status?: number }).status === 404 ? 404 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

dashboardKeprixRouter.get('/keprix/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const status = await buildKeprixDashboardStatus(organizationId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

dashboardKeprixRouter.get('/runtime-targets', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const targets = await listRuntimeTargets(organizationId);
    const cfg = resolveKeprixConfig();
    res.json({ targets, config: cfg, sensors: KEPRIX_SENSORS });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

dashboardKeprixRouter.post('/runtime-targets', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req as DashboardRequest).organizationId!;
    const workspaceId = (req as DashboardRequest).workspaceId;
    const body = (req.body ?? {}) as {
      name?: string;
      type?: string;
      url?: string;
      auth_token?: string;
      agent_id?: string;
      workspace_id?: string;
      metadata?: Record<string, unknown>;
    };
    const url = String(body.url || '').trim();
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const target = await upsertRuntimeTarget({
      organizationId,
      workspaceId: body.workspace_id || workspaceId || null,
      name: String(body.name || 'keprix-aiva').trim(),
      type: String(body.type || 'keprix'),
      url,
      authToken: body.auth_token,
      agentId: body.agent_id ?? null,
      metadata: body.metadata,
    });
    res.status(201).json({ target });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

dashboardKeprixRouter.post('/keprix/health-check', async (req: Request, res: Response): Promise<void> => {
  try {
    const health = await fetchKeprixStatus();
    const sensors = await fetchKeprixSensors();
    res.json({ health, sensors });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
