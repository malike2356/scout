// scout-engine/src/api/public/v1/agent-guard.ts
// Shared helpers for public /v1 routes that must respect kill switch state.
import type { Knex } from 'knex';
import { db } from '../../../db/index.js';

export class AgentGuardError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: Record<string, unknown>;

  constructor(status: number, code: string, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AgentGuardError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function loadOrgAgent(organizationId: string, agentId: string): Promise<Record<string, unknown>> {
  const agent = await db('connected_agents')
    .where({ id: agentId, organization_id: organizationId })
    .first();

  if (!agent) {
    throw new AgentGuardError(404, 'not_found', 'Agent not found', { agent_id: agentId });
  }

  return agent as Record<string, unknown>;
}

export function isKillSwitchActive(status: unknown): boolean {
  return status === 'suspended' || status === 'killed';
}

/**
 * Heartbeat write used by event ingest. The WHERE clause is checked in the
 * same UPDATE as the status write, so a suspend that commits first is not
 * overwritten by an in-flight request that already observed status=online.
 * Returns the number of rows updated (0 when the agent is suspended, killed,
 * or gone).
 */
export function runnableHeartbeatQuery(connection: Knex, agentId: string, atIso: string) {
  return connection('connected_agents')
    .where({ id: agentId })
    .whereNotIn('status', ['suspended', 'killed'])
    .update({
      last_heartbeat: atIso,
      status: 'online',
    });
}

export async function recordRunnableHeartbeat(agentId: string, at: Date = new Date()): Promise<number> {
  const updated = await runnableHeartbeatQuery(db, agentId, at.toISOString());
  return typeof updated === 'number' ? updated : 0;
}

/**
 * Checks the org-wide global kill switch first (a single flag, independent
 * of any one agent's own status), then the agent's own per-agent status.
 * `organization` is whatever tenantMiddleware/dashboardAuthMiddleware
 * already attached to the request - no extra query needed here.
 */
export function assertAgentRunnable(
  agent: Record<string, unknown>,
  organization?: Record<string, unknown> | null,
): void {
  if (organization?.global_kill_active) {
    throw new AgentGuardError(
      403,
      'global_kill_switch',
      'Organization-wide kill switch is active. All agents are blocked until an operator resumes it.',
      {
        agent_id: agent.id,
        kill_switch_active: true,
        scope: 'global',
        reason: organization.global_kill_reason ?? null,
      },
    );
  }

  const status = String(agent.status ?? '');
  if (isKillSwitchActive(status)) {
    throw new AgentGuardError(
      403,
      'kill_switch',
      'Agent is suspended. Tool and prompt processing are blocked until an operator resumes it.',
      {
        agent_id: agent.id,
        status,
        kill_switch_active: true,
        scope: 'agent',
        reason: agent.suspension_reason ?? null,
        source: agent.kill_source ?? null,
      },
    );
  }
}
