// scout-engine/src/event-server/db.ts
// PostgreSQL connection pool and migration runner for the event ingestion server.
import pg from 'pg';
import { serverConfig } from './config.js';
import { runMigrations } from './migrations.js';

export const pool = new pg.Pool({
  connectionString: serverConfig.db.url,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err: Error) => {
  console.error('[scout:db] Unexpected pool error:', err.message);
});

let migrated = false;

export async function initDb(): Promise<void> {
  if (migrated) return;
  const client = await pool.connect();
  try {
    await runMigrations(client);
    migrated = true;
  } finally {
    client.release();
  }
}
