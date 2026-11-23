// The operator HTTP surface for consequence linkage (prompt 06):
//   GET  /linkage/decisions/:uid/activity - forward: what happened under this decision
//   GET  /linkage/grants/:id               - one grant, its window, its observations, its close reason
//   POST /linkage/inverse                  - body: host, from, to, tenant? -> grants and permitting decisions
//   GET  /linkage/gaps                     - decisions with no grant, grants with zero observations
//   GET  /linkage/health                   - queue depth, drain lag, grant/observation counters
//
// All reads are indexed database queries, never "load everything and filter
// in the application" - the inverse query in particular joins through
// grant_observation's (destination_host, observed_at) index rather than
// scanning every observation.

import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type pg from "pg";
import type { LinkageWriter } from "./writer.js";

const GRANT_ID_RE = /^\/linkage\/grants\/(\d+)$/;
const REVOKE_RE = /^\/linkage\/grants\/(\d+)\/revoke$/;
const ACTIVITY_RE = /^\/linkage\/decisions\/([0-9a-fA-F-]{36})\/activity$/;

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // A bounded guard against an operator-surface caller sending an
      // unbounded body - this endpoint takes four short fields, not a feed.
      if (raw.length > 65_536) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (raw.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function handleActivity(res: ServerResponse, pool: pg.Pool, decisionUid: string): Promise<void> {
  const grants = await pool.query(
    `SELECT id, decision_uid, tenant_id, sandbox_id, capability, policy_digest,
            effective_from, effective_to, closed_reason
     FROM scout_governance.boundary_grant
     WHERE decision_uid = $1`,
    [decisionUid],
  );
  if (grants.rows.length === 0) {
    writeJson(res, 200, { decisionUid, grants: [], observations: [] });
    return;
  }

  const grantIds = grants.rows.map((g) => g.id);
  const observations = await pool.query(
    `SELECT grant_id, observed_at, kind, destination_host, outcome, byte_count, detail
     FROM scout_governance.grant_observation
     WHERE grant_id = ANY($1::bigint[])
     ORDER BY observed_at ASC`,
    [grantIds],
  );

  writeJson(res, 200, { decisionUid, grants: grants.rows, observations: observations.rows });
}

async function handleGrantDetail(res: ServerResponse, pool: pg.Pool, grantId: string): Promise<void> {
  const grantResult = await pool.query(
    `SELECT id, decision_uid, tenant_id, sandbox_id, capability, policy_digest,
            effective_from, effective_to, closed_reason
     FROM scout_governance.boundary_grant
     WHERE id = $1`,
    [grantId],
  );
  const grant = grantResult.rows[0];
  if (!grant) {
    writeJson(res, 404, { error: "no grant with that id" });
    return;
  }

  const observations = await pool.query(
    `SELECT observed_at, kind, destination_host, outcome, byte_count, detail
     FROM scout_governance.grant_observation
     WHERE grant_id = $1
     ORDER BY observed_at ASC`,
    [grantId],
  );

  writeJson(res, 200, { grant, observations: observations.rows });
}

async function handleGrantsList(res: ServerResponse, pool: pg.Pool, url: URL): Promise<void> {
  const openOnly = url.searchParams.get("open") === "true";
  const tenant = url.searchParams.get("tenant");
  const sandboxId = url.searchParams.get("sandboxId");
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const clauses: string[] = [];
  const values: unknown[] = [];
  if (openOnly) clauses.push("effective_to IS NULL");
  if (tenant) {
    values.push(tenant);
    clauses.push(`tenant_id = $${values.length}`);
  }
  if (sandboxId) {
    values.push(sandboxId);
    clauses.push(`sandbox_id = $${values.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT id, decision_uid, tenant_id, sandbox_id, capability, policy_digest,
            effective_from, effective_to, closed_reason
     FROM scout_governance.boundary_grant
     ${where}
     ORDER BY effective_from DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );

  writeJson(res, 200, { grants: result.rows, limit, offset });
}

interface RevokeBody {
  author?: string;
  note?: string;
}

async function handleRevoke(
  res: ServerResponse,
  linkage: LinkageWriter,
  req: IncomingMessage,
  grantId: string,
): Promise<void> {
  const body = (await readJsonBody(req)) as RevokeBody;
  if (!body.author || !body.note) {
    writeJson(res, 400, { error: "author and note are required" });
    return;
  }

  const result = await linkage.revokeGrant(grantId, body.author, body.note);
  if (!result.ok) {
    // Never report success for a revoke that did not actually happen -
    // this is the "not optimistic" guarantee the UI depends on.
    writeJson(res, 409, { ok: false, error: result.error });
    return;
  }
  writeJson(res, 200, {
    ok: true,
    grant: result.grant,
    // Deliberately explicit: this service has no gateway administrative
    // client. Closing the grant here does not, by itself, detach any live
    // capability at the platform - see LinkageWriter.revokeGrant's comment.
    liveCapabilityDetachAttempted: false,
  });
}

interface InverseBody {
  host?: string;
  from?: string;
  to?: string;
  tenant?: string;
}

async function handleInverse(res: ServerResponse, pool: pg.Pool, req: IncomingMessage): Promise<void> {
  const body = (await readJsonBody(req)) as InverseBody;
  if (!body.host || !body.from || !body.to) {
    writeJson(res, 400, { error: "host, from, and to are required" });
    return;
  }

  const values: unknown[] = [body.host, body.from, body.to];
  let tenantClause = "";
  if (body.tenant) {
    tenantClause = `AND g.tenant_id = $${values.length + 1}`;
    values.push(body.tenant);
  }

  // Indexed on grant_observation (destination_host, observed_at) - this is
  // the inverse query the pitfall section insists stays a database query,
  // not an application-side scan of every observation ever recorded.
  const result = await pool.query(
    `SELECT DISTINCT g.id AS grant_id, g.decision_uid, g.tenant_id, g.sandbox_id, g.capability,
            g.policy_digest, g.effective_from, g.effective_to, g.closed_reason
     FROM scout_governance.grant_observation o
     JOIN scout_governance.boundary_grant g ON g.id = o.grant_id
     WHERE o.destination_host = $1 AND o.observed_at >= $2 AND o.observed_at <= $3
     ${tenantClause}`,
    values,
  );

  const decisionUids = [...new Set(result.rows.map((row) => row.decision_uid as string))];
  writeJson(res, 200, { grants: result.rows, permittingDecisions: decisionUids });
}

async function handleGaps(res: ServerResponse, pool: pg.Pool): Promise<void> {
  // A decision is "grant-eligible" when it is an allow for one of the RPCs
  // prompt 06's lifecycle table opens a grant for, at the phase that would
  // have opened one (post_commit for the three sandbox-identity RPCs). A
  // gap here means the grant-opening path was skipped or failed, not that
  // every allow decision should have had a grant - most RPCs never do.
  const decisionsWithoutGrants = await pool.query(
    `SELECT bd.decision_uid, bd.rpc, bd.phase, bd.sandbox_id, bd.occurred_at
     FROM scout_governance.boundary_decision bd
     WHERE bd.verdict = 'allow'
       AND bd.rpc IN ('CreateSandbox', 'AttachSandboxProvider', 'ExposeService')
       AND bd.phase = 'post_commit'
       AND NOT EXISTS (
         SELECT 1 FROM scout_governance.boundary_grant g WHERE g.decision_uid = bd.decision_uid
       )
     ORDER BY bd.occurred_at DESC
     LIMIT 200`,
  );

  const grantsWithoutObservations = await pool.query(
    `SELECT g.id, g.sandbox_id, g.capability, g.effective_from, g.effective_to, g.closed_reason
     FROM scout_governance.boundary_grant g
     WHERE NOT EXISTS (
       SELECT 1 FROM scout_governance.grant_observation o WHERE o.grant_id = g.id
     )
     ORDER BY g.effective_from DESC
     LIMIT 200`,
  );

  writeJson(res, 200, {
    decisionsWithoutGrants: decisionsWithoutGrants.rows,
    decisionsWithoutGrantsCount: decisionsWithoutGrants.rowCount ?? 0,
    grantsWithoutObservations: grantsWithoutObservations.rows,
    grantsWithoutObservationsCount: grantsWithoutObservations.rowCount ?? 0,
  });
}

/** Returns true when this module handled the request (matched a route). */
export function handleLinkageRequest(req: IncomingMessage, res: ServerResponse, linkage: LinkageWriter): boolean {
  if (!req.url) return false;
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/linkage/health") {
    writeJson(res, 200, linkage.getStats());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/linkage/gaps") {
    handleGaps(res, linkage.getPool()).catch((error: unknown) => {
      writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/linkage/inverse") {
    handleInverse(res, linkage.getPool(), req).catch((error: unknown) => {
      writeJson(res, error instanceof Error && error.message.includes("required") ? 400 : 500, {
        error: error instanceof Error ? error.message : "unknown error",
      });
    });
    return true;
  }

  if (req.method === "POST") {
    const revokeMatch = REVOKE_RE.exec(url.pathname);
    if (revokeMatch) {
      handleRevoke(res, linkage, req, revokeMatch[1]).catch((error: unknown) => {
        writeJson(res, error instanceof Error && error.message.includes("required") ? 400 : 500, {
          error: error instanceof Error ? error.message : "unknown error",
        });
      });
      return true;
    }
  }

  if (req.method === "GET" && url.pathname === "/linkage/grants") {
    handleGrantsList(res, linkage.getPool(), url).catch((error: unknown) => {
      writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
    });
    return true;
  }

  if (req.method === "GET") {
    const activityMatch = ACTIVITY_RE.exec(url.pathname);
    if (activityMatch) {
      handleActivity(res, linkage.getPool(), activityMatch[1]).catch((error: unknown) => {
        writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
      });
      return true;
    }

    const grantMatch = GRANT_ID_RE.exec(url.pathname);
    if (grantMatch) {
      handleGrantDetail(res, linkage.getPool(), grantMatch[1]).catch((error: unknown) => {
        writeJson(res, 500, { error: error instanceof Error ? error.message : "unknown error" });
      });
      return true;
    }
  }

  return false;
}
