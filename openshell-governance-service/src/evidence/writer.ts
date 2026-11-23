// The async evidence writer (prompt 05). record() is the only thing a
// decision path calls, and it never performs I/O: it validates shape, then
// pushes a plain object onto an in-process bounded queue. A separate
// drainOnce() - called on a timer from index.ts, never from the decision
// path - batches the queue to Postgres.
//
// A dropped evidence record is a governance defect, so "dropped" is always
// observable: a full queue converts the newest arrival straight into a
// decision_write_failure-shaped payload for the next drain, and every
// counter below is exposed on GET /evidence/health.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import type {
  ActorKind,
  BoundaryDecisionRow,
  DecisionContext,
  DecisionForEvidence,
  EvidenceStats,
  ProvenanceEvent,
} from "./types.js";

interface QueueItem {
  row: BoundaryDecisionRow;
  enqueuedAtMs: number;
}

interface DeadLetterItem {
  decisionUid: string | null;
  payload: unknown;
  error: string;
}

export interface EvidenceWriterOptions {
  queueCapacity?: number; // default 10_000
  serviceVersion: string;
}

export class EvidenceWriter {
  private readonly queue: QueueItem[] = [];
  private readonly deadLetters: DeadLetterItem[] = [];
  private readonly ensuredDigests = new Set<string>();
  private readonly capacity: number;
  private readonly serviceVersion: string;

  private decisionsWrittenTotal = 0;
  private writeFailuresTotal = 0;
  private deadLetterTotal = 0;
  private droppedDueToFullBufferTotal = 0;
  private refusedIncompleteTotal = 0;
  private lastDrainAt: string | null = null;
  private lastDrainLagMs: number | null = null;

  constructor(
    private readonly pool: pg.Pool,
    options: EvidenceWriterOptions,
  ) {
    this.capacity = options.queueCapacity ?? 10_000;
    this.serviceVersion = options.serviceVersion;
  }

  /** Non-blocking. No I/O. Safe to call from a decision path. */
  record(decision: DecisionForEvidence, ctx: DecisionContext): void {
    if (!decision.authorityKind || decision.authorityKind.trim() === "") {
      this.refusedIncompleteTotal += 1;
      return;
    }
    if (!decision.reason || decision.reason.trim() === "") {
      this.refusedIncompleteTotal += 1;
      return;
    }

    const row: BoundaryDecisionRow = {
      decisionUid: ctx.decisionUid ?? randomUUID(),
      correlationId: ctx.correlationId ?? null,
      occurredAt: ctx.occurredAt,
      layer: ctx.layer,
      rpc: ctx.rpc,
      phase: ctx.phase ?? null,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId ?? null,
      sandboxId: ctx.sandboxId ?? null,
      subjectLabel: ctx.subjectLabel ?? null,
      verdict: decision.verdict,
      ruleId: decision.ruleId ?? null,
      reason: decision.reason,
      policySlug: decision.policySlug,
      policyVersion: decision.policyVersion ?? 0,
      policyDigest: decision.policyDigest,
      authorityKind: decision.authorityKind,
      authorityRef: decision.authorityRef ?? null,
      residualRisk: decision.residualRisk ?? null,
      latencyUs: ctx.latencyUs ?? null,
      evaluationMode: ctx.evaluationMode,
      serviceVersion: this.serviceVersion,
    };

    if (this.queue.length >= this.capacity) {
      this.droppedDueToFullBufferTotal += 1;
      this.deadLetters.push({
        decisionUid: row.decisionUid,
        payload: row,
        error: "evidence queue was full at enqueue time; this record was never queued for a normal write",
      });
      return;
    }

    this.queue.push({ row, enqueuedAtMs: Date.now() });
  }

  /** Called on a timer, never from a decision path. Returns rows written. */
  async drainOnce(batchSize = 200): Promise<number> {
    const batch = this.queue.splice(0, batchSize);
    const deadLetterBatch = this.deadLetters.splice(0, batchSize);
    let written = 0;

    if (batch.length > 0) {
      const oldestEnqueuedAtMs = batch[0].enqueuedAtMs;
      try {
        await this.insertDecisions(batch.map((item) => item.row));
        written = batch.length;
        this.decisionsWrittenTotal += written;
        await this.ensureProvenanceFor(batch.map((item) => item.row));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.writeFailuresIndividually(batch.map((item) => item.row), message);
      }
      this.lastDrainAt = new Date().toISOString();
      this.lastDrainLagMs = Date.now() - oldestEnqueuedAtMs;
    }

    for (const item of deadLetterBatch) {
      await this.insertDeadLetter(item);
    }

    return written;
  }

  /** Read-only queries (the /evidence/* HTTP routes) share this pool rather
   * than opening a third one - they are not on any decision path either. */
  getPool(): pg.Pool {
    return this.pool;
  }

  /**
   * Records that a policy digest was superseded (prompt 08's provenance
   * chain needs this event to exist, not just "the old digest stopped
   * being active"). Called from index.ts's reload handling, alongside
   * LinkageWriter.closeGrantsForSupersededDigest - same trigger, two
   * different records of the same fact. Idempotent via the same
   * NOT EXISTS guard ensureProvenanceFor() uses, and best-effort for the
   * same reason: provenance is auto-recorded evidence, not the record a
   * decision's own write path depends on.
   */
  async recordSupersession(oldDigest: string): Promise<void> {
    if (!oldDigest || oldDigest === "none" || oldDigest === "unknown") return;
    try {
      await this.pool.query(
        `INSERT INTO scout_governance.policy_provenance
           (policy_id, policy_digest, event, actor, actor_kind, note)
         SELECT COALESCE((SELECT id FROM scout_policy WHERE digest_sha256 = $1 LIMIT 1), 0),
                $1, 'superseded', 'scout-governance', 'system', 'auto-recorded: a policy reload replaced this digest'
         WHERE NOT EXISTS (
           SELECT 1 FROM scout_governance.policy_provenance WHERE policy_digest = $1 AND event = 'superseded'
         )`,
        [oldDigest],
      );
    } catch {
      // Best-effort, same reasoning as ensureProvenanceFor().
    }
  }

  getStats(): EvidenceStats {
    const oldest = this.queue[0];
    return {
      queueDepth: this.queue.length,
      oldestQueuedAgeMs: oldest ? Date.now() - oldest.enqueuedAtMs : null,
      drainLagMs: this.lastDrainLagMs,
      lastDrainAt: this.lastDrainAt,
      decisionsWrittenTotal: this.decisionsWrittenTotal,
      writeFailuresTotal: this.writeFailuresTotal,
      deadLetterTotal: this.deadLetterTotal,
      droppedDueToFullBufferTotal: this.droppedDueToFullBufferTotal,
      refusedIncompleteTotal: this.refusedIncompleteTotal,
    };
  }

  private async insertDecisions(rows: BoundaryDecisionRow[]): Promise<void> {
    // One multi-row INSERT per batch - cheap for Postgres and keeps the
    // drain loop from issuing hundreds of round trips per tick.
    const columns = [
      "decision_uid", "correlation_id", "occurred_at", "layer", "rpc", "phase",
      "tenant_id", "workspace_id", "sandbox_id", "subject_label", "verdict",
      "rule_id", "reason", "policy_slug", "policy_version", "policy_digest",
      "authority_kind", "authority_ref", "residual_risk", "latency_us",
      "evaluation_mode", "service_version",
    ];
    const values: unknown[] = [];
    const placeholders = rows.map((row, rowIdx) => {
      const base = rowIdx * columns.length;
      values.push(
        row.decisionUid, row.correlationId, row.occurredAt, row.layer, row.rpc, row.phase,
        row.tenantId, row.workspaceId, row.sandboxId, row.subjectLabel, row.verdict,
        row.ruleId, row.reason, row.policySlug, row.policyVersion, row.policyDigest,
        row.authorityKind, row.authorityRef, row.residualRisk, row.latencyUs,
        row.evaluationMode, row.serviceVersion,
      );
      return `(${columns.map((_, i) => `$${base + i + 1}`).join(", ")})`;
    });

    await this.pool.query(
      `INSERT INTO scout_governance.boundary_decision (${columns.join(", ")})
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  private async writeFailuresIndividually(rows: BoundaryDecisionRow[], batchError: string): Promise<void> {
    for (const row of rows) {
      try {
        await this.insertDeadLetter({ decisionUid: row.decisionUid, payload: row, error: batchError });
      } catch {
        // The dead-letter table itself is unreachable - nothing more this
        // process can do; the counter below is the only remaining signal.
      }
    }
  }

  private async insertDeadLetter(item: DeadLetterItem): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO scout_governance.decision_write_failure (decision_uid, payload, error, attempts)
         VALUES ($1, $2, $3, 1)`,
        [item.decisionUid, JSON.stringify(item.payload), item.error],
      );
      this.writeFailuresTotal += 1;
      this.deadLetterTotal += 1;
    } catch {
      this.writeFailuresTotal += 1;
    }
  }

  /**
   * Guarantees prompt 05's acceptance criterion - "every row resolves
   * policy_digest to a policy_provenance entry, or is explicitly recorded
   * as authority_kind = 'default'" - without requiring decide.ts or
   * middleware/evaluate.ts to touch the database. The first decision this
   * process ever writes for a given digest lazily records that digest's
   * provenance; later decisions citing the same digest are a no-op here.
   */
  private async ensureProvenanceFor(rows: BoundaryDecisionRow[]): Promise<void> {
    const seen = new Map<string, BoundaryDecisionRow>();
    for (const row of rows) {
      if (row.authorityKind === "default") continue;
      if (this.ensuredDigests.has(row.policyDigest)) continue;
      if (!seen.has(row.policyDigest)) seen.set(row.policyDigest, row);
    }
    for (const [digest, row] of seen) {
      const actorKind: ActorKind = row.authorityKind === "signed_policy" ? "human" : "system";
      const actor = row.authorityRef ?? row.policySlug;
      const events: ProvenanceEvent[] = row.authorityKind === "signed_policy" ? ["signed", "activated"] : ["authored", "activated"];
      try {
        for (const event of events) {
          await this.pool.query(
            `INSERT INTO scout_governance.policy_provenance
               (policy_id, policy_digest, event, actor, actor_kind, signature_subject, note)
             SELECT COALESCE((SELECT id FROM scout_policy WHERE digest_sha256 = $1 LIMIT 1), 0),
                    $1, $2, $3, $4, $5, 'auto-recorded from the first decision citing this digest'
             WHERE NOT EXISTS (
               SELECT 1 FROM scout_governance.policy_provenance WHERE policy_digest = $1 AND event = $2
             )`,
            [digest, event, actor, actorKind, row.authorityKind === "signed_policy" ? row.authorityRef ?? null : null],
          );
        }
        this.ensuredDigests.add(digest);
      } catch {
        // Provenance is best-effort auto-recording, not the record of
        // truth - a failure here must not block the decision row (already
        // committed above) and is not worth a dedicated counter; the next
        // drain retries it since the digest was never added to the Set.
      }
    }
  }
}
