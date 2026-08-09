import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPlanLimits, isPlanName, stripePriceIdForPlan, PLAN_LIMITS } from './plans.js';

describe('plans', () => {
  it('defines the four SoT-aligned plans with the right agent caps', () => {
    assert.equal(PLAN_LIMITS.free.agents, 1);
    assert.equal(PLAN_LIMITS.monitor.agents, 5);
    assert.equal(PLAN_LIMITS.govern.agents, 20);
    assert.equal(PLAN_LIMITS.team.agents, 50);
  });

  it('falls back to free limits for unknown or missing plans', () => {
    assert.deepEqual(getPlanLimits('nonexistent-plan'), PLAN_LIMITS.free);
    assert.deepEqual(getPlanLimits(undefined), PLAN_LIMITS.free);
    assert.deepEqual(getPlanLimits(null), PLAN_LIMITS.free);
  });

  it('recognizes only the four known plan names', () => {
    assert.equal(isPlanName('free'), true);
    assert.equal(isPlanName('monitor'), true);
    assert.equal(isPlanName('govern'), true);
    assert.equal(isPlanName('team'), true);
    assert.equal(isPlanName('enterprise'), false);
  });

  it('only enables killswitch and premium alerts on paid plans', () => {
    assert.equal(PLAN_LIMITS.free.killswitch, false);
    assert.equal(PLAN_LIMITS.monitor.killswitch, true);
    assert.equal(PLAN_LIMITS.free.premium_alerts, false);
    assert.equal(PLAN_LIMITS.govern.premium_alerts, true);
  });

  it('resolves Stripe price ids for paid plans from environment, never invents one', () => {
    const original = {
      monitor: process.env.STRIPE_MONITOR_PRICE_ID,
      govern: process.env.STRIPE_GOVERN_PRICE_ID,
      team: process.env.STRIPE_TEAM_PRICE_ID,
    };
    try {
      process.env.STRIPE_MONITOR_PRICE_ID = 'price_test_monitor';
      delete process.env.STRIPE_GOVERN_PRICE_ID;

      assert.equal(stripePriceIdForPlan('monitor'), 'price_test_monitor');
      assert.equal(stripePriceIdForPlan('govern'), null);
      assert.equal(stripePriceIdForPlan('free'), null);
    } finally {
      if (original.monitor === undefined) delete process.env.STRIPE_MONITOR_PRICE_ID;
      else process.env.STRIPE_MONITOR_PRICE_ID = original.monitor;
      if (original.govern === undefined) delete process.env.STRIPE_GOVERN_PRICE_ID;
      else process.env.STRIPE_GOVERN_PRICE_ID = original.govern;
      if (original.team === undefined) delete process.env.STRIPE_TEAM_PRICE_ID;
      else process.env.STRIPE_TEAM_PRICE_ID = original.team;
    }
  });
});
