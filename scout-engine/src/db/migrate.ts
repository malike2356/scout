// scout-engine/src/db/migrate.ts
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getDb, disconnect } from './index.js';

async function migrate(): Promise<void> {
  const db = getDb();
  const migrationsDir = join(import.meta.dirname || __dirname, 'migrations');

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} migrations...`);

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    console.log(`  Running migration: ${file}`);
    try {
      await db.raw(sql);
      console.log(`   ${file}`);
    } catch (err: any) {
      if (err.message?.includes('already exists') || err.message?.includes('duplicate')) {
        console.log(`  - ${file} (already applied)`);
      } else {
        console.error(`   ${file}: ${err.message}`);
        throw err;
      }
    }
  }

  console.log('Migrations complete.');
  await disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
