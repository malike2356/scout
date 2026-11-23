// The async linkage writer (prompt 06). Every public method here is
// non-blocking and performs zero I/O - same discipline as
// src/evidence/writer.ts, and for the same reason: nothing on a decision
// path may touch Postgres synchronously. A separate drainOnce(), called on
// a timer from index.ts, does the actual grant lifecycle and observation
// writes.
//
// boundary_grant is the one mutable table in this product: closing a grant
// is an UPDATE, not a new row, because "is this boundary currently in
// force" is a question with one current answer, not a history of claims
// about it. grant_observation stays append-only.

import type pg from "pg";
import { attributesTo } from "./attribute.js";
import type {
  BoundaryGrant,
  BoundaryGrantRow,
  ClosedReason,
  GrantOpenInput,
  LinkageStats,
  RawObservationInput,
} from "./types.js";

type LinkageOp =
  | { kind: "open_grant"; input: GrantOpenInput }
  | { kind: "close_by_sandbox"; sandboxId: string; reason: ClosedReason; occurredAt: string }
  | { kind: "close_by_digest"; policyDigest: string; reason: ClosedReason; occurredAt: string }
  | { kind: "observation"; input: RawObservationInput };

export interface LinkageWriterOptions {
  queueCapacity?: number; // default 10_000
}

export class LinkageWriter {
  private readonly queue: { op: LinkageOp; enqueuedAtMs: number }[] = [];
  private readonly capacity: number;

  private grantsOpenedTotal = 0;
  private grantsClosedTotal = 0;
  private observationsWrittenTotal = 0;
  private observationsUnattributedTotal = 0;
  private grantOpenSkippedUnresolvedSandboxTotal = 0;
  private droppedDueToFullBufferTotal = 0;
  private lastDrainAt: string | null = null;
  private lastDrainLagMs: number | null = null;

  constructor(
    private readonly pool: pg.Pool,
    options: LinkageWriterOptions = {},
  ) {
    this.capacity = options.queueCapacity ?? 10_000;
  }

  /** Non-blocking. No I/O. The sandbox id may be undefined when the
   * triggering RPC's committed response did not carry a resolvable one -
   * that is refused and counted, never opened against a wrong identity. */
  openGrant(input: GrantOpenInput | (Omit<GrantOpenInput, "sandboxId"> & { sandboxId: string | undefined })): void {
    if (!input.sandboxId || !input.decisionUid || !input.capability) {
      this.grantOpenSkippedUnresolvedSandboxTotal += 1;
      return;
    }
    this.enqueue({ kind: "open_grant", input: input as GrantOpenInput });
  }

  /** Non-blocking. Closes every currently-open grant for this sandbox. */
  closeGrantsForSandbox(sandboxId: string, reason: ClosedReason, occurredAt: string): void {
    if (!sandboxId) return;
    this.enqueue({ kind: "close_by_sandbox", sandboxId, reason, occurredAt });
  }

  /** Non-blocking. Closes every currently-open grant bound to a superseded
   * policy digest - called once per digest that a policy reload replaced. */
  closeGrantsForSupersededDigest(policyDigest: string, occurredAt: string): void {
    if (!policyDigest || policyDigest === "none" || policyDigest === "unknown") return;
    this.enqueue({ kind: "close_by_digest", policyDigest, reason: "policy_superseded", occurredAt });
  }

  /** Non-blocking. A raw fact ("this sandbox reached this host at this
   * time with this capability") - attribution to the open grant(s) it
   * belongs to happens during drainOnce(), against the grants as they
   * stand at drain time, not at enqueue time. */
  recordObservation(input: RawObservationInput): void {
    if (!input.sandboxId) return;
    this.enqueue({ kind: "observation", input });
  }

  private enqueue(op: LinkageOp): void {
    if (this.queue.length >= this.capacity) {
      this.droppedDueToFullBufferTotal += 1;
      return;
    }
    this.queue.push({ op, enqueuedAtMs: Date.now() });
  }

  /** Called on a timer, never from a decision path. Returns ops processed. */
  async drainOnce(batchSize = 200): Promise<number> {
    const batch = this.queue.splice(0, batchSize);
    if (batch.length === 0) return 0;
    const oldestEnqueuedAtMs = batch[0].enqueuedAtMs;

    for (const { op } of batch) {
      switch (op.kind) {
        case "open_grant":
          await this.insertGrant(op.input);
          break;
        case "close_by_sandbox":
          await this.closeBySandbox(op.sandboxId, op.reason, op.occurredAt);
          break;
        case "close_by_digest":
          await this.closeByDigest(op.policyDigest, op.reason, op.occurredAt);
          break;
        case "observation":
          await this.attributeAndInsertObservation(op.input);
          break;
      }
    }

    this.lastDrainAt = new Date().toISOString();
    this.lastDrainLagMs = Date.now() - oldestEnqueuedAtMs;
    return batch.length;
  }

  getPool(): pg.Pool {
    return this.pool;
  }

  /**
   * Revoke (prompt 08's emergency lever) - deliberately NOT queued through
   * record()/drainOnce(). An operator pressing "revoke" needs a definite
   * yes/no, not "accepted, maybe eventually" - the whole point of "never
   * optimistic" is that the caller must be able to say for certain whether
   * the grant is closed before it reports success.
   *
   * Honest about what this service can actually do: it closes Scout's own
   * grant record and writes the audit note for real. It has no gateway
   * administrative client to also detach the underlying capability live -
   * nothing in this codebase calls back into OpenShell. Callers must not
   * present this as "capability revoked at the platform", only as "Scout's
   * record of this boundary is now closed" - see scout-dashboard's revoke
   * UI copy.
   */
  async revokeGrant(
    grantId: string,
    author: string,
    note: string,
  ): Promise<{ ok: true; grant: BoundaryGrantRow } | { ok: false; error: string }> {
    try {
      const occurredAt = new Date().toISOString();
      const result = await this.pool.query<{
        id: string;
        decision_uid: string;
        tenant_id: string;
        sandbox_id: string;
        capability: string;
        policy_digest: string;
        effective_from: string;
        effective_to: string | null;
        closed_reason: ClosedReason | null;
      }>(
        `UPDATE scout_governance.boundary_grant
         SET effective_to = $1, closed_reason = 'revoked'
         WHERE id = $2 AND effective_to IS NULL
         RETURNING id, decision_uid, tenant_id, sandbox_id, capability, policy_digest,
                   effective_from, effective_to, closed_reason`,
        [occurredAt, grantId],
      );
      const row = result.rows[0];
      if (!row) {
        return { ok: false, error: "no open grant with that id (already closed, or it never existed)" };
      }
      await this.pool.query(
        `INSERT INTO scout_governance.incident_review_note (decision_uid, grant_id, author, note)
         VALUES ($1, $2, $3, $4)`,
        [row.decision_uid, row.id, author, note],
      );
      this.grantsClosedTotal += 1;
      return {
        ok: true,
        grant: {
          id: row.id,
          decisionUid: row.decision_uid,
          tenantId: row.tenant_id,
          sandboxId: row.sandbox_id,
          capability: row.capability,
          policyDigest: row.policy_digest,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          closedReason: row.closed_reason,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
    }
  }

  getStats(): LinkageStats {
    return {
      queueDepth: this.queue.length,
      lastDrainAt: this.lastDrainAt,
      drainLagMs: this.lastDrainLagMs,
      grantsOpenedTotal: this.grantsOpenedTotal,
      grantsClosedTotal: this.grantsClosedTotal,
      observationsWrittenTotal: this.observationsWrittenTotal,
      observationsUnattributedTotal: this.observationsUnattributedTotal,
      grantOpenSkippedUnresolvedSandboxTotal: this.grantOpenSkippedUnresolvedSandboxTotal,
    };
  }

  private async insertGrant(input: GrantOpenInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO scout_governance.boundary_grant
         (decision_uid, tenant_id, sandbox_id, capability, policy_digest, effective_from)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.decisionUid, input.tenantId, input.sandboxId, input.capability, input.policyDigest, input.effectiveFrom],
    );
    this.grantsOpenedTotal += 1;
  }

  private async closeBySandbox(sandboxId: string, reason: ClosedReason, occurredAt: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE scout_governance.boundary_grant
       SET effective_to = $1, closed_reason = $2
       WHERE sandbox_id = $3 AND effective_to IS NULL`,
      [occurredAt, reason, sandboxId],
    );
    this.grantsClosedTotal += result.rowCount ?? 0;
  }

  private async closeByDigest(policyDigest: string, reason: ClosedReason, occurredAt: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE scout_governance.boundary_grant
       SET effective_to = $1, closed_reason = $2
       WHERE policy_digest = $3 AND effective_to IS NULL`,
      [occurredAt, reason, policyDigest],
    );
    this.grantsClosedTotal += result.rowCount ?? 0;
  }

  private async attributeAndInsertObservation(input: RawObservationInput): Promise<void> {
    const openGrants = await this.pool.query<{
      id: string;
      sandbox_id: string;
      capability: string;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT id, sandbox_id, capability, effective_from, effective_to
       FROM scout_governance.boundary_grant
       WHERE sandbox_id = $1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2)`,
      [input.sandboxId, input.observedAt],
    );

    const matches = openGrants.rows.filter((row) => {
      const grant: BoundaryGrant = {
        id: row.id,
        sandboxId: row.sandbox_id,
        capability: row.capability,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
      };
      return attributesTo(
        { sandboxId: input.sandboxId, observedAt: input.observedAt, capability: input.capability },
        grant,
      );
    });

    if (matches.length === 0) {
      this.observationsUnattributedTotal += 1;
      return;
    }

    for (const grant of matches) {
      await this.pool.query(
        `INSERT INTO scout_governance.grant_observation
           (grant_id, observed_at, kind, destination_host, outcome, byte_count, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          grant.id,
          input.observedAt,
          input.kind,
          input.destinationHost ?? null,
          input.outcome,
          input.byteCount ?? null,
          input.detail ? JSON.stringify(input.detail) : null,
        ],
      );
      this.observationsWrittenTotal += 1;
    }
  }
}
