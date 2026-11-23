import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { buildStatusResponse } from './boundary/status.js';
import { listEvents } from './boundary/events.js';
import { sseRouter } from '../event-server/api/sse.js';
import { adminTargetsRouter } from './admin/targets.js';
import {
  killAgentAndPropagateToKeprix,
  resumeAgentAndPropagateToKeprix,
} from '../integrations/keprix-connector.js';
import { AgentControlError } from '../control/agent-control.js';

export const adminRouter: ExpressRouter = Router();

adminRouter.use(adminTargetsRouter);

adminRouter.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await buildStatusResponse());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scout-engine:admin] Status failed:', msg);
    res.status(500).json({ error: 'Database unavailable' });
  }
});

adminRouter.get('/events', listEvents);
adminRouter.use('/stream', sseRouter);

function validateKillReason(body: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'reason is required and must be a non-empty string' };
  }
  const reason = (body as Record<string, unknown>).reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    return { ok: false, error: 'reason is required and must be a non-empty string' };
  }
  return { ok: true, reason: reason.trim() };
}

// Static-admin-key alternative to the dashboard's JWT-gated kill switch -
// same underlying agent-control.ts path, useful for scripted/automated
// kills that shouldn't need a logged-in dashboard session. Unlike the old
// Carina-era /kill/:instanceId, this operates on the real connected_agents
// table and is org-scoped like everywhere else in Scout.
adminRouter.post('/kill/:agentId', async (req: Request, res: Response): Promise<void> => {
  const agentId = String(req.params.agentId ?? '');
  const organizationId = String((req.body as { organization_id?: unknown })?.organization_id ?? '');
  if (!agentId) {
    res.status(400).json({ error: 'Agent id required' });
    return;
  }
  if (!organizationId) {
    res.status(400).json({ error: 'organization_id is required in the request body' });
    return;
  }

  const validated = validateKillReason(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  try {
    const { agent, keprix } = await killAgentAndPropagateToKeprix({
      organizationId,
      agentId,
      reason: validated.reason,
      activatedBy: 'scout-admin-api',
    });

    const activatedAt = new Date().toISOString();
    res.json({
      ok: true,
      agent_id: agent.id,
      status: agent.status,
      confirmation: `KILL SWITCH ACTIVATED - ${activatedAt} by operator`,
      activated_at: activatedAt,
      admin: 'scout-engine-admin',
      keprix,
    });
  } catch (err) {
    if (err instanceof AgentControlError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

adminRouter.post('/resume/:agentId', async (req: Request, res: Response): Promise<void> => {
  const agentId = String(req.params.agentId ?? '');
  const organizationId = String((req.body as { organization_id?: unknown })?.organization_id ?? '');
  if (!agentId) {
    res.status(400).json({ error: 'Agent id required' });
    return;
  }
  if (!organizationId) {
    res.status(400).json({ error: 'organization_id is required in the request body' });
    return;
  }

  try {
    const { agent, keprix } = await resumeAgentAndPropagateToKeprix({ organizationId, agentId });
    res.json({ ok: true, agent_id: agent.id, status: agent.status, keprix });
  } catch (err) {
    if (err instanceof AgentControlError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
