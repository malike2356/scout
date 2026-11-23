import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentGuardError, assertAgentRunnable, isKillSwitchActive, loadOrgAgent } from './agent-guard.js';

describe('agent-guard', () => {
  it('isKillSwitchActive recognizes suspended and the vestigial killed status', () => {
    assert.equal(isKillSwitchActive('suspended'), true);
    assert.equal(isKillSwitchActive('killed'), true);
    assert.equal(isKillSwitchActive('online'), false);
    assert.equal(isKillSwitchActive('offline'), false);
    assert.equal(isKillSwitchActive(undefined), false);
  });

  it('assertAgentRunnable allows a runnable agent with no org kill flags', () => {
    assert.doesNotThrow(() => assertAgentRunnable({ id: 'a1', status: 'online' }, { global_kill_active: false }));
  });

  it('assertAgentRunnable throws kill_switch for a suspended agent', () => {
    try {
      assertAgentRunnable(
        { id: 'a1', status: 'suspended', suspension_reason: 'manual stop', kill_source: 'manual' },
        { global_kill_active: false },
      );
      assert.fail('expected to throw');
    } catch (err) {
      assert.ok(err instanceof AgentGuardError);
      assert.equal(err.status, 403);
      assert.equal(err.code, 'kill_switch');
      assert.equal(err.payload.scope, 'agent');
      assert.equal(err.payload.reason, 'manual stop');
    }
  });

  it('assertAgentRunnable throws global_kill_switch before checking per-agent status', () => {
    try {
      // Agent itself is perfectly healthy ("online") - the org-wide flag alone should still block it.
      assertAgentRunnable(
        { id: 'a1', status: 'online' },
        { global_kill_active: true, global_kill_reason: 'incident drill' },
      );
      assert.fail('expected to throw');
    } catch (err) {
      assert.ok(err instanceof AgentGuardError);
      assert.equal(err.code, 'global_kill_switch');
      assert.equal(err.payload.scope, 'global');
      assert.equal(err.payload.reason, 'incident drill');
    }
  });

  it('assertAgentRunnable with no organization argument falls back to per-agent check only', () => {
    assert.doesNotThrow(() => assertAgentRunnable({ id: 'a1', status: 'online' }));
    assert.throws(() => assertAgentRunnable({ id: 'a1', status: 'suspended' }), AgentGuardError);
  });

  it('loadOrgAgent is exported for route use (smoke import check)', () => {
    assert.equal(typeof loadOrgAgent, 'function');
  });
});
