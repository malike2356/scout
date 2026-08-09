// scout-engine/src/api/public/v1/index.ts
// Public, org API-key-scoped SaaS contract for Scout customers. Mounted at /v1.
import { Router, type Router as ExpressRouter } from 'express';
import crypto from 'crypto';
import { db } from '../../../db/index.js';
import { tenantMiddleware, type TenantRequest } from '../../middleware/tenant-scope.js';
import { rateLimitMiddleware } from '../../../lib/rate-limiter.js';
import { checkAgentLimit } from '../../middleware/plan-enforce.js';
import { filterPrompt } from '../../../security/prompt-guard.js';
import {
  AgentGuardError,
  assertAgentRunnable,
  isKillSwitchActive,
  loadOrgAgent,
} from './agent-guard.js';
import { upsertRuntimeTarget } from '../../../integrations/keprix-connector.js';
import { evaluateKeprixAnomalyOnEvent } from '../../../alerts/keprix-anomaly.js';
import { secretScanningRouter } from './secret-scanning.js';
import { getSecretScanHealth } from '../../../secret-scanning/health.js';

export const publicV1Router: ExpressRouter = Router();

const ENGINE_VERSION = '1.0.0';

function sendGuardError(res: import('express').Response, err: unknown): boolean {
  if (err instanceof AgentGuardError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...err.payload,
    });
    return true;
  }
  return false;
}

publicV1Router.get('/health', async (_req, res) => {
  const secretScan = await getSecretScanHealth().catch(() => ({ tables_ready: false }));
  res.json({
    status: 'ok',
    service: 'scout-public-api',
    version: ENGINE_VERSION,
    timestamp: new Date().toISOString(),
    repository_secret_scanning: secretScan,
  });
});

publicV1Router.use(tenantMiddleware);
publicV1Router.use(rateLimitMiddleware());

// Repository secret scanning (metadata-only ingest + tenant-scoped reads).
publicV1Router.use(secretScanningRouter);

publicV1Router.post('/agents/register', checkAgentLimit, async (req, res) => {
  try {
    const tenantReq = req as TenantRequest;
    const { name, type, tools, metadata } = (req.body ?? {}) as {
      name?: unknown;
      type?: unknown;
      tools?: unknown;
      metadata?: unknown;
    };

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'internal', message: 'name is required' });
      return;
    }

    const agentType = typeof type === 'string' && type.trim() ? type.trim() : 'generic';
    const metaObj =
      metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};

    const agentMetadata = {
      ...metaObj,
      tools: Array.isArray(tools) ? tools : [],
    };

    const rawToken = `mtk_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const [agent] = await db('connected_agents')
      .insert({
        organization_id: tenantReq.organizationId,
        workspace_id: tenantReq.workspaceId,
        agent_type: agentType,
        name: name.trim(),
        api_key_hash: tokenHash,
        metadata: JSON.stringify(agentMetadata),
        status: 'offline',
      })
      .returning('*');

    if (agentType.toLowerCase() === 'keprix' || String(metaObj.engine || '').toLowerCase() === 'keprix') {
      const keprixUrl =
        (typeof metaObj.keprix_url === 'string' && metaObj.keprix_url) ||
        (typeof metaObj.url === 'string' && metaObj.url) ||
        process.env.KEPRIX_URL ||
        process.env.SCOUT_KEPRIX_URL ||
        '';
      if (keprixUrl) {
        await upsertRuntimeTarget({
          organizationId: tenantReq.organizationId!,
          workspaceId: tenantReq.workspaceId ?? null,
          name: name.trim() || 'keprix-aiva',
          type: 'keprix',
          url: keprixUrl,
          authToken:
            (typeof metaObj.keprix_auth_token === 'string' && metaObj.keprix_auth_token) ||
            process.env.KEPRIX_SCOUT_KILL_TOKEN ||
            process.env.CARINA_KEPRIX_SHARED_TOKEN ||
            undefined,
          agentId: agent.id,
          metadata: {
            workspace_id: metaObj.workspace_id ?? tenantReq.workspaceId,
            engine: 'keprix',
          },
        }).catch((err) => {
          console.warn(
            '[scout:v1] runtime_targets upsert failed:',
            err instanceof Error ? err.message : err,
          );
        });
      }
    }

    res.status(201).json({
      agent_id: agent.id,
      id: agent.id,
      monitoring_token: rawToken,
      status: agent.status,
      created_at: agent.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

publicV1Router.post('/prompts/filter', async (req, res) => {
  try {
    const tenantReq = req as TenantRequest;
    const body = (req.body ?? {}) as { prompt?: unknown; agent_id?: unknown; agentId?: unknown };
    const prompt = body.prompt;
    const agentId = body.agent_id ?? body.agentId;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'internal', message: 'prompt is required' });
      return;
    }
    if (typeof agentId !== 'string' || !agentId.trim()) {
      res.status(400).json({ error: 'internal', message: 'agent_id is required' });
      return;
    }

    const agent = await loadOrgAgent(tenantReq.organizationId!, agentId.trim());
    assertAgentRunnable(agent);

    const result = filterPrompt(prompt);
    res.json({
      verdict: result.verdict,
      filtered_prompt: result.filtered_prompt,
      risk_level: result.risk_level,
      distillation: result.distillation,
      finding_id: null,
      agent_id: agent.id,
    });
  } catch (err) {
    if (sendGuardError(res, err)) return;
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

publicV1Router.post('/events', async (req, res) => {
  try {
    const tenantReq = req as TenantRequest;
    const body = req.body as { events?: unknown; agent_id?: unknown; agentId?: unknown } | unknown[] | undefined;
    const events: Record<string, unknown>[] = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : Array.isArray((body as { events?: unknown })?.events)
        ? ((body as { events: unknown[] }).events as Record<string, unknown>[])
        : body
          ? [body as Record<string, unknown>]
          : [];

    let accepted = 0;
    let rejected = 0;

    for (const raw of events) {
      if (!raw || typeof raw !== 'object') {
        rejected += 1;
        continue;
      }

      const agentId = (raw.agent_id ?? raw.agentId) as string | undefined;
      const eventType = (raw.event_type ?? raw.eventType ?? raw.type) as string | undefined;
      if (!agentId || !eventType) {
        rejected += 1;
        continue;
      }

      let agent: Record<string, unknown>;
      try {
        agent = await loadOrgAgent(tenantReq.organizationId!, agentId);
        assertAgentRunnable(agent);
      } catch (err) {
        if (err instanceof AgentGuardError && err.code === 'kill_switch') {
          res.status(err.status).json({
            error: err.code,
            message: err.message,
            ...err.payload,
          });
          return;
        }
        rejected += 1;
        continue;
      }

      const toolArgs = raw.tool_args ?? raw.toolArgs;
      const toolResult = raw.tool_result ?? raw.toolResult;

      await db('agent_events').insert({
        agent_id: agentId,
        workspace_id: agent.workspace_id,
        organization_id: tenantReq.organizationId,
        event_type: eventType,
        tool_name: (raw.tool_name ?? raw.toolName ?? null) as string | null,
        tool_args: toolArgs != null ? JSON.stringify(toolArgs) : null,
        tool_result: toolResult != null ? JSON.stringify(toolResult) : null,
        duration_ms: (raw.duration_ms ?? raw.duration ?? null) as number | null,
        session_id: (raw.session_id ?? raw.sessionId ?? null) as string | null,
        occurred_at: (raw.occurred_at ?? raw.timestamp ?? new Date().toISOString()) as string,
      });

      await db('connected_agents')
        .where({ id: agentId })
        .update({ last_heartbeat: new Date().toISOString(), status: 'online' });

      await evaluateKeprixAnomalyOnEvent({
        organizationId: tenantReq.organizationId!,
        workspaceId: String(agent.workspace_id || tenantReq.workspaceId || ''),
        agentId,
        agentType: String(agent.agent_type || ''),
        eventType,
      }).catch((err) => {
        console.warn(
          '[scout:v1] keprix anomaly eval failed:',
          err instanceof Error ? err.message : err,
        );
      });

      accepted += 1;
    }

    res.status(202).json({ accepted, rejected });
  } catch (err) {
    if (sendGuardError(res, err)) return;
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

publicV1Router.get('/agents/:id/status', async (req, res) => {
  try {
    const tenantReq = req as TenantRequest;
    const agent = await loadOrgAgent(tenantReq.organizationId!, req.params.id);

    const lastEvent = await db('agent_events')
      .where({ agent_id: agent.id })
      .orderBy('occurred_at', 'desc')
      .first();

    const latestScore = await db('scout_scores')
      .where({ workspace_id: agent.workspace_id })
      .orderBy('calculated_at', 'desc')
      .first();

    const status = String(agent.status ?? '');
    res.json({
      agent_id: agent.id,
      name: agent.name,
      type: agent.agent_type,
      status,
      kill_switch_active: isKillSwitchActive(status),
      last_heartbeat: agent.last_heartbeat,
      last_event: lastEvent ?? null,
      scout_score: latestScore ? latestScore.total : null,
      created_at: agent.created_at,
    });
  } catch (err) {
    if (sendGuardError(res, err)) return;
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});
