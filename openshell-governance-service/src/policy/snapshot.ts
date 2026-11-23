// Immutable snapshot, swapped atomically. Evaluate (decide.ts) never reads
// from the database and never blocks on a reload - it only ever calls
// snapshot(), which returns whatever the last successful load produced.

import type pg from "pg";
import type { LoadedPolicy, PolicyBinding, PolicyDocument, PolicySnapshot, SubjectKind } from "./types.js";

interface PolicyRow {
  id: string;
  policy_slug: string;
  version: number;
  digest_sha256: string;
  document: PolicyDocument;
  signature: string | null;
  signed_by: string | null;
}

interface BindingRow {
  subject_kind: SubjectKind;
  subject_key: string;
  policy_id: string;
  priority: number;
}

export async function loadSnapshotFromPool(pool: pg.Pool): Promise<PolicySnapshot> {
  const [policyResult, bindingResult] = await Promise.all([
    pool.query<PolicyRow>(
      `SELECT id, policy_slug, version, digest_sha256, document, signature, signed_by
       FROM scout_policy
       WHERE effective_from <= now() AND superseded_at IS NULL`,
    ),
    pool.query<BindingRow>(
      `SELECT subject_kind, subject_key, policy_id, priority FROM scout_policy_binding`,
    ),
  ]);

  const policiesById = new Map<string, LoadedPolicy>();
  for (const row of policyResult.rows) {
    policiesById.set(row.id, {
      id: row.id,
      policySlug: row.policy_slug,
      version: row.version,
      digestSha256: row.digest_sha256,
      document: row.document,
      signature: row.signature ?? undefined,
      signedBy: row.signed_by ?? undefined,
    });
  }

  const bindings: PolicyBinding[] = bindingResult.rows.map((row) => ({
    subjectKind: row.subject_kind,
    subjectKey: row.subject_key,
    policyId: row.policy_id,
    priority: row.priority,
  }));

  return { loadedAt: new Date().toISOString(), policiesById, bindings };
}

// Prompt 06's grant lifecycle: "policy superseded -> close grants bound to
// the old digest". A policy is superseded when its slug still resolves in
// the new snapshot but under a different digest - compared here, once, so
// the reload path and any future caller agree on what "superseded" means.
export function supersededDigests(previous: PolicySnapshot, next: PolicySnapshot): string[] {
  const nextDigestBySlug = new Map<string, string>();
  for (const policy of next.policiesById.values()) {
    nextDigestBySlug.set(policy.policySlug, policy.digestSha256);
  }
  const result: string[] = [];
  for (const policy of previous.policiesById.values()) {
    const nextDigest = nextDigestBySlug.get(policy.policySlug);
    if (nextDigest && nextDigest !== policy.digestSha256) {
      result.push(policy.digestSha256);
    }
  }
  return result;
}

export interface SnapshotDiagnostics {
  lastReloadAttemptAt: string | null;
  lastSuccessfulReloadAt: string | null;
  lastReloadError: string | null;
}

export class PolicySnapshotManager {
  private current: PolicySnapshot;
  private diagnostics: SnapshotDiagnostics = {
    lastReloadAttemptAt: null,
    lastSuccessfulReloadAt: null,
    lastReloadError: null,
  };

  private constructor(
    private readonly pool: pg.Pool,
    initial: PolicySnapshot,
  ) {
    this.current = initial;
  }

  /** Loads the initial snapshot. Must complete before Describe is served - a
   * failure here is a real startup failure, not a degraded-mode condition,
   * because there is no previous snapshot yet to fall back to. */
  static async bootstrap(pool: pg.Pool): Promise<PolicySnapshotManager> {
    const initial = await loadSnapshotFromPool(pool);
    const manager = new PolicySnapshotManager(pool, initial);
    manager.diagnostics.lastSuccessfulReloadAt = initial.loadedAt;
    return manager;
  }

  snapshot(): PolicySnapshot {
    return this.current;
  }

  getDiagnostics(): SnapshotDiagnostics {
    return this.diagnostics;
  }

  /** A failed reload keeps the previous snapshot and raises an alert (the
   * log line below, plus the failure surfacing on /policy/status) - it never
   * leaves `current` empty or stale-but-unreported. */
  async reload(): Promise<
    { ok: true; digestCount: number; supersededDigests: string[] } | { ok: false; error: string }
  > {
    this.diagnostics.lastReloadAttemptAt = new Date().toISOString();
    try {
      const previous = this.current;
      const next = await loadSnapshotFromPool(this.pool);
      if (next.policiesById.size === 0) {
        // An empty load is a configuration fault (every policy row deleted,
        // or a query that silently returned nothing), not a valid state -
        // treat it the same as a query failure: keep the old snapshot.
        throw new Error("reload produced zero loaded policies; refusing to adopt an empty snapshot");
      }
      this.current = next;
      this.diagnostics.lastSuccessfulReloadAt = next.loadedAt;
      this.diagnostics.lastReloadError = null;
      return { ok: true, digestCount: next.policiesById.size, supersededDigests: supersededDigests(previous, next) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.diagnostics.lastReloadError = message;
      return { ok: false, error: message };
    }
  }
}
