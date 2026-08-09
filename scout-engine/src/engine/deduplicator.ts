// scout-engine/src/engine/deduplicator.ts
// Fingerprint-based deduplication for findings
// Ensures same host+port+finding_type is tracked once, with seen_count incremented
import crypto from 'crypto';
import { db } from '../db/index.js';

/**
 * Generate a stable fingerprint for a finding.
 * Fingerprint = SHA256(type|host|port|title) truncated to 32 hex chars.
 */
export function generateFingerprint(
  findingType: string,
  host: string | undefined | null,
  port: number | undefined | null,
  title: string,
): string {
  const raw = `${findingType}|${host || 'unknown'}|${port ?? 0}|${title}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export interface DedupResult {
  /** The finding ID if it already exists */
  existingId?: string;
  /** Whether this is a new finding (not seen before) */
  isNew: boolean;
  /** The fingerprint used for lookup */
  fingerprint: string;
}

/**
 * Check if a finding with this fingerprint already exists for this target.
 * If it does, update last_seen_at and increment seen_count.
 * Returns the result, caller decides whether to insert or update.
 */
export async function deduplicateFinding(
  fingerprint: string,
  targetId: string,
  scanRunId: string,
  evidence?: Record<string, unknown>,
): Promise<DedupResult> {
  const existing = await db('findings')
    .where({ fingerprint, target_id: targetId })
    .whereNotIn('status', ['false_positive', 'duplicate'])
    .first();

  if (existing) {
    // Update existing: bump seen_count, update last_seen_at and evidence
    await db('findings').where({ id: existing.id }).update({
      last_seen_at: new Date().toISOString(),
      seen_count: (existing.seen_count || 1) + 1,
      evidence: evidence || existing.evidence,
      scan_run_id: scanRunId,
    });
    return { existingId: existing.id, isNew: false, fingerprint };
  }

  return { isNew: true, fingerprint };
}

/**
 * Sanitize severity string to one of the valid CHECK values.
 */
export function sanitizeSeverity(sev: string | undefined | null): string {
  const s = (sev || 'info').toLowerCase();
  const valid = ['critical', 'high', 'medium', 'low', 'info'];
  return valid.includes(s) ? s : 'info';
}

/**
 * Sanitize finding status to one of the valid CHECK values.
 */
export function sanitizeStatus(status: string | undefined | null): string {
  const s = (status || 'open').toLowerCase();
  const valid = ['open', 'confirmed', 'false_positive', 'remediated', 'wont_fix', 'duplicate'];
  return valid.includes(s) ? s : 'open';
}

/**
 * Sanitize finding_type to one of the valid CHECK values.
 */
export function sanitizeFindingType(type: string | undefined | null): string {
  const t = (type || 'service').toLowerCase();
  const valid = [
    'open_port', 'service', 'subdomain', 'vulnerability', 'cve',
    'exposed_secret', 'misconfiguration', 'certificate_issue',
    'suspicious_activity', 'intrusion_alert', 'compliance_gap',
  ];
  return valid.includes(t) ? t : 'service';
}
