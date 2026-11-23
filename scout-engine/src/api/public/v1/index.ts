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
import { recordPromptFilterEventAndMaybeAutoKill } from '../../../control/agent-control.js';
import { issueIdentityChallenge, registerAgentIdentity, verifyRequestSignature } from '../../../blockchain/identity.js';

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

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Strict-mode signature check for organizations.require_onchain_identity.
 * The caller signs `signed_message` (a JSON envelope string containing at
 * least agent_id + timestamp, plus whatever fields `expectFields` checks),
 * covering the whole envelope rather than the raw request body so the
 * signature can be verified independent of JSON key ordering.
 */
async function checkRequiredSignature(
  agent: Record<string, unknown>,
  expectFields: Record<string, unknown>,
  signedMessage: unknown,
  signature: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (typeof signedMessage !== 'string' || typeof signature !== 'string') {
    return { ok: false, reason: 'This organization requires signed_message + signature on every request.' };
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(signedMessage);
  } catch {
    return { ok: false, reason: 'signed_message must be a JSON string.' };
  }

  if (envelope.agent_id !== agent.id) {
    return { ok: false, reason: 'signed_message.agent_id does not match the submitting agent.' };
  }

  const timestamp = Number(envelope.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGNATURE_WINDOW_MS) {
    return { ok: false, reason: 'signed_message.timestamp is missing or outside the 5-minute signing window.' };
  }

  for (const [key, value] of Object.entries(expectFields)) {
    if (envelope[key] !== value) {
      return { ok: false, reason: `signed_message.${key} does not match the submitted ${key}.` };
    }
  }

  return verifyRequestSignature({ agent, message: signedMessage, signature });
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
    const body = (req.body ?? {}) as {
      prompt?: unknown;
      agent_id?: unknown;
      agentId?: unknown;
      signed_message?: unknown;
      signature?: unknown;
    };
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
    assertAgentRunnable(agent, tenantReq.organization);

    if (tenantReq.organization?.require_onchain_identity) {
      const sigCheck = await checkRequiredSignature(
        agent,
        { prompt },
        body.signed_message,
        body.signature,
      );
      if (!sigCheck.ok) {
        res.status(403).json({ error: 'identity_required', message: sigCheck.reason, agent_id: agent.id });
        return;
      }
    }

    const result = filterPrompt(prompt);

    const autoKill = await recordPromptFilterEventAndMaybeAutoKill({
      organizationId: tenantReq.organizationId!,
      agentId: agent.id as string,
      verdict: result.verdict,
      riskLevel: result.risk_level,
      autoKillThreshold: (tenantReq.organization?.auto_kill_threshold as number | null) ?? null,
    }).catch((err) => {
      console.warn('[scout:v1] auto-kill check failed:', err instanceof Error ? err.message : err);
      return null;
    });

    res.json({
      verdict: result.verdict,
      filtered_prompt: result.filtered_prompt,
      risk_level: result.risk_level,
      distillation: result.distillation,
      finding_id: null,
      agent_id: agent.id,
      agent_auto_killed: Boolean(autoKill),
    });
  } catch (err) {
    if (sendGuardError(res, err)) return;
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

publicV1Router.post('/events', async (req, res) => {
  try {
    const tenantReq = req as TenantRequest;
    const body = req.body as
      | { events?: unknown; agent_id?: unknown; agentId?: unknown; signed_message?: unknown; signature?: unknown }
      | unknown[]
      | undefined;
    const events: Record<string, unknown>[] = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : Array.isArray((body as { events?: unknown })?.events)
        ? ((body as { events: unknown[] }).events as Record<string, unknown>[])
        : body
          ? [body as Record<string, unknown>]
          : [];
    const signedMessage = Array.isArray(body) ? undefined : body?.signed_message;
    const signature = Array.isArray(body) ? undefined : body?.signature;

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
        assertAgentRunnable(agent, tenantReq.organization);

        if (tenantReq.organization?.require_onchain_identity) {
          const sigCheck = await checkRequiredSignature(
            agent,
            { event_count: events.length },
            signedMessage,
            signature,
          );
          if (!sigCheck.ok) {
            res.status(403).json({ error: 'identity_required', message: sigCheck.reason, agent_id: agent.id });
            return;
          }
        }
      } catch (err) {
        if (err instanceof AgentGuardError && err.code !== 'not_found') {
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
    const globalKillActive = Boolean(tenantReq.organization?.global_kill_active);
    res.json({
      agent_id: agent.id,
      name: agent.name,
      type: agent.agent_type,
      status,
      kill_switch_active: globalKillActive || isKillSwitchActive(status),
      kill_switch_scope: globalKillActive ? 'global' : isKillSwitchActive(status) ? 'agent' : null,
      suspension_reason: agent.suspension_reason ?? (globalKillActive ? tenantReq.organization?.global_kill_reason : null) ?? null,
      last_heartbeat: agent.last_heartbeat,
      last_event: lastEvent ?? null,
      scout_score: latestScore ? latestScore.total : null,
      identity: {
        chain_address: agent.chain_address ?? null,
        verified_onchain: Boolean(agent.identity_verified_onchain),
      },
      created_at: agent.created_at,
    });
  } catch (err) {
    if (sendGuardError(res, err)) return;
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// ════════════════════════════════════════════
// Blockchain agent identity (ScoutAgentIdentity.sol, Sepolia - see
// scout-chain/ and docs/architecture/KILL-SWITCH-AND-BLOCKCHAIN-IDENTITY.md)
// ════════════════════════════════════════════

// Step 1: the agent/SDK requests a one-time nonce to sign, proving it
// controls the private key behind the address it's about to claim.
publicV1Router.get('/agents/:id/identity/challenge', async (req, res) => {
  try {
    const tenantReq = req as TenantRequest;
    const agent = await loadOrgAgent(tenantReq.organizationId!, req.params.id);
    const challenge = await issueIdentityChallenge(agent.id as string);
    res.json({
      agent_id: agent.id,
      nonce: challenge.nonce,
      message: challenge.message,
      expires_in_seconds: 300,
    });
  } catch (err) {
    if (sendGuardError(res, err)) return;
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});

// Step 2: the agent signs `message` from the challenge with its own
// secp256k1 key and submits { address, nonce, signature }. Scout verifies
// the signature, then anchors the agent<->address binding on-chain.
publicV1Router.post('/agents/:id/identity/register', async (req, res) => {
  try {
    const tenantReq = req as TenantRequest;
    const agent = await loadOrgAgent(tenantReq.organizationId!, req.params.id);
    const body = (req.body ?? {}) as {
      address?: unknown;
      nonce?: unknown;
      signature?: unknown;
      metadata_uri?: unknown;
    };

    if (typeof body.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) {
      res.status(400).json({ error: 'internal', message: 'address must be a 0x-prefixed Ethereum address' });
      return;
    }
    if (typeof body.nonce !== 'string' || typeof body.signature !== 'string') {
      res.status(400).json({ error: 'internal', message: 'nonce and signature are required' });
      return;
    }

    const result = await registerAgentIdentity({
      organizationId: tenantReq.organizationId!,
      agentId: agent.id as string,
      address: body.address as `0x${string}`,
      nonce: body.nonce,
      signature: body.signature as `0x${string}`,
      metadataURI: typeof body.metadata_uri === 'string' ? body.metadata_uri : undefined,
    });

    if (!result.ok) {
      res.status(400).json({ error: 'identity_registration_failed', message: result.error });
      return;
    }

    res.json({
      agent_id: agent.id,
      chain_address: result.chain_address,
      tx_hash: result.tx_hash ?? null,
      explorer_url: result.explorer_url ?? null,
      verified_onchain: !result.skipped,
    });
  } catch (err) {
    if (sendGuardError(res, err)) return;
    res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : String(err) });
  }
});
