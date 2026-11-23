// Real tests against the shared dev Postgres (scout-governance-postgres) -
// no mocks. Covers the LinkageWriter acceptance criteria that the live
// gRPC test (linkage-live.test.ts) does not reach directly: refusal on an
// unresolved sandbox id, policy-supersession closing, overlapping-grant
// attribution, unattributed-observation counting, and the privacy
// extension to grant_observation.detail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { LinkageWriter } from "../src/linkage/writer.js";

const TEST_DATABASE_URL =
  process.env.SCOUT_TEST_POLICY_DATABASE_URL ??
  "postgres://scout:scout-governance-dev-only@127.0.0.1:54320/scout_governance";

async function countRows(pool: pg.Pool, table: string, where: string, params: unknown[]): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return result.rows[0].n;
}

test("opening a grant with no resolvable sandbox id is refused, counted, never enqueued", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const linkage = new LinkageWriter(pool);

  linkage.openGrant({
    decisionUid: randomUUID(),
    tenantId: "default",
    sandboxId: undefined,
    capability: "*",
    policyDigest: "digest-x",
    effectiveFrom: new Date().toISOString(),
  });

  const stats = linkage.getStats();
  assert.equal(stats.queueDepth, 0, "an unresolved-sandbox grant must never reach the queue");
  assert.equal(stats.grantOpenSkippedUnresolvedSandboxTotal, 1);

  await pool.end();
});

test("a decision opens exactly one grant; closing by superseded digest closes it within one drain cycle", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const linkage = new LinkageWriter(pool);
  const sandboxId = `sbx-${Math.random().toString(36).slice(2)}`;
  const digest = `digest-${Math.random().toString(36).slice(2)}`;
  const decisionUid = randomUUID();

  linkage.openGrant({
    decisionUid,
    tenantId: "default",
    sandboxId,
    capability: "*",
    policyDigest: digest,
    effectiveFrom: new Date(0).toISOString(),
  });
  await linkage.drainOnce();

  const openCount = await countRows(
    pool,
    "scout_governance.boundary_grant",
    "decision_uid = $1 AND effective_to IS NULL",
    [decisionUid],
  );
  assert.equal(openCount, 1, "exactly one open grant must exist for this decision");

  linkage.closeGrantsForSupersededDigest(digest, new Date().toISOString());
  await linkage.drainOnce();

  const closedResult = await pool.query(
    `SELECT effective_to, closed_reason FROM scout_governance.boundary_grant WHERE decision_uid = $1`,
    [decisionUid],
  );
  assert.equal(closedResult.rows.length, 1);
  assert.notEqual(closedResult.rows[0].effective_to, null);
  assert.equal(closedResult.rows[0].closed_reason, "policy_superseded");

  await pool.end();
});

test("an observation with no open grant for its sandbox is counted unattributed, never inserted", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const linkage = new LinkageWriter(pool);
  const sandboxId = `sbx-orphan-${Math.random().toString(36).slice(2)}`;
  const host = `orphan-${Math.random().toString(36).slice(2)}.example.invalid`;

  linkage.recordObservation({
    sandboxId,
    observedAt: new Date().toISOString(),
    capability: "*",
    kind: "outbound_call",
    destinationHost: host,
    outcome: "denied",
  });
  await linkage.drainOnce();

  assert.equal(linkage.getStats().observationsUnattributedTotal, 1);
  const rows = await countRows(pool, "scout_governance.grant_observation", "destination_host = $1", [host]);
  assert.equal(rows, 0, "an unattributed observation must never land in grant_observation");

  await pool.end();
});

test("one observation attributes to both of two overlapping grants for the same sandbox", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const linkage = new LinkageWriter(pool);
  const sandboxId = `sbx-overlap-${Math.random().toString(36).slice(2)}`;
  const host = `overlap-${Math.random().toString(36).slice(2)}.example`;
  const observedAt = "2026-06-01T12:00:00.000Z";

  linkage.openGrant({
    decisionUid: randomUUID(),
    tenantId: "default",
    sandboxId,
    capability: "*",
    policyDigest: "digest-a",
    effectiveFrom: "2026-06-01T00:00:00.000Z",
  });
  linkage.openGrant({
    decisionUid: randomUUID(),
    tenantId: "default",
    sandboxId,
    capability: "*",
    policyDigest: "digest-b",
    effectiveFrom: "2026-06-01T06:00:00.000Z",
  });
  await linkage.drainOnce();

  linkage.recordObservation({
    sandboxId,
    observedAt,
    capability: "*",
    kind: "outbound_call",
    destinationHost: host,
    outcome: "succeeded",
  });
  await linkage.drainOnce();

  const rows = await countRows(pool, "scout_governance.grant_observation", "destination_host = $1", [host]);
  assert.equal(rows, 2, "the same observation must land once per attributing grant, not be deduplicated to one");

  await pool.end();
});

test("the privacy guarantee extends to grant_observation.detail: a sentinel credential VALUE never reaches it", async () => {
  const { evaluateHttpRequest } = await import("../src/middleware/evaluate.js");
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const linkage = new LinkageWriter(pool);
  const sandboxId = `sbx-privacy-${Math.random().toString(36).slice(2)}`;
  const SENTINEL_TOKEN = `sk-SCOUT-LINKAGE-PRIVACY-SENTINEL-${Math.random().toString(36).slice(2)}`;

  linkage.openGrant({
    decisionUid: randomUUID(),
    tenantId: "default",
    sandboxId,
    capability: "*",
    policyDigest: "digest-privacy",
    effectiveFrom: new Date(0).toISOString(),
  });
  await linkage.drainOnce();

  const decision = evaluateHttpRequest(
    {
      subject: { tenantId: "default", sandboxId },
      method: "GET",
      url: "https://example.invalid/ok",
      headers: { authorization: `Bearer ${SENTINEL_TOKEN}` },
      bodySizeBytes: 0,
      correlationId: "privacy-test",
    },
    { loadedAt: new Date().toISOString(), policiesById: new Map(), bindings: [] },
    1_048_576,
  );
  assert.equal(decision.verdict, "deny");

  linkage.recordObservation({
    sandboxId,
    observedAt: new Date().toISOString(),
    capability: "*",
    kind: "outbound_call",
    destinationHost: "example.invalid",
    outcome: "denied",
    detail: { method: "GET" },
  });
  await linkage.drainOnce();

  for (const table of ["scout_governance.boundary_grant", "scout_governance.grant_observation"]) {
    const result = await pool.query(`SELECT * FROM ${table}`);
    assert.ok(
      !JSON.stringify(result.rows).includes(SENTINEL_TOKEN),
      `sentinel must not appear anywhere in ${table}`,
    );
  }

  await pool.end();
});
