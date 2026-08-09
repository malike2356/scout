// scout-engine/src/secret-scanning/schema.ts
import { z } from 'zod';
import {
  FORBIDDEN_FIELD_PATTERNS,
  MAX_FINDINGS_PER_INGEST,
  SCAN_MODES,
  SCAN_STATUSES,
  SECRET_SCAN_SCHEMA_VERSION,
  SEVERITIES,
} from './constants.js';

const isoDateTime = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'invalid timestamp' });

const relativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => !v.startsWith('/') && !v.includes('\\') && !v.includes('..'), {
    message: 'path must be repository-relative without .. segments',
  });

const fingerprint = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[a-f0-9]+$/i, 'fingerprint must be hex');

const findingSchema = z
  .object({
    rule_id: z.string().min(1).max(128),
    severity: z.enum(SEVERITIES),
    relative_path: relativePath.optional(),
    line: z.number().int().positive().max(2_000_000).optional(),
    commit_id: z
      .string()
      .min(7)
      .max(64)
      .regex(/^[a-f0-9]+$/i)
      .optional(),
    fingerprint,
  })
  .strict();

const signatureSchema = z
  .object({
    algorithm: z.literal('hmac-sha256'),
    timestamp: isoDateTime,
    nonce: z.string().min(8).max(64),
    digest: z.string().min(32).max(128).regex(/^[a-f0-9]+$/i),
  })
  .strict();

const severityCountsSchema = z
  .object({
    critical: z.number().int().min(0).max(MAX_FINDINGS_PER_INGEST),
    high: z.number().int().min(0).max(MAX_FINDINGS_PER_INGEST),
    medium: z.number().int().min(0).max(MAX_FINDINGS_PER_INGEST),
    low: z.number().int().min(0).max(MAX_FINDINGS_PER_INGEST),
    info: z.number().int().min(0).max(MAX_FINDINGS_PER_INGEST),
  })
  .strict();

export const secretScanIngestSchema = z
  .object({
    schema_version: z.literal(SECRET_SCAN_SCHEMA_VERSION),
    connector_key: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
    repository_alias: z.string().min(1).max(256),
    product: z.string().min(1).max(128).optional(),
    scan_id: z.string().min(1).max(128),
    mode: z.enum(SCAN_MODES),
    scanner_name: z.string().min(1).max(64),
    scanner_version: z.string().min(1).max(64),
    started_at: isoDateTime,
    completed_at: isoDateTime,
    observed_at: isoDateTime,
    status: z.enum(SCAN_STATUSES),
    counts: severityCountsSchema,
    findings: z.array(findingSchema).max(MAX_FINDINGS_PER_INGEST),
    hook: z
      .object({
        installed: z.boolean(),
        last_check_at: isoDateTime.optional(),
      })
      .strict()
      .optional(),
    environment_policy: z
      .object({
        ok: z.boolean(),
        detail: z.string().max(256).optional(),
      })
      .strict()
      .optional(),
    idempotency_key: z.string().min(16).max(128),
    signature: signatureSchema,
  })
  .strict();

export type SecretScanIngestPayload = z.infer<typeof secretScanIngestSchema>;

export function collectForbiddenKeys(value: unknown, path: string[] = []): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenKeys(item, [...path, String(index)]));
  }
  if (typeof value !== 'object') return [];

  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (FORBIDDEN_FIELD_PATTERNS.some((re) => re.test(key))) {
      hits.push(nextPath.join('.'));
    }
    hits.push(...collectForbiddenKeys(child, nextPath));
  }
  return hits;
}

export function validateSecretScanIngest(body: unknown):
  | { ok: true; data: SecretScanIngestPayload }
  | { ok: false; code: 'forbidden_field' | 'invalid_schema'; message: string; fields?: string[] } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'invalid_schema', message: 'body must be an object' };
  }

  const forbidden = collectForbiddenKeys(body);
  if (forbidden.length > 0) {
    return {
      ok: false,
      code: 'forbidden_field',
      message: 'payload contains forbidden fields',
      fields: forbidden.slice(0, 20),
    };
  }

  const parsed = secretScanIngestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_schema',
      message: 'payload failed schema validation',
      fields: parsed.error.issues.slice(0, 20).map((issue) => issue.path.join('.') || '(root)'),
    };
  }

  const data = parsed.data;
  const sum =
    data.counts.critical +
    data.counts.high +
    data.counts.medium +
    data.counts.low +
    data.counts.info;
  if (sum !== data.findings.length) {
    return {
      ok: false,
      code: 'invalid_schema',
      message: 'counts must equal findings length by total',
    };
  }

  for (const severity of SEVERITIES) {
    const expected = data.counts[severity];
    const actual = data.findings.filter((f) => f.severity === severity).length;
    if (expected !== actual) {
      return {
        ok: false,
        code: 'invalid_schema',
        message: `counts.${severity} does not match findings`,
      };
    }
  }

  return { ok: true, data };
}
