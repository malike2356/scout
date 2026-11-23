// The only database access point in this service. decide.ts, resolve-binding.ts
// and json-pointer.ts import nothing from this file - that is what makes
// "zero database round trips during evaluation" a structural fact the
// latency test can assert by counting, not merely a claim.

import pg from "pg";

let queryCount = 0;

export function createInstrumentedPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString });
  const originalQuery = pool.query.bind(pool);
  // @ts-expect-error - intentionally wrapping the overloaded query method for
  // a single counter; callers only ever use the (text, params) form here.
  pool.query = (...args: unknown[]) => {
    queryCount += 1;
    // @ts-expect-error - see above
    return originalQuery(...args);
  };
  return pool;
}

export function getQueryCount(): number {
  return queryCount;
}

export function resetQueryCount(): void {
  queryCount = 0;
}
