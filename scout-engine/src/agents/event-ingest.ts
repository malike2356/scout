// scout-engine/src/agents/event-ingest.ts
// Agent event ingestion; receives tool events from connected agents
import { db } from '../db/index.js';
import { detectSuspicious } from './suspicious-detector.js';

export interface AgentEvent {
  agentId: string;
  agentType: string;
  workspaceId: string;
  eventType: 'tool_start' | 'tool_complete' | 'tool_error' | 'approval_request' | 'approval_granted' | 'approval_denied' | 'session_start' | 'session_end';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  duration?: number;
  sessionId?: string;
  timestamp: string;
}

export async function ingestAgentEvent(event: AgentEvent): Promise<{ stored: boolean; suspicious: boolean; findings: string[] }> {
  // Verify agent exists and is active
  const agent = await db('connected_agents')
    .where({ id: event.agentId, workspace_id: event.workspaceId })
    .first();

  if (!agent) {
    throw new Error('Agent not found');
  }

  if (agent.status === 'suspended') {
    throw new Error('Agent is suspended');
  }

  // Update heartbeat
  await db('connected_agents').where({ id: event.agentId }).update({
    last_heartbeat: new Date().toISOString(),
    status: 'online',
  });

  // Store event
  await db('agent_events').insert({
    agent_id: event.agentId,
    workspace_id: event.workspaceId,
    organization_id: agent.organization_id ?? null,
    event_type: event.eventType,
    tool_name: event.toolName || null,
    tool_args: event.toolArgs ? JSON.stringify(event.toolArgs) : null,
    tool_result: event.toolResult ? JSON.stringify(event.toolResult) : null,
    duration_ms: event.duration || null,
    session_id: event.sessionId || null,
    occurred_at: event.timestamp || new Date().toISOString(),
  });

  // Detect suspicious activity
  const suspiciousResult = await detectSuspicious(event);

  return {
    stored: true,
    suspicious: suspiciousResult.isSuspicious,
    findings: suspiciousResult.findings,
  };
}

export async function registerAgent(
  workspaceId: string,
  name: string,
  agentType: string,
  apiKey: string,
  organizationId?: string | null,
): Promise<string> {
  const crypto = await import('crypto');
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const [agent] = await db('connected_agents')
    .insert({
      workspace_id: workspaceId,
      organization_id: organizationId ?? null,
      agent_type: agentType,
      name,
      api_key_hash: apiKeyHash,
      status: 'offline',
    })
    .returning('id');

  return agent.id;
}
