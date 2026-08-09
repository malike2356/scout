// scout-engine/src/secret-scanning/health.ts
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';

function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../db/migrations'),
    join(here, '../../src/db/migrations'),
    join(process.cwd(), 'src/db/migrations'),
    join(process.cwd(), 'dist/db/migrations'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

export async function getSecretScanHealth(): Promise<Record<string, unknown>> {
  const migrationsDir = resolveMigrationsDir();
  const migrationFiles = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((name) => name.endsWith('.sql'))
        .sort()
    : [];

  let tablesOk = false;
  try {
    await db('repo_connectors').limit(1);
    await db('repo_secret_scan_runs').limit(1);
    tablesOk = true;
  } catch {
    tablesOk = false;
  }

  const lastIngest = tablesOk
    ? await db('repo_secret_ingestion_receipts').orderBy('created_at', 'desc').first()
    : null;
  const lastSuccess = tablesOk
    ? await db('repo_secret_scan_runs')
        .whereNot({ status: 'failed' })
        .orderBy('observed_at', 'desc')
        .first()
    : null;
  const recentAlerts = tablesOk
    ? await db('alert_history')
        .where('created_at', '>=', db.raw("NOW() - INTERVAL '24 hours'"))
        .count('* as count')
        .first()
    : null;

  const lastIngestAt = lastIngest?.created_at
    ? new Date(String(lastIngest.created_at)).getTime()
    : null;
  const ingestFresh =
    lastIngestAt == null ? 'unknown' : Date.now() - lastIngestAt < 7 * 24 * 60 * 60 * 1000;

  return {
    migrations_present: migrationFiles.includes('011-repository-secret-scanning.sql'),
    migrations_count: migrationFiles.length,
    tables_ready: tablesOk,
    last_ingest_at: lastIngest?.created_at ?? null,
    last_successful_scan_at: lastSuccess?.observed_at ?? null,
    ingest_fresh_within_7d: ingestFresh,
    alerts_delivered_24h: parseInt(String(recentAlerts?.count ?? 0), 10),
    // Workstation spool freshness is local-only; Scout reports server-side receipts.
    spool_note: 'local_workstation_spool_not_visible_to_scout',
  };
}
