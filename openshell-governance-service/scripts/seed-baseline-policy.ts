// Dev/test tooling: inserts one real policy document and a global binding
// for it. Not run automatically - invoke explicitly:
//   node --experimental-strip-types scripts/seed-baseline-policy.ts
// or after build: node dist/scripts/seed-baseline-policy.js

import pg from "pg";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../src/policy/canonical-json.js";

const document = {
  rules: [
    {
      id: "deny-forbidden-label",
      rpc: "CreateSandbox",
      when: { path: "/labels/scout-forbidden", op: "equals", value: "true" },
      verdict: "deny",
      reason: "label scout-forbidden=true is blocked by policy baseline-sandbox v1",
    },
  ],
  defaultVerdict: "allow",
  middlewareRules: [
    {
      id: "deny-internal-host",
      operation: "http_request",
      when: { path: "/url", op: "equals", value: "https://internal.example/secrets" },
      verdict: "deny",
      reason: "egress to internal.example is blocked by policy baseline-sandbox v1",
    },
    {
      id: "redact-x-trace-header",
      operation: "http_request",
      when: { path: "/headers/x-trace-sentinel", op: "exists" },
      verdict: "redact",
      reason: "x-trace-sentinel header redacted by policy baseline-sandbox v1",
      redaction: { header: ["x-trace-sentinel"] },
    },
  ],
  middlewareDefaultVerdict: "allow",
  patches: [
    {
      rpc: "CreateSandbox",
      op: "add",
      path: "/labels/scout-governed",
      value: "true",
    },
  ],
};

async function main(): Promise<void> {
  const databaseUrl = process.env.SCOUT_POLICY_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("SCOUT_POLICY_DATABASE_URL is required");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const digest = createHash("sha256").update(canonicalJsonStringify(document)).digest("hex");

  const policyResult = await pool.query<{ id: string }>(
    `INSERT INTO scout_policy (policy_slug, version, digest_sha256, document)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (policy_slug, version) DO UPDATE SET document = EXCLUDED.document, digest_sha256 = EXCLUDED.digest_sha256
     RETURNING id`,
    ["baseline-sandbox", 1, digest, JSON.stringify(document)],
  );
  const policyId = policyResult.rows[0]?.id;
  if (!policyId) {
    throw new Error("failed to insert baseline-sandbox policy");
  }

  await pool.query(
    `INSERT INTO scout_policy_binding (subject_kind, subject_key, policy_id, priority)
     VALUES ('global', '*', $1, 100)
     ON CONFLICT (subject_kind, subject_key) DO UPDATE SET policy_id = EXCLUDED.policy_id`,
    [policyId],
  );

  console.log(JSON.stringify({ policyId, digest, policySlug: "baseline-sandbox", version: 1 }));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
