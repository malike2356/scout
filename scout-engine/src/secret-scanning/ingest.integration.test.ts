// scout-engine/src/secret-scanning/ingest.integration.test.ts
// Opt-in DB integration tests. Set SCOUT_SECRET_SCAN_IT=1 and a reachable DATABASE_URL.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SECRET_SCAN_SCHEMA_VERSION } from './constants.js';
import { ingestSecretScan } from './ingest.js';
import { getAggregatePosture, listFindings, transitionRemediation } from './service.js';
import { buildSignedIngestPayload } from './signature.js';
import { disconnect, getDb } from '../db/index.js';

const enabled = process.env.SCOUT_SECRET_SCAN_IT === '1';
const apiKeyA = 'sk_live_tenant_a_' + crypto.randomBytes(8).toString('hex');
const apiKeyB = 'sk_live_tenant_b_' + crypto.randomBytes(8).toString('hex');

const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const wsA = crypto.randomUUID();
const wsB = crypto.randomUUID();

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
}

async function seedTenants(): Promise<void> {
  const db = getDb();
  await db('organizations')
    .insert([
      {
        id: orgA,
        name: 'Secret Scan Org A',
        slug: `ss-a-${orgA.slice(0, 8)}`,
        plan: 'free',
        subscription_status: 'inactive',
      },
      {
        id: orgB,
        name: 'Secret Scan Org B',
        slug: `ss-b-${orgB.slice(0, 8)}`,
        plan: 'free',
        subscription_status: 'inactive',
      },
    ])
    .onConflict('id')
    .ignore();

  await db('workspaces')
    .insert([
      { id: wsA, name: 'WS A', active: true, organization_id: orgA },
      { id: wsB, name: 'WS B', active: true, organization_id: orgB },
    ])
    .onConflict('id')
    .ignore();
}

function fixture(apiKey: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const unsigned = {
    schema_version: SECRET_SCAN_SCHEMA_VERSION,
    connector_key: 'repo-demo',
    repository_alias: 'demo-repo',
    scan_id: 'scan_' + crypto.randomBytes(6).toString('hex'),
    mode: 'current' as const,
    scanner_name: 'verlox-secrets',
    scanner_version: '1.0.0',
    started_at: now,
    completed_at: now,
    observed_at: now,
    status: 'completed' as const,
    counts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
    findings: [
      {
        rule_id: 'generic-api-key',
        severity: 'critical' as const,
        relative_path: 'src/config.ts',
        line: 10,
        fingerprint: crypto.createHash('sha256').update('demo-finding').digest('hex').slice(0, 40),
      },
    ],
    idempotency_key: 'idem_' + crypto.randomBytes(16).toString('hex'),
    ...overrides,
  };
  return buildSignedIngestPayload(apiKey, unsigned as any);
}

describe('secret-scan ingest integration', { skip: !enabled }, () => {
  before(async () => {
    await runMigrations();
    await seedTenants();
  });

  after(async () => {
    const db = getDb();
    await db('repo_secret_remediation_events').whereIn('organization_id', [orgA, orgB]).del();
    await db('repo_secret_findings').whereIn('organization_id', [orgA, orgB]).del();
    await db('repo_secret_scan_runs').whereIn('organization_id', [orgA, orgB]).del();
    await db('repo_secret_ingestion_receipts').whereIn('organization_id', [orgA, orgB]).del();
    await db('repo_connectors').whereIn('organization_id', [orgA, orgB]).del();
    await db('findings').whereIn('organization_id', [orgA, orgB]).del();
    await disconnect();
  });

  it('ingests a redacted fixture and deduplicates replay', async () => {
    const payload = fixture(apiKeyA);
    const first = await ingestSecretScan(
      {
        organizationId: orgA,
        workspaceId: wsA,
        apiKey: apiKeyA,
        correlationId: 'ssc_test_1',
        requestByteLength: Buffer.byteLength(JSON.stringify(payload)),
      },
      payload,
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.status, 201);
    assert.equal(first.findingsAccepted, 1);

    const second = await ingestSecretScan(
      {
        organizationId: orgA,
        workspaceId: wsA,
        apiKey: apiKeyA,
        correlationId: 'ssc_test_2',
        requestByteLength: Buffer.byteLength(JSON.stringify(payload)),
      },
      payload,
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.duplicate, true);
    assert.equal(second.scanRunId, first.scanRunId);
  });

  it('rejects adversarial secret-like fields', async () => {
    const payload = fixture(apiKeyA, {
      secret: 'sk_live_leak',
    });
    const result = await ingestSecretScan(
      {
        organizationId: orgA,
        workspaceId: wsA,
        apiKey: apiKeyA,
        correlationId: 'ssc_test_3',
        requestByteLength: 100,
      },
      payload,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'forbidden_field');
  });

  it('prevents cross-tenant reads of findings and posture', async () => {
    const payload = fixture(apiKeyA, {
      connector_key: 'repo-tenant-a-only',
      idempotency_key: 'idem_' + crypto.randomBytes(16).toString('hex'),
      scan_id: 'scan_iso_' + crypto.randomBytes(4).toString('hex'),
      findings: [
        {
          rule_id: 'iso-rule',
          severity: 'high',
          relative_path: 'a.ts',
          fingerprint: crypto.createHash('sha256').update('iso').digest('hex').slice(0, 40),
        },
      ],
      counts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    });
    const ingest = await ingestSecretScan(
      {
        organizationId: orgA,
        workspaceId: wsA,
        apiKey: apiKeyA,
        correlationId: 'ssc_test_4',
        requestByteLength: Buffer.byteLength(JSON.stringify(payload)),
      },
      payload,
    );
    assert.equal(ingest.ok, true);

    const aFindings = await listFindings(
      { organizationId: orgA, workspaceId: wsA },
      { limit: 50, offset: 0 },
    );
    const bFindings = await listFindings(
      { organizationId: orgB, workspaceId: wsB },
      { limit: 50, offset: 0 },
    );
    assert.ok(aFindings.total >= 1);
    assert.equal(bFindings.total, 0);

    const aPosture = await getAggregatePosture({ organizationId: orgA, workspaceId: wsA });
    const bPosture = await getAggregatePosture({ organizationId: orgB, workspaceId: wsB });
    assert.ok(aPosture.open_findings.open_total >= 1);
    assert.equal(bPosture.open_findings.open_total, 0);
    assert.equal(aPosture.schema_version, '1.0.0');
  });

  it('records remediation transitions with audit', async () => {
    const listed = await listFindings(
      { organizationId: orgA, workspaceId: wsA },
      { limit: 1, offset: 0, status: 'open' },
    );
    assert.ok(listed.findings[0]);
    const transition = await transitionRemediation({
      scope: { organizationId: orgA, workspaceId: wsA },
      findingId: listed.findings[0].id as string,
      toStatus: 'acknowledged',
      actor: 'tester@example.com',
      reason: 'triaged in IT',
      correlationId: 'ssc_test_5',
    });
    assert.equal(transition.ok, true);
  });
});
