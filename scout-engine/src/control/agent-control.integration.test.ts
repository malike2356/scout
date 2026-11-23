// scout-engine/src/control/agent-control.integration.test.ts
// Opt-in DB integration tests. Set SCOUT_KILL_SWITCH_IT=1 and a reachable
// DATABASE_URL (see src/secret-scanning/ingest.integration.test.ts for the
// same pattern).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { disconnect, getDb } from '../db/index.js';
import {
  suspendAgent,
  resumeAgent,
  suspendAllAgentsForOrg,
  resumeAllAgentsForOrg,
  recordPromptFilterEventAndMaybeAutoKill,
  AgentControlError,
} from './agent-control.js';

const enabled = process.env.SCOUT_KILL_SWITCH_IT === '1';

const orgId = crypto.randomUUID();
const workspaceId = crypto.randomUUID();
let agentId: string;

async function runMigrations(): Promise<void> {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../db/migrations');
  const db = getDb();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    try {
      await db.raw(sql);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('already exists') && !message.includes('duplicate')) {
        throw err;
      }
    }
  }

  // security_events itself is normally created by event-server/migrations.ts
  // at server boot (a separate migration path from this file-based one, see
  // docs/architecture/KILL-SWITCH-AND-BLOCKCHAIN-IDENTITY.md); recordAudit()
  // writes to it, so this test DB needs it too.
  await db.raw(`
    CREATE TABLE IF NOT EXISTS security_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical','breach')),
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      ip_address TEXT,
      session_id TEXT,
      instance_id TEXT,
      mitigated BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

describe('agent-control (integration)', { skip: !enabled }, () => {
  before(async () => {
    await runMigrations();
    const db = getDb();
    await db('organizations')
      .insert({
        id: orgId,
        name: 'Agent Control Test Org',
        slug: `agent-control-${orgId.slice(0, 8)}`,
        plan: 'team', // kill switch feature regardless; irrelevant here since
        // these tests call agent-control.ts directly, bypassing requirePlanFeature.
        subscription_status: 'inactive',
      })
      .onConflict('id')
      .ignore();
    await db('workspaces')
      .insert({ id: workspaceId, name: 'WS', active: true, organization_id: orgId })
      .onConflict('id')
      .ignore();

    const [agent] = await db('connected_agents')
      .insert({
        organization_id: orgId,
        workspace_id: workspaceId,
        agent_type: 'generic',
        name: 'test-agent',
        api_key_hash: 'n/a',
        status: 'online',
      })
      .returning('*');
    agentId = agent.id;
  });

  after(async () => {
    await disconnect();
  });

  it('suspends an agent, persisting reason/source/timestamp and an audit row', async () => {
    const db = getDb();
    const { agent } = await suspendAgent({
      organizationId: orgId,
      agentId,
      reason: 'test suspension',
      source: 'manual',
      triggeredBy: 'test-suite',
    });

    assert.equal(agent.status, 'suspended');
    assert.equal(agent.suspension_reason, 'test suspension');
    assert.equal(agent.kill_source, 'manual');
    assert.ok(agent.suspended_at);

    const audit = await db('kill_switch_events')
      .where({ agent_id: agentId, action: 'kill' })
      .orderBy('created_at', 'desc')
      .first();
    assert.ok(audit, 'expected a kill_switch_events audit row');
    assert.equal(audit.scope, 'agent');
    assert.equal(audit.source, 'manual');

    const securityEvent = await db('security_events')
      .where({ instance_id: agentId, event_type: 'kill_switch_activated' })
      .orderBy('created_at', 'desc')
      .first();
    assert.ok(securityEvent, 'expected a security_events row for the kill (shared observability timeline)');
    assert.equal(securityEvent.severity, 'critical');
  });

  it('resumes an agent, clearing suspension fields and logging a resume audit row', async () => {
    const db = getDb();
    const { agent } = await resumeAgent({ organizationId: orgId, agentId, triggeredBy: 'test-suite' });

    assert.equal(agent.status, 'offline');
    assert.equal(agent.suspension_reason, null);
    assert.equal(agent.kill_source, null);

    const audit = await db('kill_switch_events')
      .where({ agent_id: agentId, action: 'resume' })
      .orderBy('created_at', 'desc')
      .first();
    assert.ok(audit);
  });

  it('throws AgentControlError(404) for an unknown agent', async () => {
    await assert.rejects(
      () =>
        suspendAgent({
          organizationId: orgId,
          agentId: crypto.randomUUID(),
          reason: 'x',
          source: 'manual',
        }),
      (err: unknown) => err instanceof AgentControlError && err.status === 404,
    );
  });

  it('global kill switch flips organizations.global_kill_active and back', async () => {
    const { organization: killed } = await suspendAllAgentsForOrg({
      organizationId: orgId,
      reason: 'incident drill',
      triggeredBy: 'test-suite',
    });
    assert.equal(killed.global_kill_active, true);
    assert.equal(killed.global_kill_reason, 'incident drill');

    const { organization: resumed } = await resumeAllAgentsForOrg({
      organizationId: orgId,
      triggeredBy: 'test-suite',
    });
    assert.equal(resumed.global_kill_active, false);
    assert.equal(resumed.global_kill_reason, null);
  });

  it('does not auto-kill below the threshold, and auto-kills once it is reached', async () => {
    const db = getDb();
    // Make sure the agent starts from a clean, non-suspended state.
    await db('connected_agents').where({ id: agentId }).update({ status: 'online', suspension_reason: null });

    const first = await recordPromptFilterEventAndMaybeAutoKill({
      organizationId: orgId,
      agentId,
      verdict: 'blocked',
      riskLevel: 'critical',
      autoKillThreshold: 2,
    });
    assert.equal(first, null, 'one critical block should not yet trigger auto-kill at threshold 2');

    const second = await recordPromptFilterEventAndMaybeAutoKill({
      organizationId: orgId,
      agentId,
      verdict: 'blocked',
      riskLevel: 'critical',
      autoKillThreshold: 2,
    });
    assert.ok(second, 'second critical block should trigger auto-kill at threshold 2');
    assert.equal(second!.agent.status, 'suspended');
    assert.equal(second!.agent.kill_source, 'policy');

    const audit = await db('kill_switch_events')
      .where({ agent_id: agentId, source: 'policy' })
      .first();
    assert.ok(audit, 'expected a policy-sourced kill_switch_events row');
  });

  it('never auto-kills when the threshold is null (disabled)', async () => {
    const db = getDb();
    await db('connected_agents').where({ id: agentId }).update({ status: 'online', suspension_reason: null });

    for (let i = 0; i < 5; i++) {
      const result = await recordPromptFilterEventAndMaybeAutoKill({
        organizationId: orgId,
        agentId,
        verdict: 'blocked',
        riskLevel: 'critical',
        autoKillThreshold: null,
      });
      assert.equal(result, null);
    }

    const agent = await db('connected_agents').where({ id: agentId }).first();
    assert.equal(agent.status, 'online');
  });
});
