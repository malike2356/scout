// scout-engine/src/api/public/v1/agent-guard.ts
// Shared helpers for public /v1 routes that must respect kill switch state.
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

export function assertAgentRunnable(agent: Record<string, unknown>): void {
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
      },
    );
  }
}
