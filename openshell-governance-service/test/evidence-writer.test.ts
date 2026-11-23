// Real tests against the shared dev Postgres (scout-governance-postgres) -
// no mocks. Covers prompt 05's own acceptance criteria: the decision path
// performs zero writes, a full queue dead-letters observably, an
// incomplete record is refused and counted (never silently dropped), the
// privacy guarantee holds end to end through a real write, and a sustained
// run of 1,000 decisions loses none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createInstrumentedPool, getQueryCount, resetQueryCount } from "../src/policy/db.js";
import { EvidenceWriter } from "../src/evidence/writer.js";
import type { DecisionContext, DecisionForEvidence } from "../src/evidence/types.js";

const TEST_DATABASE_URL =
  process.env.SCOUT_TEST_POLICY_DATABASE_URL ??
  "postgres://scout:scout-governance-dev-only@127.0.0.1:54320/scout_governance";

function baseDecision(overrides: Partial<DecisionForEvidence> = {}): DecisionForEvidence {
  return {
    verdict: "allow",
    policySlug: "evidence-writer-test",
    policyVersion: 1,
    policyDigest: `digest-${Math.random().toString(36).slice(2)}`,
    reason: "test decision",
    authorityKind: "owner",
    authorityRef: "evidence-writer-test",
    ...overrides,
  };
}

function baseContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    occurredAt: new Date().toISOString(),
    layer: "control",
    rpc: "TestRpc",
    tenantId: "evidence-writer-test-tenant",
    evaluationMode: "cached_snapshot",
    ...overrides,
  };
}

async function countRows(pool: pg.Pool, table: string, where: string, params: unknown[]): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return result.rows[0].n;
}

test("record() performs zero database writes; drainOnce() is the only thing that writes", async () => {
  const instrumented = createInstrumentedPool(TEST_DATABASE_URL);
  const writer = new EvidenceWriter(instrumented, { serviceVersion: "test" });
  resetQueryCount();

  for (let i = 0; i < 50; i++) {
    writer.record(baseDecision(), baseContext());
  }
  assert.equal(getQueryCount(), 0, "record() must perform zero database queries");

  const written = await writer.drainOnce();
  assert.equal(written, 50);
  assert.ok(getQueryCount() > 0, "drainOnce() must be the thing that actually queries");

  await instrumented.end();
});

test("an incomplete record is refused and counted, never silently enqueued", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const writer = new EvidenceWriter(pool, { serviceVersion: "test" });

  // @ts-expect-error - deliberately constructing an invalid record to prove
  // the refusal path, not something real code paths can produce.
  writer.record(baseDecision({ authorityKind: "" }), baseContext());
  writer.record(baseDecision({ reason: "" }), baseContext());

  const statsAfterRefusals = writer.getStats();
  assert.equal(statsAfterRefusals.refusedIncompleteTotal, 2);
  assert.equal(statsAfterRefusals.queueDepth, 0, "a refused record must never reach the queue");

  await pool.end();
});

test("a full queue dead-letters the newest arrival observably, and it lands in decision_write_failure", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const writer = new EvidenceWriter(pool, { serviceVersion: "test", queueCapacity: 2 });

  writer.record(baseDecision(), baseContext());
  writer.record(baseDecision(), baseContext());
  writer.record(baseDecision(), baseContext()); // over capacity

  const stats = writer.getStats();
  assert.equal(stats.queueDepth, 2);
  assert.equal(stats.droppedDueToFullBufferTotal, 1);

  await writer.drainOnce(); // drains the 2 queued decisions + the 1 dead letter
  const statsAfterDrain = writer.getStats();
  assert.equal(statsAfterDrain.deadLetterTotal, 1);

  const deadLetterRows = await countRows(
    pool,
    "scout_governance.decision_write_failure",
    "error LIKE $1",
    ["%queue was full at enqueue time%"],
  );
  assert.ok(deadLetterRows >= 1, "the dropped record must be visible in decision_write_failure");

  await pool.end();
});

test("the privacy guarantee holds end to end: a sentinel credential VALUE never reaches any evidence column", async () => {
  // Drives this through evaluateHttpRequest() itself, not a hand-built
  // record - a real sentinel bearer token flows in on the Authorization
  // header exactly as a sandboxed workload's outbound call would carry it,
  // and this proves the chain from "secret arrives at PRE_CREDENTIALS" to
  // "decision gets evidence-written" never lets the value through.
  const { evaluateHttpRequest } = await import("../src/middleware/evaluate.js");
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const writer = new EvidenceWriter(pool, { serviceVersion: "test" });
  const SENTINEL_TOKEN = `sk-SCOUT-EVIDENCE-PRIVACY-SENTINEL-${Math.random().toString(36).slice(2)}`;
  const correlationId = `corr-privacy-${Math.random().toString(36).slice(2)}`;

  const decision = evaluateHttpRequest(
    {
      subject: { tenantId: "evidence-writer-test-tenant" },
      method: "GET",
      url: "https://example.invalid/ok",
      // The real production bug class this guards against: OpenShell's
      // omission guarantee failing and a credential header reaching this
      // service anyway. assertNoCredentialHeaders() must deny this and
      // must never echo the value back in `reason`.
      headers: { authorization: `Bearer ${SENTINEL_TOKEN}` },
      bodySizeBytes: 0,
      correlationId,
    },
    { loadedAt: new Date().toISOString(), policiesById: new Map(), bindings: [] },
    1_048_576,
  );
  assert.equal(decision.verdict, "deny");
  assert.ok(!decision.reason.includes(SENTINEL_TOKEN), "the in-memory decision itself must not carry the sentinel");

  writer.record(
    {
      verdict: decision.verdict,
      policySlug: decision.policySlug ?? "none",
      policyVersion: decision.policyVersion,
      policyDigest: decision.policyDigest,
      ruleId: decision.ruleId,
      reason: decision.reason,
      residualRisk: decision.residualRisk,
      authorityKind: decision.authorityKind,
      authorityRef: decision.authorityRef,
    },
    baseContext({ layer: "data", rpc: "HttpRequest", correlationId }),
  );
  await writer.drainOnce();

  for (const table of [
    "scout_governance.boundary_decision",
    "scout_governance.policy_provenance",
    "scout_governance.decision_write_failure",
  ]) {
    const result = await pool.query(`SELECT * FROM ${table}`);
    assert.ok(
      !JSON.stringify(result.rows).includes(SENTINEL_TOKEN),
      `sentinel must not appear anywhere in ${table}`,
    );
  }

  const decisionRow = await pool.query(
    `SELECT reason FROM scout_governance.boundary_decision WHERE correlation_id = $1`,
    [correlationId],
  );
  assert.equal(decisionRow.rows.length, 1);
  assert.ok(
    decisionRow.rows[0].reason.includes("authorization"),
    "the reason must still name which header violated the contract",
  );

  await pool.end();
});

test("1,000 decisions over sustained drain lose none; drain lag is measured and reported", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const writer = new EvidenceWriter(pool, { serviceVersion: "test" });
  const marker = `load-test-${Math.random().toString(36).slice(2)}`;
  const COUNT = 1_000;

  for (let i = 0; i < COUNT; i++) {
    writer.record(
      baseDecision({ policySlug: marker, policyDigest: `${marker}-digest` }),
      baseContext({ correlationId: `${marker}-${i}` }),
    );
  }

  let drained = 0;
  while (drained < COUNT) {
    drained += await writer.drainOnce(500);
  }

  const stats = writer.getStats();
  console.log(JSON.stringify({ drain_lag_ms: stats.drainLagMs, decisions_written_total: stats.decisionsWrittenTotal }));
  assert.ok(stats.drainLagMs !== null, "drain lag must be measured and reported");

  const rowCount = await countRows(pool, "scout_governance.boundary_decision", "policy_slug = $1", [marker]);
  assert.equal(rowCount, COUNT, "every one of the 1,000 decisions must have landed with no losses");

  await pool.end();
});

test("every decision citing a real policy resolves to a policy_provenance entry; a default decision does not need one", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const writer = new EvidenceWriter(pool, { serviceVersion: "test" });
  const digest = `digest-provenance-${Math.random().toString(36).slice(2)}`;

  writer.record(
    baseDecision({ policyDigest: digest, authorityKind: "owner", authorityRef: "owner-ref" }),
    baseContext(),
  );
  writer.record(
    baseDecision({ policyDigest: "none", authorityKind: "default", authorityRef: undefined }),
    baseContext(),
  );
  await writer.drainOnce();

  const provenanceRows = await countRows(
    pool,
    "scout_governance.policy_provenance",
    "policy_digest = $1",
    [digest],
  );
  assert.ok(provenanceRows > 0, "a signed/owner decision's digest must resolve to a provenance entry");

  // The acceptance criterion's other half: a 'default' decision is exempt
  // (there is no real policy to attach provenance to), so the absence of a
  // row for a digest of 'none' is correct, not a defect.
  const noneRows = await countRows(pool, "scout_governance.policy_provenance", "policy_digest = $1", ["none"]);
  assert.equal(noneRows, 0, "'none'/'default' decisions must not fabricate a provenance entry");

  await pool.end();
});

test("recordSupersession adds a 'superseded' event to a digest's provenance chain, exactly once", async () => {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const writer = new EvidenceWriter(pool, { serviceVersion: "test" });
  const digest = `digest-superseded-${Math.random().toString(36).slice(2)}`;

  writer.record(baseDecision({ policyDigest: digest, authorityKind: "owner", authorityRef: "owner-ref" }), baseContext());
  await writer.drainOnce();

  await writer.recordSupersession(digest);
  await writer.recordSupersession(digest); // must not duplicate

  const result = await pool.query(
    `SELECT event FROM scout_governance.policy_provenance WHERE policy_digest = $1 ORDER BY occurred_at ASC`,
    [digest],
  );
  const events = result.rows.map((r) => r.event);
  assert.deepEqual(events, ["authored", "activated", "superseded"]);

  await pool.end();
});

test("boundary_decision has no UPDATE or DELETE path anywhere in the codebase", () => {
  const srcDir = join(import.meta.dirname, "../src");
  const offenders: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "gen") continue; // generated protobuf code, not hand-written SQL
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        const content = readFileSync(full, "utf8");
        if (/UPDATE\s+scout_governance\.boundary_decision/i.test(content)) offenders.push(`${full}: UPDATE`);
        if (/DELETE\s+FROM\s+scout_governance\.boundary_decision/i.test(content)) offenders.push(`${full}: DELETE`);
      }
    }
  }
  walk(srcDir);

  assert.deepEqual(offenders, [], "no source file may UPDATE or DELETE boundary_decision rows");
});
