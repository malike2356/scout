// The operator HTTP surface for the evidence store (prompt 05, plus
// /evidence/policies added for prompt 08's policy provenance page):
//   GET /evidence/decisions         - filter by tenant, window, verdict, subject, rpc. Paged.
//   GET /evidence/decisions/:uid    - one decision plus its policy's full provenance chain
//   GET /evidence/policies          - every digest's full authored/signed-activated-superseded chain
//   GET /evidence/health            - queue depth, drain lag, dead-letter count, write-failure count
//   GET /evidence/export            - NDJSON export for an auditor, filtered by from/to/tenant
//
// All four are read-only queries against scout_governance.* - no row here
// is ever on a decision path. Per the prompt's own rule, these routes must
// never surface a raw body, header value, or full URL (with a query
// string) - the schema already never stores them, so there is nothing to
// hold back here beyond what the writer already chose not to capture.

import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type pg from "pg";
import type { EvidenceWriter } from "./writer.js";

const DECISION_UID_RE = /^\/evidence\/decisions\/([0-9a-fA-F-]{36})$/;

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseLimit(raw: string | null, fallback: number, max: number): number {
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseOffset(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

interface DecisionFilters {
  tenant?: string;
  verdict?: string;
  subject?: string;
  rpc?: string;
  from?: string;
  to?: string;
}

function buildFilterClause(filters: DecisionFilters, startIndex: number): { clause: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let i = startIndex;

  if (filters.tenant) {
    clauses.push(`tenant_id = $${i++}`);
    values.push(filters.tenant);
  }
  if (filters.verdict) {
    clauses.push(`verdict = $${i++}`);
    values.push(filters.verdict);
  }
  if (filters.subject) {
    clauses.push(`(subject_label = $${i} OR sandbox_id = $${i})`);
    values.push(filters.subject);
    i++;
  }
  if (filters.rpc) {
    clauses.push(`rpc = $${i++}`);
    values.push(filters.rpc);
  }
  if (filters.from) {
    clauses.push(`occurred_at >= $${i++}`);
    values.push(filters.from);
  }
  if (filters.to) {
    clauses.push(`occurred_at <= $${i++}`);
    values.push(filters.to);
  }

  return { clause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

async function handleDecisionsList(res: ServerResponse, pool: pg.Pool, url: URL): Promise<void> {
  const limit = parseLimit(url.searchParams.get("limit"), 50, 500);
  const offset = parseOffset(url.searchParams.get("offset"));
  const filters: DecisionFilters = {
    tenant: url.searchParams.get("tenant") ?? undefined,
    verdict: url.searchParams.get("verdict") ?? undefined,
    subject: url.searchParams.get("subject") ?? undefined,
    rpc: url.searchParams.get("rpc") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  const { clause, values } = buildFilterClause(filters, 1);

  const result = await pool.query(
    `SELECT decision_uid, correlation_id, occurred_at, layer, rpc, phase, tenant_id, workspace_id,
            sandbox_id, subject_label, verdict, rule_id, reason, policy_slug, policy_version,
            policy_digest, authority_kind, authority_ref, residual_risk, latency_us,
            evaluation_mode, service_version
     FROM scout_governance.boundary_decision
     ${clause}
     ORDER BY occurred_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );

  writeJson(res, 200, { decisions: result.rows, limit, offset });
}

async function handleDecisionDetail(res: ServerResponse, pool: pg.Pool, uid: string): Promise<void> {
  const decisionResult = await pool.query(
    `SELECT decision_uid, correlation_id, occurred_at, layer, rpc, phase, tenant_id, workspace_id,
            sandbox_id, subject_label, verdict, rule_id, reason, policy_slug, policy_version,
            policy_digest, authority_kind, authority_ref, residual_risk, latency_us,
            evaluation_mode, service_version
     FROM scout_governance.boundary_decision
     WHERE decision_uid = $1`,
    [uid],
  );
  const decision = decisionResult.rows[0];
  if (!decision) {
    writeJson(res, 404, { error: "no decision with that uid" });
    return;
  }

  const provenanceResult = await pool.query(
    `SELECT event, actor, actor_kind, signature_subject, note, occurred_at
     FROM scout_governance.policy_provenance
     WHERE policy_digest = $1
     ORDER BY occurred_at ASC`,
    [decision.policy_digest],
  );

  writeJson(res, 200, { decision, provenance: provenanceResult.rows });
}

interface PolicyProvenanceGroup {
  policyDigest: string;
  policySlug: string | null;
  version: number | null;
  events: Array<{
    event: string;
    actor: string;
    actor_kind: string;
    signature_subject: string | null;
    note: string | null;
    occurred_at: string;
  }>;
}

async function handlePoliciesList(res: ServerResponse, pool: pg.Pool): Promise<void> {
  // scout_policy lives in the default schema; policy_provenance's policy_id
  // is resolved against it at write time (see EvidenceWriter.ensureProvenanceFor),
  // so the join here is a plain cross-schema lookup within the same
  // database connection, not a second pool.
  const result = await pool.query<{
    policy_digest: string;
    policy_slug: string | null;
    version: number | null;
    event: string;
    actor: string;
    actor_kind: string;
    signature_subject: string | null;
    note: string | null;
    occurred_at: string;
  }>(
    `SELECT pp.policy_digest, sp.policy_slug, sp.version,
            pp.event, pp.actor, pp.actor_kind, pp.signature_subject, pp.note, pp.occurred_at
     FROM scout_governance.policy_provenance pp
     LEFT JOIN scout_policy sp ON sp.id = pp.policy_id
     ORDER BY pp.policy_digest, pp.occurred_at ASC`,
  );

  const byDigest = new Map<string, PolicyProvenanceGroup>();
  for (const row of result.rows) {
    let group = byDigest.get(row.policy_digest);
    if (!group) {
      group = { policyDigest: row.policy_digest, policySlug: row.policy_slug, version: row.version, events: [] };
      byDigest.set(row.policy_digest, group);
    }
    group.events.push({
      event: row.event,
      actor: row.actor,
      actor_kind: row.actor_kind,
      signature_subject: row.signature_subject,
      note: row.note,
      occurred_at: row.occurred_at,
    });
  }

  writeJson(res, 200, { policies: [...byDigest.values()] });
}

async function handleExport(res: ServerResponse, pool: pg.Pool, url: URL): Promise<void> {
  const filters: DecisionFilters = {
    tenant: url.searchParams.get("tenant") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  const { clause, values } = buildFilterClause(filters, 1);

  res.writeHead(200, { "content-type": "application/x-ndjson" });
  const client = await pool.connect();
  try {
    const cursorQuery = `SELECT decision_uid, occurred_at, layer, rpc, phase, tenant_id, workspace_id,
            sandbox_id, subject_label, verdict, rule_id, reason, policy_slug, policy_version,
            policy_digest, authority_kind, authority_ref, residual_risk, latency_us,
            evaluation_mode, service_version
     FROM scout_governance.boundary_decision
     ${clause}
     ORDER BY occurred_at ASC`;
    const result = await client.query(cursorQuery, values);
    for (const row of result.rows) {
      res.write(`${JSON.stringify(row)}\n`);
    }
  } finally {
    client.release();
  }
  res.end();
}

/** Returns true when this module handled the request (matched a route). */
export function handleEvidenceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  evidence: EvidenceWriter,
): boolean {
  if (req.method !== "GET" || !req.url) return false;
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/evidence/health") {
    writeJson(res, 200, evidence.getStats());
    return true;
  }

  if (url.pathname === "/evidence/decisions") {
    handleDecisionsList(res, evidence.getPool(), url).catch((error: unknown) => {
      writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
    });
    return true;
  }

  if (url.pathname === "/evidence/policies") {
    handlePoliciesList(res, evidence.getPool()).catch((error: unknown) => {
      writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
    });
    return true;
  }

  if (url.pathname === "/evidence/export") {
    handleExport(res, evidence.getPool(), url).catch((error: unknown) => {
      // Headers are likely already sent (NDJSON streams as it queries) -
      // best effort only; there is no clean way to retract a 200 here.
      if (!res.headersSent) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
      } else {
        res.end();
      }
    });
    return true;
  }

  const decisionMatch = DECISION_UID_RE.exec(url.pathname);
  if (decisionMatch) {
    handleDecisionDetail(res, evidence.getPool(), decisionMatch[1]).catch((error: unknown) => {
      writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
    });
    return true;
  }

  return false;
}
