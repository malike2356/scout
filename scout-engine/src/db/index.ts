// scout-engine/src/db/index.ts
import knex, { Knex } from 'knex';

let _db: Knex | null = null;

export function getDb(): Knex {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL || process.env.SCOUT_DATABASE_URL;
    _db = knex({
      client: 'pg',
      connection: connectionString || {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'carina',
        password: process.env.DB_PASSWORD || 'carina',
        database: process.env.DB_NAME || 'carina',
      },
      pool: { min: 2, max: 10 },
    });
  }
  return _db;
}

/**
 * db proxy: callable like db('table_name').where(...)
 * Uses apply trap for function calls and get trap for property access.
 */
export const db = new Proxy(function () {} as unknown as Knex, {
  get(_target, prop) {
    const instance = getDb();
    const val = (instance as any)[prop];
    // Bind functions to the knex instance
    if (typeof val === 'function') {
      return val.bind(instance);
    }
    return val;
  },
  apply(_target, _thisArg, args) {
    return (getDb() as any)(...args);
  },
});

export async function disconnect(): Promise<void> {
  if (_db) {
    await _db.destroy();
    _db = null;
  }
}
