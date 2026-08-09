// scout-engine/src/event-server/migrations.ts
// Idempotent schema migrations for the event ingestion server.
// Safe to run on every server start. Uses IF NOT EXISTS throughout.
// Tables: security_events, alert_rules, alert_history, kill_switch_state
import type pg from 'pg';

export async function runMigrations(client: pg.PoolClient): Promise<void> {
  // security_events; the primary event table for all Carina tool calls and security events
  await client.query(`
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

  // alert_rules; defines conditions that trigger alerts
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      trigger JSONB NOT NULL,
      channels TEXT[] NOT NULL DEFAULT '{}',
      config JSONB DEFAULT '{}',
      enabled BOOLEAN DEFAULT TRUE,
      cooldown_minutes INTEGER DEFAULT 60,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // alert_history; log of all alert deliveries
  await client.query(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
      event_id UUID REFERENCES security_events(id) ON DELETE SET NULL,
      channel TEXT NOT NULL,
      delivered BOOLEAN DEFAULT FALSE,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // kill_switch_state; tracks suspension state per Carina instance
  await client.query(`
    CREATE TABLE IF NOT EXISTS kill_switch_state (
      instance_id TEXT PRIMARY KEY,
      suspended BOOLEAN DEFAULT FALSE,
      suspended_at TIMESTAMPTZ,
      suspended_by TEXT,
      reason TEXT,
      reactivated_at TIMESTAMPTZ,
      reactivated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Indexes (all IF NOT EXISTS)
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_sevents_created_at
      ON security_events (created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_sevents_severity
      ON security_events (severity)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_sevents_instance_id
      ON security_events (instance_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_sevents_event_type
      ON security_events (event_type)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
      ON alert_rules (enabled)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_alert_history_created_at
      ON alert_history (created_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_kill_switch_suspended
      ON kill_switch_state (suspended) WHERE suspended = TRUE
  `);

  console.log('[scout:migrations] Schema ready (security_events, alert_rules, alert_history, kill_switch_state)');
}
